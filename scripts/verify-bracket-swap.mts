/**
 * Arranging a draft bracket by hand: swapping two positions must never duplicate a player.
 *
 * The reported bug: swapping the two halves of ONE match (M3's IrateMusicfool with lilsparky67)
 * left the dragged player on both lines and the other gone. It is visible on the 602 Invitational
 * board, where the same entrant sits on both lines of M2.
 *
 * The cause is in `setTournamentBracketSlot`: the lookup that finds where the mover came from
 * excludes the target match, so a within-match move found no origin, vacated nothing, and then
 * wrote the mover into the target seat.
 *
 * Run:  npx tsx --tsconfig tsconfig.scripts.json scripts/verify-bracket-swap.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { setTournamentBracketSlot } from '../src/lib/competition/service.ts'
import { setSeasonBracketSlot } from '../src/lib/seasons/playoffs.ts'

assertLocalDatabase()

let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

const MARK = 'zzsw-verify'
const ACTOR = { userId: 960888, username: MARK }

async function cleanup() {
  const rows = await prisma.tournament.findMany({ where: { name: { startsWith: MARK } }, select: { id: true } })
  for (const r of rows) {
    await prisma.playoffMatch.deleteMany({ where: { tournamentId: r.id } }).catch(() => {})
    await prisma.registration.deleteMany({ where: { tournamentId: r.id } }).catch(() => {})
    await prisma.tournament.delete({ where: { id: r.id } }).catch(() => {})
  }
  const seasons = await prisma.season.findMany({ where: { slug: { startsWith: MARK } }, select: { id: true } })
  for (const s2 of seasons) {
    await prisma.seasonPlayoffMatch.deleteMany({ where: { seasonId: s2.id } }).catch(() => {})
    await prisma.seasonEntrant.deleteMany({ where: { seasonId: s2.id } }).catch(() => {})
    await prisma.season.delete({ where: { id: s2.id } }).catch(() => {})
  }
  await prisma.auditLog.deleteMany({ where: { actorUsername: MARK } }).catch(() => {})
}
await cleanup()

/**
 * A DRAFT first round: two matches of two players, plus one match holding a bye.
 *
 * Written directly rather than generated, so the shape under test is exactly the one on the screen
 * — a handful of round-1 matches, unpublished, with no results.
 */
async function build() {
  const series = await prisma.competitionSeries.findFirstOrThrow({ select: { id: true } })
  const t = await prisma.tournament.create({
    data: {
      name: `${MARK} draw`, slug: `${MARK}-${Date.now() % 1_000_000}`,
      competitionSeriesId: series.id, competitionYear: 2026,
      tournamentFormat: 'SINGLE_ELIM', status: 'ACTIVE', playoffsStatus: 'PENDING',
      publiclyVisible: false,
    },
    select: { id: true },
  })
  const regs: { id: number; name: string }[] = []
  for (const name of ['irate', 'sparky', 'jefe', 'luke', 'faisal']) {
    const r = await prisma.registration.create({
      data: { tournamentId: t.id, status: 'APPROVED', username: `${MARK}-${name}`, displayName: name },
      select: { id: true },
    })
    regs.push({ id: r.id, name })
  }
  const mk = async (slot: number, home: { id: number; name: string } | null, away: { id: number; name: string } | null) =>
    (await prisma.playoffMatch.create({
      data: {
        tournamentId: t.id, round: 1, slot, published: false,
        homeRegistrationId: home?.id ?? null, homeUsername: home?.name ?? 'Bye', homeSeed: slot * 2 + 1,
        awayRegistrationId: away?.id ?? null, awayUsername: away?.name ?? 'Bye', awaySeed: slot * 2 + 2,
      },
      select: { id: true },
    })).id

  const m3 = await mk(0, regs[0], regs[1])   // irate vs sparky — the reported case
  const m4 = await mk(1, regs[2], regs[3])   // jefe vs luke
  const m1 = await mk(2, regs[4], null)      // faisal vs a bye
  return { tid: t.id, regs, m3, m4, m1 }
}

const readRound1 = (tid: number) => prisma.playoffMatch.findMany({
  where: { tournamentId: tid, round: 1 },
  select: {
    id: true, slot: true,
    homeRegistrationId: true, awayRegistrationId: true,
    homeUsername: true, awayUsername: true,
  },
  orderBy: { slot: 'asc' },
})

/** Every seated entrant across round 1. A duplicate here is the bug. */
function seated(rows: Awaited<ReturnType<typeof readRound1>>): number[] {
  return rows.flatMap((m) => [m.homeRegistrationId, m.awayRegistrationId]).filter((x): x is number => x != null)
}
const dupes = (ids: number[]) => ids.filter((id, i) => ids.indexOf(id) !== i)

try {
  // ── The reported bug ──────────────────────────────────────────────────────────────────────────
  section('Swapping the two halves of one match exchanges them')
  {
    const { tid, regs, m3 } = await build()
    const [irate, sparky] = regs

    // What the board does when you drag the home player onto the away line of the same match.
    const r = await setTournamentBracketSlot(ACTOR, tid, m3, 'away', irate.id)
    check('the move is accepted', r.ok, r.error ?? '')

    const rows = await readRound1(tid)
    const m = rows.find((x) => x.id === m3)!
    check('the dragged player is now on the away line', m.awayRegistrationId === irate.id,
      `${m.awayUsername}`)
    check('the other player took the home line', m.homeRegistrationId === sparky.id,
      `${m.homeUsername}`)
    check('the names moved with them',
      m.homeUsername === 'sparky' && m.awayUsername === 'irate',
      `${m.homeUsername} / ${m.awayUsername}`)
    check('NEITHER player is duplicated', dupes(seated(rows)).length === 0,
      `duplicated: ${dupes(seated(rows)).join(',')}`)
    check('nobody was dropped from the board', seated(rows).length === 5, String(seated(rows).length))

    // And back again, so the swap is not one-directional.
    await setTournamentBracketSlot(ACTOR, tid, m3, 'home', irate.id)
    const back = (await readRound1(tid)).find((x) => x.id === m3)!
    check('swapping back restores the original order',
      back.homeRegistrationId === irate.id && back.awayRegistrationId === sparky.id)
    check('...still with no duplicate', dupes(seated(await readRound1(tid))).length === 0)
    await cleanup()
  }

  // ── A player and a bye in the same match ──────────────────────────────────────────────────────
  section('Swapping a player with a bye in the same match')
  {
    const { tid, regs, m1 } = await build()
    const faisal = regs[4]

    const r = await setTournamentBracketSlot(ACTOR, tid, m1, 'away', faisal.id)
    check('the move is accepted', r.ok, r.error ?? '')

    const rows = await readRound1(tid)
    const m = rows.find((x) => x.id === m1)!
    check('the player is on the away line', m.awayRegistrationId === faisal.id)
    check('the bye took the home line', m.homeRegistrationId === null, String(m.homeRegistrationId))
    check('...and still reads as a bye rather than blank', m.homeUsername === 'Bye', String(m.homeUsername))
    check('the player is not duplicated', dupes(seated(rows)).length === 0)
    check('nobody was dropped', seated(rows).length === 5, String(seated(rows).length))
    await cleanup()
  }

  // ── The case that already worked must keep working ────────────────────────────────────────────
  section('Swapping across two different matches still works')
  {
    const { tid, regs, m3, m4 } = await build()
    const [irate, , jefe] = regs

    // Drag jefe (in M4 home) onto M3's home line: irate should land where jefe was.
    const r = await setTournamentBracketSlot(ACTOR, tid, m3, 'home', jefe.id)
    check('the move is accepted', r.ok, r.error ?? '')

    const rows = await readRound1(tid)
    const a = rows.find((x) => x.id === m3)!
    const b = rows.find((x) => x.id === m4)!
    check('the dragged player took the target seat', a.homeRegistrationId === jefe.id)
    check('the displaced player took the seat it came from', b.homeRegistrationId === irate.id)
    check('no duplicate across the board', dupes(seated(rows)).length === 0,
      `duplicated: ${dupes(seated(rows)).join(',')}`)
    check('nobody was dropped', seated(rows).length === 5, String(seated(rows).length))
    await cleanup()
  }

  // ── Seeds must not be lost in a within-match swap ─────────────────────────────────────────────
  section('A within-match swap keeps both seat numbers')
  {
    const { tid, regs, m3 } = await build()
    const before = (await readRound1(tid)).find((x) => x.id === m3)!
    await setTournamentBracketSlot(ACTOR, tid, m3, 'away', regs[0].id)
    const after = await prisma.playoffMatch.findUniqueOrThrow({
      where: { id: m3 }, select: { homeSeed: true, awaySeed: true },
    })
    check('both seat numbers are still set',
      after.homeSeed != null && after.awaySeed != null, `${after.homeSeed} / ${after.awaySeed}`)
    check('the two seats did not collapse onto one number',
      after.homeSeed !== after.awaySeed, `${after.homeSeed} / ${after.awaySeed}`)
    void before
    await cleanup()
  }

  // ── The guard rails around it are untouched ───────────────────────────────────────────────────
  section('The existing refusals still hold')
  {
    const { tid, regs, m3 } = await build()
    await prisma.playoffMatch.updateMany({ where: { tournamentId: tid }, data: { published: true } })
    const pub = await setTournamentBracketSlot(ACTOR, tid, m3, 'away', regs[0].id)
    check('a published bracket refuses hand arrangement', !pub.ok, pub.error ?? 'allowed')

    await prisma.playoffMatch.updateMany({ where: { tournamentId: tid }, data: { published: false } })
    await prisma.playoffMatch.update({ where: { id: m3 }, data: { winnerRegistrationId: regs[0].id } })
    const done = await setTournamentBracketSlot(ACTOR, tid, m3, 'away', regs[1].id)
    check('a match with a result refuses it too', !done.ok, done.error ?? 'allowed')
    await cleanup()
  }

  // ── The Season board, which had the same bug ──────────────────────────────────────────────────
  section('The Season playoff board swaps within a match too')
  {
    const series = await prisma.competitionSeries.findFirstOrThrow({ select: { id: true } })
    const season = await prisma.season.create({
      data: {
        competitionSeriesId: series.id, number: 970900, competitionYear: 2097,
        slug: `${MARK}-season`, lifecycleState: 'PLAYOFF_SETUP', lounge: 'Social', accessMode: 'OPEN',
        groupStageGames: 10, earlyRaceTo: 7, semifinalRaceTo: 9, finalRaceTo: 9,
      },
      select: { id: true },
    })
    const ent = async (name: string) => (await prisma.seasonEntrant.create({
      data: { seasonId: season.id, username: `${MARK}-${name}`, displayName: name, status: 'APPROVED' },
      select: { id: true },
    })).id
    const e1 = await ent('alpha')
    const e2 = await ent('beta')
    const m = await prisma.seasonPlayoffMatch.create({
      data: {
        seasonId: season.id, round: 1, slot: 0,
        homeEntrantId: e1, homeUsername: 'alpha',
        awayEntrantId: e2, awayUsername: 'beta',
      },
      select: { id: true },
    })

    const r = await setSeasonBracketSlot(ACTOR, season.id, m.id, 'away', e1)
    check('the Season move is accepted', r.ok, r.error ?? '')
    const after = await prisma.seasonPlayoffMatch.findUniqueOrThrow({
      where: { id: m.id },
      select: { homeEntrantId: true, awayEntrantId: true, homeUsername: true, awayUsername: true },
    })
    check('the two entrants exchanged sides',
      after.awayEntrantId === e1 && after.homeEntrantId === e2,
      `${after.homeUsername} / ${after.awayUsername}`)
    check('neither is duplicated', after.homeEntrantId !== after.awayEntrantId,
      `${after.homeEntrantId} / ${after.awayEntrantId}`)
    check('the names followed them',
      after.homeUsername === 'beta' && after.awayUsername === 'alpha',
      `${after.homeUsername} / ${after.awayUsername}`)

    await prisma.seasonPlayoffMatch.deleteMany({ where: { seasonId: season.id } })
    await prisma.seasonEntrant.deleteMany({ where: { seasonId: season.id } })
    await prisma.season.delete({ where: { id: season.id } })
  }

  // ── The audit still records what happened ─────────────────────────────────────────────────────
  section('A within-match swap is audited like any other move')
  {
    const { tid, regs, m3 } = await build()
    await setTournamentBracketSlot(ACTOR, tid, m3, 'away', regs[0].id)
    const entry = await prisma.auditLog.findFirst({
      where: { actorUsername: MARK, action: 'playoff.slot' }, orderBy: { id: 'desc' },
    })
    check('the move was audited', !!entry)
    check('...and is marked as a within-match swap',
      JSON.stringify(entry?.newValue ?? {}).includes('withinMatch'))
    await cleanup()
  }
} finally {
  await cleanup()
  await prisma.$disconnect()
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
