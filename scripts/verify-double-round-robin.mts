/**
 * Double round robin — the format, and the Season that needed it.
 *
 * ── What went wrong ──────────────────────────────────────────────────────────────────────────────
 * 8BRCAM 2026 Season 1 was played as a DOUBLE round robin: every pair met twice, each meeting with
 * its own score. It was stored as a single round robin with the two meetings SUMMED into one row —
 * Kevin's 7-3 and 10-0 over Adam became a single "17-3". That is not a partial record, it is a
 * different competition: nine of the 34 players carried the wrong W-L-T and four groups the wrong
 * order, which is what seeded the playoffs.
 *
 * ── What is asserted ─────────────────────────────────────────────────────────────────────────────
 * The format is opt-in and per Season, the shape of a double robin is exactly 2*(n-1) per player and
 * n*(n-1) per group, and the three storage rules hold: a forfeit keeps no score, a tie keeps its own,
 * and neither is allowed to move a differential it should not.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env.replica scripts/verify-double-round-robin.mts
 */
import { readFileSync } from 'node:fs'
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { computeStandings, type StandingMatchInput } from '../src/lib/competition/standings.ts'

assertLocalDatabase('verify double round robin')

const SEASON = 16426
let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

section('The format is a per-Season setting, not a global change')
{
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  check('a reusable SeasonGroupFormat enum exists', /enum SeasonGroupFormat \{[\s\S]*?DOUBLE_ROUND_ROBIN/.test(schema))
  check('...defaulting to SINGLE_ROUND_ROBIN, so no existing Season changes',
    /groupFormat\s+SeasonGroupFormat @default\(SINGLE_ROUND_ROBIN\)/.test(schema))
  check('a match records WHICH meeting it is', /meeting\s+Int\s+@default\(1\)/.test(schema))

  const target = await prisma.season.findUnique({ where: { id: SEASON }, select: { groupFormat: true } })
  check('Season 16426 is the double round robin', target?.groupFormat === 'DOUBLE_ROUND_ROBIN', String(target?.groupFormat))

  const others = await prisma.season.findMany({ where: { id: { not: SEASON } }, select: { id: true, groupFormat: true } })
  check('every other Season is still a single round robin',
    others.every((s) => s.groupFormat === 'SINGLE_ROUND_ROBIN'),
    others.filter((s) => s.groupFormat !== 'SINGLE_ROUND_ROBIN').map((s) => s.id).join(', '))
  const otherMeetings = await prisma.seasonMatch.count({ where: { seasonId: { not: SEASON }, meeting: { not: 1 } } })
  check('...and no other Season has a second meeting', otherMeetings === 0, `${otherMeetings} rows`)
}

section('The shape of a double round robin')
{
  const groups = await prisma.seasonGroup.findMany({
    where: { seasonId: SEASON },
    select: { id: true, code: true, _count: { select: { players: true } } },
    orderBy: { code: 'asc' },
  })
  let total = 0
  for (const g of groups) {
    const n = g._count.players
    const matches = await prisma.seasonMatch.count({ where: { groupId: g.id } })
    total += matches
    check(`group ${g.code}: ${n} players play n*(n-1) = ${n * (n - 1)} matches`, matches === n * (n - 1), `${matches}`)

    // Per player: 2*(n-1). Counted from the rows rather than assumed from the total, because a
    // group can hold the right NUMBER of matches and still have somebody scheduled twice.
    const rows = await prisma.seasonMatch.findMany({ where: { groupId: g.id }, select: { homeEntrantId: true, awayEntrantId: true, meeting: true } })
    const per = new Map<number, number>()
    for (const r of rows) {
      per.set(r.homeEntrantId, (per.get(r.homeEntrantId) ?? 0) + 1)
      per.set(r.awayEntrantId, (per.get(r.awayEntrantId) ?? 0) + 1)
    }
    check(`...and every player has exactly 2*(n-1) = ${2 * (n - 1)}`,
      per.size === n && [...per.values()].every((v) => v === 2 * (n - 1)),
      [...per.values()].join(','))

    // Exactly two meetings per pairing, numbered 1 and 2 — never one row, never three.
    const pairs = new Map<string, number[]>()
    for (const r of rows) {
      const k = [r.homeEntrantId, r.awayEntrantId].sort((a, b) => a - b).join('-')
      pairs.set(k, [...(pairs.get(k) ?? []), r.meeting])
    }
    check(`...across ${(n * (n - 1)) / 2} pairings, each meeting exactly twice as Meeting 1 and 2`,
      pairs.size === (n * (n - 1)) / 2 && [...pairs.values()].every((v) => v.length === 2 && v.includes(1) && v.includes(2)))
  }
  check('198 group matches in total', total === 198, `${total}`)
}

section('Forfeits, ties and scores are stored the way the rules require')
{
  const all = await prisma.seasonMatch.findMany({ where: { seasonId: SEASON } })
  const ffs = all.filter((m) => m.status === 'FORFEIT')
  check('forfeits exist', ffs.length > 0, `${ffs.length}`)
  check('...and none of them stores a score, so none can move a differential',
    ffs.every((m) => m.homeGames == null && m.awayGames == null))
  check('...each names the forfeiting player and awards the other one the match',
    ffs.every((m) => m.forfeitEntrantId != null && m.winnerEntrantId != null && m.winnerEntrantId !== m.forfeitEntrantId))

  const ties = all.filter((m) => m.winnerEntrantId == null && m.status === 'COMPLETED')
  check('ties exist and are level on games', ties.length > 0 && ties.every((m) => m.homeGames === m.awayGames), `${ties.length}`)
  check('...an inferred tie is stored 5-5', ties.some((m) => m.homeGames === 5))
  check('...and a tie the source scored keeps that score, not 5-5',
    ties.some((m) => m.homeGames === 0) && ties.some((m) => m.homeGames === 1),
    'expected the recorded 0-0 and 1-1 ties to survive')

  const played = all.filter((m) => m.status === 'COMPLETED' && m.winnerEntrantId != null)
  check('a decided played match always has a winner with more games',
    played.every((m) => {
      const hw = m.winnerEntrantId === m.homeEntrantId
      return (hw ? (m.homeGames ?? 0) > (m.awayGames ?? 0) : (m.awayGames ?? 0) > (m.homeGames ?? 0))
    }))
  check('every match is resolved — nothing left scheduled',
    all.every((m) => m.status === 'COMPLETED' || m.status === 'FORFEIT'))
}

section('Standings reproduce the source record')
{
  // Challonge's official W-L-T for all 34. The reconstruction is worthless if it does not land here.
  const EXPECT: Record<string, string> = {
    sixohtwo: '11-1-0', NoLimitGary: '9-2-1', adambuddy: '7-2-3', fsm_brian: '5-4-3', Bricycle: '3-8-1',
    SabreGirl: '3-9-0', Black_Ball: '0-12-0',
    Starkiller: '8-2-2', IrateMusicfool: '6-3-3', 'i.am_the_zodiac': '5-2-5', eskimo: '5-2-5',
    lilsparky67: '4-4-4', Sterlo_: '4-8-0', Javi_8: '0-11-1',
    Travis: '10-0-2', Iantunstall: '8-1-3', FreakyLilspider: '6-6-0', o_aig_o: '5-5-2', Cam: '4-6-2',
    Bye_all_c_ya: '2-8-2', THE_PFB: '0-9-3',
    l_Mr_CC_l: '8-2-0', S_U_K_I_O_O: '8-2-0', '\u{1F48E}': '7-3-0', Black_Jesus: '4-6-0', ArsH_: '1-7-2',
    'mr.kapaw': '0-8-2',
    easyrun: '11-0-1', xlx_ogges_xlx: '6-2-4', 'mr.spin': '5-4-3', F_A_I_S_A_L: '5-5-2', TRICK__D: '4-6-2',
    spc_shogun: '3-6-3', JEFE_122: '0-11-1',
  }
  // SeasonStanding has no relation to the entrant, so the handle is looked up separately.
  const [rows, ents] = await Promise.all([
    prisma.seasonStanding.findMany({ where: { seasonId: SEASON }, select: { wins: true, losses: true, draws: true, played: true, entrantId: true } }),
    prisma.seasonEntrant.findMany({ where: { seasonId: SEASON }, select: { id: true, cueverseId: true } }),
  ])
  const handle = new Map(ents.map((e) => [e.id, e.cueverseId ?? '']))
  check('34 standings rows', rows.length === 34, `${rows.length}`)
  const wrong = rows.filter((r) => EXPECT[handle.get(r.entrantId) ?? ''] !== `${r.wins}-${r.losses}-${r.draws}`)
  for (const r of wrong) console.log(`      ${handle.get(r.entrantId)}: ${r.wins}-${r.losses}-${r.draws} vs ${EXPECT[handle.get(r.entrantId) ?? '']}`)
  check('every W-L-T matches the source exactly', wrong.length === 0, `${wrong.length} wrong`)
  check('...and everybody played their full slate', rows.every((r) => r.played === 12 || r.played === 10))
}

section('The completion point knows how long a full slate is')
{
  /*
   * A pure check on the formula, not on this Season. With the single-robin slate a player in a
   * double group clears the bar halfway through and collects the completion point for a season they
   * have not finished, so the same fixtures must score differently under the two formats.
   */
  const roster = [1, 2, 3].map((n) => ({ registrationId: n, username: `P${n}` }))
  const half: StandingMatchInput[] = [
    { homeRegistrationId: 1, awayRegistrationId: 2, homeUsername: 'P1', awayUsername: 'P2', homeGames: 7, awayGames: 3, winnerRegistrationId: 1 },
    { homeRegistrationId: 1, awayRegistrationId: 3, homeUsername: 'P1', awayUsername: 'P3', homeGames: 7, awayGames: 3, winnerRegistrationId: 1 },
  ]
  const single = computeStandings(roster, half, 1, 1).find((r) => r.registrationId === 1)!
  const double = computeStandings(roster, half, 1, 2).find((r) => r.registrationId === 1)!
  check('two wins of two complete a single robin and earn the completion point', single.points === 2 * 2 + 1, `${single.points}`)
  check('...but are only half a double robin, so they do not', double.points === 2 * 2, `${double.points}`)
  check('the default is unchanged for every existing caller',
    computeStandings(roster, half, 1).find((r) => r.registrationId === 1)!.points === single.points)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
