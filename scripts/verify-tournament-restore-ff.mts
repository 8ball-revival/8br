/**
 * The restored Tournament section, its Competition selector, and FF forfeiture.
 *
 * The mutating half builds a whole Tournament — entrants, bracket, results — inside a fixture, runs
 * the real services against it, and deletes it again. Nothing here touches a Season, an existing
 * Tournament, or any canonical record; the last section proves that.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-tournament-restore-ff.mts
 */
import { readFileSync, existsSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { parseForfeitField, interpretForfeit } from '../src/lib/competition/forfeit.ts'
import { listCompetitionOptions, resolveCompetitionId } from '../src/lib/competition/competition-options.ts'
import { createTournament } from '../src/lib/competition/tournament-create.ts'
import { recordPlayoffForfeit, recordPlayoffScore, verifyPlayoffMatch, undoPlayoffResult } from '../src/lib/competition/service.ts'

assertLocalDatabase('verify-tournament-restore-ff')

const TAG = 'zzverify-trn'
const ACTOR = { userId: 0, username: TAG }

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++ } else { fail++; console.log('  FAIL ' + n + (d ? ` — ${d}` : '')) }
}
const section = (s: string) => console.log(`\n${s}`)

async function cleanup() {
  const ts = await prisma.tournament.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } })
  const ids = ts.map((t) => t.id)
  if (ids.length) {
    await prisma.ratingLedger.deleteMany({ where: { tournamentId: { in: ids } } }).catch(() => {})
    await prisma.playoffMatch.deleteMany({ where: { tournamentId: { in: ids } } }).catch(() => {})
    await prisma.tournamentMatch.deleteMany({ where: { tournamentId: { in: ids } } }).catch(() => {})
    await prisma.standing.deleteMany({ where: { tournamentId: { in: ids } } }).catch(() => {})
    await prisma.tournamentGroup.deleteMany({ where: { tournamentId: { in: ids } } }).catch(() => {})
    await prisma.registration.deleteMany({ where: { tournamentId: { in: ids } } }).catch(() => {})
    await prisma.tournament.deleteMany({ where: { id: { in: ids } } }).catch(() => {})
  }
  const ps = await prisma.player.findMany({ where: { primaryName: { startsWith: TAG } }, select: { id: true } })
  if (ps.length) {
    await prisma.playerAlias.deleteMany({ where: { playerId: { in: ps.map((p) => p.id) } } }).catch(() => {})
    await prisma.player.deleteMany({ where: { id: { in: ps.map((p) => p.id) } } }).catch(() => {})
  }
  await prisma.auditLog.deleteMany({ where: { actorUsername: TAG } }).catch(() => {})
}

// ─────────────────────────────────────────────────────── routes and terminology (source-level)
section('The section is called Tournaments, and the old URLs still work')
{
  const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null)

  check('/tournaments has a page', read('src/app/(frontend)/tournaments/page.tsx') != null)
  check('/creator/tournaments/new has a page', read('src/app/(frontend)/creator/tournaments/new/page.tsx') != null)
  check('/tournaments/[number] has a page', read('src/app/(frontend)/tournaments/[number]/page.tsx') != null)
  check('the /cups pages are gone', read('src/app/(frontend)/cups/page.tsx') == null)

  /*
   * The redirect lives in next.config and NOWHERE else.
   *
   * A route handler under /tournaments pointing back at /cups is what caused the redirect loop that
   * made every public URL unreachable. Pinning both halves — the config entries exist, and no route
   * handler competes with them — is the only way that cannot come back unnoticed.
   */
  const cfg = read('next.config.ts') ?? ''
  check('/cups redirects to /tournaments', /source: '\/cups',\s*destination: '\/tournaments'/.test(cfg))
  check('...and so does every path under it', /source: '\/cups\/:path\*',\s*destination: '\/tournaments\/:path\*'/.test(cfg))
  check('...permanently', (cfg.match(/permanent: true/g) ?? []).length >= 2)
  check('no route handler competes with them', read('src/app/(frontend)/tournaments/route.ts') == null)
  check('...at any depth', read('src/app/(frontend)/tournaments/[number]/route.ts') == null)

  const nav = read('src/lib/nav.ts') ?? ''
  check('the navigation says Tournaments', nav.includes("{ label: 'Tournaments', href: '/tournaments' }"))
  check('...and no longer says Cups', !/label: 'Cups'/.test(nav))

  const list = read('src/app/(frontend)/tournaments/page.tsx') ?? ''
  check('the list page offers Create Tournament', list.includes('Create Tournament'))
  check('...only to the competition-management capability', list.includes("can('manage_competitions')"))
  check('...and links into the Tournaments section', list.includes('/tournaments/new'))

/*
 * The gate moved with the work.
 *
 * These routes are redirect stubs now: creating and editing a competition happens in Creator, and
 * Creator's own page enforces the capability. Asserting the check on the OLD file would be asserting
 * that a redirect guards something it no longer does, so the assertion follows the work.
 */
  const create = read('src/app/(frontend)/creator/tournaments/new/page.tsx') ?? ''
  /*
   * `requireCreator` IS the capability check.
   *
   * It resolves staff access, tests `manage_competitions`, and renders a not-found to everybody
   * else — so grepping for the capability string in the page would now assert the absence of a
   * helper rather than the presence of a guard. The named guard is the thing to look for.
   */
  check('creation re-checks the capability server-side', create.includes('requireCreator'))
  check('...and the legacy URL only forwards to it',
    (read('src/app/(frontend)/tournaments/new/page.tsx') ?? '').includes('/creator/tournaments/new'))

  const creatorNew = read('src/app/(frontend)/creator/new/page.tsx') ?? ''
  check('Creator sends Tournament creation here', creatorNew.includes("redirect('/tournaments/new')"))
}

// ───────────────────────────────────────────────────────────────── FF parsing (pure)
section('FF is read the way an administrator types it')
{
  check('FF', parseForfeitField('FF').kind === 'ff')
  check('lower case ff', parseForfeitField('ff').kind === 'ff')
  check('mixed case Ff', parseForfeitField('Ff').kind === 'ff')
  check('fF', parseForfeitField('fF').kind === 'ff')
  check('surrounding whitespace', parseForfeitField('  FF  ').kind === 'ff')
  check('a whitespace-padded lower-case ff', parseForfeitField(' ff ').kind === 'ff')
  check('a number is still a number', parseForfeitField('7').kind === 'number')
  check('zero is a number', parseForfeitField('0').kind === 'number')
  check('blank is blank', parseForfeitField('   ').kind === 'blank')
  check('anything else is refused', parseForfeitField('FFF').kind === 'invalid')
  check('...including a near miss', parseForfeitField('F').kind === 'invalid')
  check('...and a negative', parseForfeitField('-1').kind === 'invalid')

  const ok = { bothPresent: true }
  const h = interpretForfeit('FF', '', ok)
  check('FF on the home side forfeits home', h.kind === 'forfeit' && h.forfeiter === 'home')
  const a = interpretForfeit('', 'ff', ok)
  check('ff on the away side forfeits away', a.kind === 'forfeit' && a.forfeiter === 'away')
  check('the opponent does not have to type a number',
    interpretForfeit('FF', '   ', ok).kind === 'forfeit')

  const both = interpretForfeit('FF', 'FF', ok)
  check('both sides FF is refused', both.kind === 'invalid')
  check('...and says why', both.kind === 'invalid' && /both players cannot forfeit/i.test(both.error))

  const noOpp = interpretForfeit('FF', '', { bothPresent: false })
  check('FF with no opponent is refused', noOpp.kind === 'invalid')
  check('...because advancement cannot be determined',
    noOpp.kind === 'invalid' && /both players must be determined/i.test(noOpp.error))

  const sc = interpretForfeit('7', '3', ok)
  check('an ordinary score still parses', sc.kind === 'score' && sc.homeGames === 7 && sc.awayGames === 3)
  check('a half-filled score is refused', interpretForfeit('7', '', ok).kind === 'invalid')
  check('rubbish is refused', interpretForfeit('x', '3', ok).kind === 'invalid')
}

// ───────────────────────────────────────────────────── Competition selector (against the real table)
section('The Competition selector reads the canonical table')
{
  const opts = await listCompetitionOptions()
  const real = await prisma.competitionSeries.findMany({ select: { id: true, name: true } })
  check('every Competition is offered', opts.length === real.length, `${opts.length} vs ${real.length}`)
  check('...by their real names', opts.every((o) => real.some((r) => r.id === o.id && r.name === o.name)))
  check('...with nothing hardcoded', opts.every((o) => Number.isInteger(o.id) && o.name.length > 0))
  check('active Competitions come first',
    opts.every((o, i) => i === 0 || !(o.active && !opts[i - 1].active)))

  check('a real id resolves', real[0] ? (await resolveCompetitionId(real[0].id)) === real[0].id : true)
  check('...as a string too', real[0] ? (await resolveCompetitionId(String(real[0].id))) === real[0].id : true)
  check('an unknown id is refused', (await resolveCompetitionId(999_999_999)) === null)
  check('a non-number is refused', (await resolveCompetitionId('abc')) === null)
  check('null is refused', (await resolveCompetitionId(null)) === null)
  check('zero is refused', (await resolveCompetitionId(0)) === null)
  check('a negative is refused', (await resolveCompetitionId(-3)) === null)
}

// ──────────────────────────────────────────────────────────── the real workflow, end to end
async function main() {
  await cleanup()

  const comp = await prisma.competitionSeries.findFirst({ where: { active: true }, select: { id: true, name: true } })
  if (!comp) { check('a Competition exists to attach a Tournament to', false); return }

  section('Creating a Tournament requires a Competition, and keeps it')
  const bad = await createTournament(ACTOR, {
    name: `${TAG} rejected`, competitionSeriesId: 999_999_999,
    participantFormat: 'INDIVIDUAL', tournamentFormat: 'SINGLE_ELIM', raceLength: 5,
  })
  check('an invalid Competition is refused', bad.ok === false)
  check('...with a sentence, not a database error', /choose a competition/i.test(bad.error ?? ''), bad.error)
  check('...and nothing was created', (await prisma.tournament.count({ where: { name: `${TAG} rejected` } })) === 0)

  const made = await createTournament(ACTOR, {
    name: `${TAG} main`, competitionSeriesId: comp.id, competitionYear: 2026,
    participantFormat: 'INDIVIDUAL', tournamentFormat: 'SINGLE_ELIM', raceLength: 7,
  })
  check('a valid Competition is accepted', made.ok, made.error)
  if (!made.ok || made.id == null) return
  const tid = made.id
  const stored = await prisma.tournament.findUniqueOrThrow({
    where: { id: tid }, select: { competitionSeriesId: true, number: true, competitionSeries: { select: { name: true } } },
  })
  check('the Tournament keeps its Competition', stored.competitionSeriesId === comp.id)
  check('...resolvable by name', stored.competitionSeries?.name === comp.name)
  check('...and it was given a public number', stored.number != null)

  // Two Tournaments, same title, different Competitions — they must stay distinguishable.
  const other = await prisma.competitionSeries.findFirst({ where: { id: { not: comp.id } }, select: { id: true } })
  if (other) {
    const twin = await createTournament(ACTOR, {
      name: `${TAG} main`, competitionSeriesId: other.id, competitionYear: 2026,
      participantFormat: 'INDIVIDUAL', tournamentFormat: 'SINGLE_ELIM', raceLength: 7,
    })
    check('the same title under another Competition is allowed', twin.ok, twin.error)
    if (twin.ok && twin.id) {
      const both = await prisma.tournament.findMany({ where: { name: `${TAG} main` }, select: { competitionSeriesId: true } })
      check('...and the two are told apart by Competition',
        new Set(both.map((b) => b.competitionSeriesId)).size === 2)
    }
  }

  // ── A bracket to forfeit in ──────────────────────────────────────────────────────────────
  section('FF advances the opponent without giving them a win')
  const players = []
  for (const n of ['alpha', 'beta']) {
    players.push(await prisma.player.create({
      data: { primaryName: `${TAG} ${n}`, cueverseId: `${TAG}-${n}`, cueverseIdNormalized: `${TAG}-${n}`, active: true },
      select: { id: true, primaryName: true },
    }))
  }
  const regs = []
  for (const p of players) {
    regs.push(await prisma.registration.create({
      data: { tournamentId: tid, playerId: p.id, username: p.primaryName, displayName: p.primaryName, status: 'APPROVED' },
      select: { id: true, username: true },
    }))
  }
  await prisma.tournament.update({ where: { id: tid }, data: { lifecycleState: 'IN_PROGRESS', status: 'ACTIVE' } })

  // A final, and a round-2 slot for the winner to advance into — so advancement is observable.
  const next = await prisma.playoffMatch.create({
    data: { tournamentId: tid, round: 2, slot: 0, label: 'Final' }, select: { id: true },
  })
  const m = await prisma.playoffMatch.create({
    data: {
      tournamentId: tid, round: 1, slot: 0, label: 'Semifinal',
      homeRegistrationId: regs[0].id, awayRegistrationId: regs[1].id,
      homeUsername: regs[0].username, awayUsername: regs[1].username,
      feedsMatchId: next.id, feedsSlot: 0,
    },
    select: { id: true },
  })

  const ffRes = await recordPlayoffForfeit(ACTOR, m.id, 'home')
  check('the forfeit records', ffRes.ok, ffRes.error)
  await verifyPlayoffMatch(ACTOR, m.id)

  const after = await prisma.playoffMatch.findUniqueOrThrow({ where: { id: m.id } })
  check('the status says FORFEIT', after.status === 'FORFEIT', after.status)
  check('the forfeiting player is recorded', after.forfeitRegistrationId === regs[0].id)
  check('the opponent is the winner of record', after.winnerRegistrationId === regs[1].id)
  check('NO score was invented for the home side', after.homeGames === null)
  check('...nor the away side', after.awayGames === null)

  const downstream = await prisma.playoffMatch.findUniqueOrThrow({ where: { id: next.id } })
  check('the opponent advanced into the next round', downstream.homeRegistrationId === regs[1].id)
  check('...carrying their name', downstream.homeUsername === regs[1].username)
  check('the next match was NOT started for them', downstream.status === 'SCHEDULED')
  check('...and no winner was assumed', downstream.winnerRegistrationId === null)
  check('the Tournament was not completed', (await prisma.tournament.findUniqueOrThrow({ where: { id: tid }, select: { lifecycleState: true } })).lifecycleState === 'IN_PROGRESS')

  check('the forfeit is audited',
    (await prisma.auditLog.count({ where: { actorUsername: TAG, action: 'playoff.recordForfeit' } })) === 1)

  // ── A bye is not a forfeit ───────────────────────────────────────────────────────────────
  const byeMatch = await prisma.playoffMatch.create({
    data: { tournamentId: tid, round: 1, slot: 1, label: 'Bye slot', homeRegistrationId: regs[0].id, homeUsername: regs[0].username, awayUsername: 'Bye' },
    select: { id: true },
  })
  const byeFF = await recordPlayoffForfeit(ACTOR, byeMatch.id, 'home')
  check('a slot with a bye cannot be forfeited', byeFF.ok === false)
  check('...because there is nobody to advance', /both players must be determined/i.test(byeFF.error ?? ''), byeFF.error)
  check('...and the bye row is untouched',
    (await prisma.playoffMatch.findUniqueOrThrow({ where: { id: byeMatch.id } })).forfeitRegistrationId === null)

  // ── Statistics ───────────────────────────────────────────────────────────────────────────
  section('A forfeit changes nobody\u2019s record')
  const { getLadder } = await import('../src/lib/stats/ladder.ts')

  /*
   * Driven through the ledger rather than through a completed Tournament.
   *
   * The ledger IS the source of truth for every ranking figure — closing a Tournament only writes
   * rows into it. Writing the rows directly tests the rule at the exact place it has to hold, and
   * lets one played win sit beside one forfeit for the same player so the difference is visible in
   * a single number.
   */
  const ffPlayer = players[1].id
  const base = {
    tournamentId: tid, stage: 'PLAYOFF', roundLabel: 'Semifinal',
    playerId: ffPlayer, playerName: players[1].primaryName,
    opponentId: players[0].id, opponentName: players[0].primaryName,
    isTeamMatch: false, actual: 1, expected: 0.5,
    completedAt: new Date('2026-06-01T12:00:00Z'),
  }
  await prisma.ratingLedger.create({
    data: { ...base, matchKey: `${TAG}-played`, result: 'WIN', isForfeit: false,
      preRating: 1500, ratingChange: 16, postRating: 1516, sequence: 1 },
  })
  await prisma.ratingLedger.create({
    data: { ...base, matchKey: `${TAG}-forfeit`, result: 'WIN', isForfeit: true,
      preRating: 1516, ratingChange: 0, postRating: 1516, sequence: 2 },
  })

  const ladder = await getLadder('all-time')
  const row = ladder.find((r) => r.playerId === ffPlayer)
  check('the player appears on the ladder', row != null)
  if (row) {
    check('only the PLAYED win counts', row.wins === 1, `wins=${row.wins}`)
    check('the forfeit adds no loss either', row.losses === 0, `losses=${row.losses}`)
    check('the forfeit does not extend the winning streak', row.streak === 1, `streak=${row.streak}`)
    check('the rating is unchanged by the forfeit', row.rating === 1516, String(row.rating))
  }

  // And the forfeit is still on the record — it is not silently dropped.
  check('the forfeit row is preserved for display and audit',
    (await prisma.ratingLedger.count({ where: { matchKey: `${TAG}-forfeit`, isForfeit: true } })) === 1)
  check('...carrying no rating movement',
    (await prisma.ratingLedger.findFirstOrThrow({ where: { matchKey: `${TAG}-forfeit` } })).ratingChange === 0)

  await prisma.ratingLedger.deleteMany({ where: { matchKey: { startsWith: TAG } } })

  // ── Correction: FF → numeric ─────────────────────────────────────────────────────────────
  section('An administrator can correct a forfeit in both directions')
  const toScore = await recordPlayoffScore(ACTOR, m.id, 7, 3)
  check('a forfeit can be replaced by a real score', toScore.ok, toScore.error)
  const corrected = await prisma.playoffMatch.findUniqueOrThrow({ where: { id: m.id } })
  check('the forfeit mark is cleared', corrected.forfeitRegistrationId === null)
  check('the status is an ordinary result again', corrected.status === 'COMPLETED')
  check('the score is stored', corrected.homeGames === 7 && corrected.awayGames === 3)
  check('the winner changed to the higher score', corrected.winnerRegistrationId === regs[0].id)

  await verifyPlayoffMatch(ACTOR, m.id)
  const down2 = await prisma.playoffMatch.findUniqueOrThrow({ where: { id: next.id } })
  check('the downstream slot now holds the corrected winner', down2.homeRegistrationId === regs[0].id)
  check('...and not both players', down2.awayRegistrationId === null)

  // ── Correction: numeric → FF ─────────────────────────────────────────────────────────────
  const backToFF = await recordPlayoffForfeit(ACTOR, m.id, 'away')
  check('a real score can be replaced by a forfeit', backToFF.ok, backToFF.error)
  await verifyPlayoffMatch(ACTOR, m.id)
  const reverted = await prisma.playoffMatch.findUniqueOrThrow({ where: { id: m.id } })
  check('the invented score is gone', reverted.homeGames === null && reverted.awayGames === null)
  check('the new forfeiter is recorded', reverted.forfeitRegistrationId === regs[1].id)
  check('the other player advances', reverted.winnerRegistrationId === regs[0].id)
  const down3 = await prisma.playoffMatch.findUniqueOrThrow({ where: { id: next.id } })
  check('...and the downstream slot follows', down3.homeRegistrationId === regs[0].id)

  // ── Idempotency ──────────────────────────────────────────────────────────────────────────
  const repeat1 = await recordPlayoffForfeit(ACTOR, m.id, 'away')
  const repeat2 = await recordPlayoffForfeit(ACTOR, m.id, 'away')
  check('repeating the same correction succeeds', repeat1.ok && repeat2.ok)
  const stable = await prisma.playoffMatch.findUniqueOrThrow({ where: { id: m.id } })
  check('...and changes nothing', stable.forfeitRegistrationId === regs[1].id && stable.winnerRegistrationId === regs[0].id)
  check('...leaving one downstream occupant',
    (await prisma.playoffMatch.findUniqueOrThrow({ where: { id: next.id } })).homeRegistrationId === regs[0].id)
  check('the bracket did not grow', (await prisma.playoffMatch.count({ where: { tournamentId: tid } })) === 3)

  // ── Undo ─────────────────────────────────────────────────────────────────────────────────
  const undone = await undoPlayoffResult(ACTOR, m.id)
  check('a forfeit can be undone', undone.ok, undone.error)
  const clean = await prisma.playoffMatch.findUniqueOrThrow({ where: { id: m.id } })
  check('...clearing the forfeit mark', clean.forfeitRegistrationId === null)
  check('...the winner', clean.winnerRegistrationId === null)
  check('...and the status', clean.status === 'SCHEDULED')
}

main()
  .catch((e) => { fail++; console.log('  FAIL threw: ' + (e instanceof Error ? e.stack ?? e.message : String(e))) })
  .finally(async () => {
    await cleanup()

    section('Nothing canonical moved')
    const s = await prisma.season.findUnique({
      where: { id: 3732 },
      select: { championName: true, lifecycleState: true, _count: { select: { entrants: true, matches: true, playoffMatches: true, ratingLedger: true } } },
    })
    check('Season 3732 still has its champion', s?.championName === 'Adnan')
    check('...49 entrants', s?._count.entrants === 49)
    check('...147 matches', s?._count.matches === 147)
    check('...31 playoff matches', s?._count.playoffMatches === 31)
    check('...and 250 ledger rows', s?._count.ratingLedger === 250)
    check('all 88 archive shells are present',
      (await prisma.season.count({ where: { archiveTemplateKey: { not: null } } })) === 88)
    check('the 2006 shared-stage rule is unchanged', (() => {
      const m = JSON.parse(readFileSync('src/lib/archive/data/8brcam-manifest.json', 'utf8'))
      return m.entries.filter((e: { sharedGroupStageSourceKey?: string }) => e.sharedGroupStageSourceKey).length === 4
    })())
    check('every fixture was removed',
      (await prisma.tournament.count({ where: { name: { startsWith: TAG } } })) === 0 &&
      (await prisma.player.count({ where: { primaryName: { startsWith: TAG } } })) === 0)

    console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
    await prisma.$disconnect()
    process.exit(fail === 0 ? 0 : 1)
  })
