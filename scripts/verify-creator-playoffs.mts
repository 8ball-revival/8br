/**
 * The playoff bracket: who is in it, where they sit, and what has to be true before it goes public.
 *
 * ── The rule this is really about ────────────────────────────────────────────────────────────────
 * A bracket position is either one a person fills or one the bracket fills for them, and the second
 * kind must never be assignable by hand. Directly seating somebody in a fed position is not a
 * cosmetic error: the slot is overwritten the moment its feeder resolves, so the placement appears
 * to work and then silently disappears — and until then the bracket shows a player in a tie they
 * never qualified for.
 *
 * The classification is structural, not "round one": a double-elimination losers' bracket takes
 * entrants in later rounds, and a grand final takes none at all.
 *
 * ── And what Start actually checks ───────────────────────────────────────────────────────────────
 * Readiness is recomputed inside the publishing transaction, not trusted from the page. Between a
 * page rendering and its button being pressed, another administrator may have changed the field.
 *
 * Fixtures only, all removed afterwards. No real Season is touched.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-creator-playoffs.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { createDraft } from '../src/lib/creator/setup.ts'
import { addSeasonEntrant, closeRegistration } from '../src/lib/seasons/service.ts'
import { transitionSeasonState } from '../src/lib/seasons/lifecycle.ts'
import { generateSeasonGroups, publishSeasonGroups } from '../src/lib/seasons/groups.ts'
import { saveSeasonGroupResults, closeSeasonGroups } from '../src/lib/seasons/group-stage.ts'
import {
  enterSeasonPlayoffSetup, loadSeasonSeeding, generateSeasonBracket, startSeasonPlayoffs,
  setSeasonPlayoffIncluded, setSeasonBracketSlot, swapSeasonBracketSlots, setSeasonPlayoffType,
} from '../src/lib/seasons/playoffs.ts'
import {
  bracketTopology, startReadiness, slotKey, smallestBracketFor, BRACKET_SIZES,
} from '../src/lib/seasons/playoff-topology.ts'
import { currentStage, stageReachable } from '../src/lib/creator/workflow.ts'

assertLocalDatabase()

const ACTOR = { userId: 2, username: 'verify-creator-playoffs' }
const YEAR = 2091
let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

const series = await prisma.competitionSeries.findFirstOrThrow({ select: { id: true } })

async function cleanup() {
  const rows = await prisma.season.findMany({ where: { competitionYear: YEAR }, select: { id: true } })
  for (const r of rows) {
    await prisma.seasonPlayoffMatch.deleteMany({ where: { seasonId: r.id } })
    await prisma.seasonMatch.deleteMany({ where: { seasonId: r.id } })
    await prisma.seasonStanding.deleteMany({ where: { seasonId: r.id } })
    await prisma.seasonGroup.deleteMany({ where: { seasonId: r.id } })
    await prisma.seasonEntrant.deleteMany({ where: { seasonId: r.id } })
    await prisma.season.delete({ where: { id: r.id } }).catch(() => {})
  }
}
await cleanup()

const pool = await prisma.player.findMany({ where: { active: true }, take: 8, select: { id: true } })

/** A Season carried all the way to PLAYOFF_SETUP with a played group stage. */
async function seasonAtPlayoffSetup(number: number, players: number): Promise<number> {
  const made = await createDraft(ACTOR, {
    type: 'season', competitionYear: YEAR, competitionSeriesId: series.id, purpose: 'live',
    structure: 'groups_playoffs', number, division: null, accessMode: 'OPEN',
  })
  if (!made.ok || made.id == null) throw new Error(made.error ?? 'fixture failed')
  const id = made.id
  for (const p of pool.slice(0, players)) await addSeasonEntrant(ACTOR, id, p.id)
  await closeRegistration(ACTOR, id)
  await transitionSeasonState(ACTOR, id, 'GROUP_SETUP')
  await generateSeasonGroups(ACTOR, id, 2)
  await publishSeasonGroups(ACTOR, id)

  // Play every fixture so the standings — and therefore the seeding — are real.
  const groups = await prisma.seasonGroup.findMany({ where: { seasonId: id }, select: { id: true } })
  for (const g of groups) {
    const ms = await prisma.seasonMatch.findMany({ where: { seasonId: id, groupId: g.id }, orderBy: { id: 'asc' } })
    await saveSeasonGroupResults(ACTOR, id, g.id, ms.map((m, i) => ({
      matchId: m.id, home: String(7), away: String(i % 6), version: m.version,
    })))
  }
  await closeSeasonGroups(ACTOR, id)
  const entered = await enterSeasonPlayoffSetup(ACTOR, id)
  if (!entered.ok) throw new Error(entered.error)
  return id
}

try {
  check('eight players are available', pool.length === 8, `${pool.length}`)

  section('Bracket sizes are the offered ones, and the smallest that fits')
  check('the offered sizes are the powers of two up to 128',
    JSON.stringify(BRACKET_SIZES) === JSON.stringify([2, 4, 8, 16, 32, 64, 128]))
  check('2 players fit a bracket of 2', smallestBracketFor(2) === 2)
  check('3 players need 4', smallestBracketFor(3) === 4)
  check('8 players fit 8 exactly', smallestBracketFor(8) === 8)
  check('9 players need 16', smallestBracketFor(9) === 16)
  check('129 players fit nothing offered', smallestBracketFor(129) === null)

  section('Seeding order comes from the group results')
  const s1 = await seasonAtPlayoffSetup(1, 8)
  check('the stage is playoffs', currentStage('season', 'PLAYOFF_SETUP') === 'playoffs')
  check('groups remain reachable behind it', stageReachable('season', 'PLAYOFF_SETUP', 'groups'))
  const seeding = await loadSeasonSeeding(s1)
  check('every entrant is listed', seeding.length === 8, `${seeding.length}`)
  check('seeds are 1..8 with no gaps',
    JSON.stringify(seeding.map((r) => r.overallSeed)) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8]),
    JSON.stringify(seeding.map((r) => r.overallSeed)))
  check('group winners seed above runners-up',
    seeding[0].groupPosition <= seeding[2].groupPosition)
  check('every row carries what the table shows',
    seeding.every((r) => typeof r.group === 'string' && typeof r.points === 'number' && /^\d+-\d+-\d+$/.test(r.record)))
  check('everybody starts selected', seeding.every((r) => r.included))

  section('Manual selection overrides it, without moving anyone\'s seed')
  const dropped = seeding[3]
  const off = await setSeasonPlayoffIncluded(ACTOR, s1, dropped.entrantId, false)
  check('a participant can be unselected', off.ok === true, off.error)
  const afterDrop = await loadSeasonSeeding(s1)
  check('...and is no longer included', afterDrop.find((r) => r.entrantId === dropped.entrantId)?.included === false)
  check('...and the seeding order is unchanged',
    JSON.stringify(afterDrop.map((r) => r.entrantId)) === JSON.stringify(seeding.map((r) => r.entrantId)))
  check('...including their own seed',
    afterDrop.find((r) => r.entrantId === dropped.entrantId)?.overallSeed === dropped.overallSeed)
  await setSeasonPlayoffIncluded(ACTOR, s1, dropped.entrantId, true)

  section('Generate builds a private draft, and nothing else')
  const gen = await generateSeasonBracket(ACTOR, s1)
  check('it generates', gen.ok === true, gen.error)
  check('...at the smallest size that fits', gen.size === 8, String(gen.size))
  check('...creating a full single-elimination tree',
    (await prisma.seasonPlayoffMatch.count({ where: { seasonId: s1 } })) === 7,
    String(await prisma.seasonPlayoffMatch.count({ where: { seasonId: s1 } })))
  check('nothing is published',
    (await prisma.seasonPlayoffMatch.count({ where: { seasonId: s1, published: true } })) === 0)
  check('no result was written',
    (await prisma.seasonPlayoffMatch.count({ where: { seasonId: s1, winnerEntrantId: { not: null } } })) === 0)
  check('the Season has not moved',
    (await prisma.season.findUniqueOrThrow({ where: { id: s1 }, select: { lifecycleState: true } })).lifecycleState === 'PLAYOFF_SETUP')

  const topo = await bracketTopology(s1)
  check('a bracket of 8 has 8 entry positions', topo.entrySlots.length === 8, `${topo.entrySlots.length}`)
  check('...all in round one', topo.entrySlots.every((s) => s.round === 1))
  check('...and the other 6 positions are fed by play', topo.derived.length === 6, `${topo.derived.length}`)
  check('every selected entrant appears exactly once',
    new Set(topo.entrySlots.map((s) => s.entrantId).filter(Boolean)).size === 8)

  section('Regenerating is safe and does not accumulate')
  const again = await generateSeasonBracket(ACTOR, s1)
  check('it regenerates', again.ok === true, again.error)
  check('...with the same match count',
    (await prisma.seasonPlayoffMatch.count({ where: { seasonId: s1 } })) === 7)

  section('An explicit larger size is honoured; a too-small one is refused')
  const big = await generateSeasonBracket(ACTOR, s1, { size: 16 })
  check('a bracket of 16 for 8 players is allowed', big.ok === true, big.error)
  check('...and reports that size', big.size === 16, String(big.size))
  const topo16 = await bracketTopology(s1)
  check('...with 16 entry positions', topo16.entrySlots.length === 16, `${topo16.entrySlots.length}`)
  check('...8 of them byes', topo16.entrySlots.filter((s) => s.entrantId == null).length === 8,
    String(topo16.entrySlots.filter((s) => s.entrantId == null).length))
  check('...and every player still placed exactly once',
    new Set(topo16.entrySlots.map((s) => s.entrantId).filter(Boolean)).size === 8)

  const tooSmall = await generateSeasonBracket(ACTOR, s1, { size: 4 })
  check('a bracket of 4 for 8 players is refused', tooSmall.ok === false, JSON.stringify(tooSmall))
  check('...saying why', /cannot hold/i.test(tooSmall.error ?? ''), tooSmall.error)
  const notOffered = await generateSeasonBracket(ACTOR, s1, { size: 6 })
  check('an unoffered size is refused', notOffered.ok === false, JSON.stringify(notOffered))

  // Back to the natural size for the remaining checks.
  await generateSeasonBracket(ACTOR, s1)

  section('A fed position cannot be filled by hand')
  const all = await prisma.seasonPlayoffMatch.findMany({ where: { seasonId: s1 }, orderBy: [{ round: 'asc' }, { slot: 'asc' }] })
  const round2 = all.find((m) => m.round === 2)!
  const fedSide: 'home' | 'away' =
    (await bracketTopology(s1)).entryKeys.has(slotKey(round2.id, 'home')) ? 'away' : 'home'
  const someone = (await loadSeasonSeeding(s1))[0]
  const fedSet = await setSeasonBracketSlot(ACTOR, s1, round2.id, fedSide, someone.entrantId)
  check('setting a fed position is refused', fedSet.ok === false, JSON.stringify(fedSet))
  check('...saying it is decided by an earlier match',
    /decided by an earlier match/i.test(fedSet.error ?? ''), fedSet.error)
  const stillEmpty = await prisma.seasonPlayoffMatch.findUniqueOrThrow({ where: { id: round2.id } })
  check('...and it stayed empty',
    (fedSide === 'home' ? stillEmpty.homeEntrantId : stillEmpty.awayEntrantId) === null)

  const r1 = all.filter((m) => m.round === 1)
  const fedSwap = await swapSeasonBracketSlots(ACTOR, s1,
    { matchId: r1[0].id, side: 'home' }, { matchId: round2.id, side: fedSide })
  check('swapping into a fed position is refused', fedSwap.ok === false, JSON.stringify(fedSwap))

  section('Swapping two entry positions exchanges players, not slot numbers')
  const beforeA = await prisma.seasonPlayoffMatch.findUniqueOrThrow({ where: { id: r1[0].id } })
  const beforeB = await prisma.seasonPlayoffMatch.findUniqueOrThrow({ where: { id: r1[1].id } })
  const swapped = await swapSeasonBracketSlots(ACTOR, s1,
    { matchId: r1[0].id, side: 'home' }, { matchId: r1[1].id, side: 'away' })
  check('the swap succeeds', swapped.ok === true, swapped.error)
  const afterA = await prisma.seasonPlayoffMatch.findUniqueOrThrow({ where: { id: r1[0].id } })
  const afterB = await prisma.seasonPlayoffMatch.findUniqueOrThrow({ where: { id: r1[1].id } })
  check('the players exchanged places',
    afterA.homeEntrantId === beforeB.awayEntrantId && afterB.awayEntrantId === beforeA.homeEntrantId)
  check('the slot numbers did not move', afterA.slot === beforeA.slot && afterB.slot === beforeB.slot)
  check('the round numbers did not move', afterA.round === beforeA.round && afterB.round === beforeB.round)
  check('nobody was duplicated',
    new Set((await bracketTopology(s1)).entrySlots.map((s) => s.entrantId).filter(Boolean)).size === 8)
  check('nobody was lost',
    (await bracketTopology(s1)).entrySlots.filter((s) => s.entrantId != null).length === 8)

  section('Start readiness names every unmet condition')
  const ready = await startReadiness(s1)
  check('a complete draft is ready', ready.ok === true, JSON.stringify(ready.problems))
  check('...reporting the field size', ready.included === 8 && ready.placed === 8)
  check('...and no byes at this size', ready.byes === 0, `${ready.byes}`)

  /*
   * Changing the field discards the draft, rather than leaving a bracket built around a selection
   * that no longer exists. So the honest check is that Start refuses because there is no bracket,
   * not because somebody is stranded in one.
   */
  const orphan = (await loadSeasonSeeding(s1))[2]
  await setSeasonPlayoffIncluded(ACTOR, s1, orphan.entrantId, false)
  check('unticking a participant discards the draft',
    (await prisma.seasonPlayoffMatch.count({ where: { seasonId: s1 } })) === 0)
  const afterUntick = await startReadiness(s1)
  check('...so Start is not ready', afterUntick.ok === false)
  check('...because the bracket is gone',
    afterUntick.problems.some((p) => /No bracket/i.test(p)), JSON.stringify(afterUntick.problems))
  const refusedStart = await startSeasonPlayoffs(ACTOR, s1)
  check('...and Start itself refuses', refusedStart.ok === false, JSON.stringify(refusedStart))
  check('...leaving the Season in setup',
    (await prisma.season.findUniqueOrThrow({ where: { id: s1 }, select: { lifecycleState: true } })).lifecycleState === 'PLAYOFF_SETUP')
  check('...and nothing published',
    (await prisma.seasonPlayoffMatch.count({ where: { seasonId: s1, published: true } })) === 0)
  await setSeasonPlayoffIncluded(ACTOR, s1, orphan.entrantId, true)
  await generateSeasonBracket(ACTOR, s1)

  /*
   * The stranded-player and duplicate conditions, written straight to the rows.
   *
   * Creator cannot produce either — the selection invalidates the draft, and the slot setter swaps
   * rather than duplicates. They come from imports and hand-edited data, which is exactly why Start
   * recomputes from the database instead of trusting the workflow that got here.
   */
  const strandedTarget = (await bracketTopology(s1)).entrySlots.find((x) => x.entrantId != null)!
  await prisma.seasonEntrant.update({ where: { id: strandedTarget.entrantId! }, data: { playoffIncluded: false } })
  const stranded = await startReadiness(s1)
  check('a player in the bracket but not selected blocks Start', stranded.ok === false)
  check('...and is named', stranded.problems.some((p) => /not selected/i.test(p)), JSON.stringify(stranded.problems))
  const strandedStart = await startSeasonPlayoffs(ACTOR, s1)
  check('...and Start refuses inside its transaction', strandedStart.ok === false, JSON.stringify(strandedStart))
  check('...publishing nothing',
    (await prisma.seasonPlayoffMatch.count({ where: { seasonId: s1, published: true } })) === 0)
  await prisma.seasonEntrant.update({ where: { id: strandedTarget.entrantId! }, data: { playoffIncluded: true } })

  const slots = (await bracketTopology(s1)).entrySlots
  const victim = slots.find((x) => x.entrantId != null)!
  const other = slots.find((x) => x.entrantId != null && x.matchId !== victim.matchId)!
  await prisma.seasonPlayoffMatch.update({
    where: { id: other.matchId },
    data: other.side === 'home'
      ? { homeEntrantId: victim.entrantId, homeUsername: victim.entrantName }
      : { awayEntrantId: victim.entrantId, awayUsername: victim.entrantName },
  })
  const dupe = await startReadiness(s1)
  check('the same player in two positions blocks Start', dupe.ok === false)
  check('...naming the duplicate', dupe.problems.some((p) => /more than one position/i.test(p)), JSON.stringify(dupe.problems))
  check('...and the player they displaced as unplaced',
    dupe.problems.some((p) => /no bracket position/i.test(p)), JSON.stringify(dupe.problems))
  const dupeStart = await startSeasonPlayoffs(ACTOR, s1)
  check('...and Start refuses', dupeStart.ok === false, JSON.stringify(dupeStart))

  // A player sitting where the bracket decides, which publishing would show and then overwrite.
  await generateSeasonBracket(ACTOR, s1)
  const r2 = await prisma.seasonPlayoffMatch.findFirstOrThrow({ where: { seasonId: s1, round: 2 } })
  const anyone = (await bracketTopology(s1)).entrySlots.find((x) => x.entrantId != null)!
  await prisma.seasonPlayoffMatch.update({
    where: { id: r2.id }, data: { homeEntrantId: anyone.entrantId, homeUsername: anyone.entrantName },
  })
  const fedOccupied = await startReadiness(s1)
  check('a player in a position decided by play blocks Start', fedOccupied.ok === false)
  check('...and is named',
    fedOccupied.problems.some((p) => /decided by play/i.test(p)), JSON.stringify(fedOccupied.problems))
  await generateSeasonBracket(ACTOR, s1)
  check('regenerating clears all of it',
    (await startReadiness(s1)).ok === true, JSON.stringify((await startReadiness(s1)).problems))

  section('Start publishes, advances byes, and awards no competitive win for one')
  const s2 = await seasonAtPlayoffSetup(2, 6)
  await generateSeasonBracket(ACTOR, s2, { size: 8 })
  const topoBye = await bracketTopology(s2)
  check('a field of 6 in a bracket of 8 leaves 2 byes',
    topoBye.entrySlots.filter((s) => s.entrantId == null).length === 2,
    String(topoBye.entrySlots.filter((s) => s.entrantId == null).length))
  check('no bye has been advanced yet',
    (await prisma.seasonPlayoffMatch.count({ where: { seasonId: s2, winnerEntrantId: { not: null } } })) === 0)

  const started = await startSeasonPlayoffs(ACTOR, s2)
  check('the playoffs start', started.ok === true, started.error)
  check('the Season is live',
    (await prisma.season.findUniqueOrThrow({ where: { id: s2 }, select: { lifecycleState: true } })).lifecycleState === 'PLAYOFFS_LIVE')
  check('every match is published',
    (await prisma.seasonPlayoffMatch.count({ where: { seasonId: s2, published: false } })) === 0)

  const byeWins = await prisma.seasonPlayoffMatch.findMany({
    where: { seasonId: s2, winnerEntrantId: { not: null } },
    select: { homeEntrantId: true, awayEntrantId: true, homeGames: true, awayGames: true, status: true },
  })
  check('the byes advanced', byeWins.length === 2, `${byeWins.length}`)
  check('...with no score recorded', byeWins.every((m) => m.homeGames == null && m.awayGames == null))
  check('...against an empty opponent',
    byeWins.every((m) => m.homeEntrantId == null || m.awayEntrantId == null))

  section('Placement locks once the bracket is public')
  const liveR1 = await prisma.seasonPlayoffMatch.findFirstOrThrow({ where: { seasonId: s2, round: 1 } })
  const lockedSet = await setSeasonBracketSlot(ACTOR, s2, liveR1.id, 'home', null)
  check('placement is refused', lockedSet.ok === false, JSON.stringify(lockedSet))
  const lockedGen = await generateSeasonBracket(ACTOR, s2)
  check('regenerating is refused', lockedGen.ok === false, JSON.stringify(lockedGen))
  const lockedType = await setSeasonPlayoffType(ACTOR, s2, true)
  check('changing the bracket type is refused', lockedType.ok === false, JSON.stringify(lockedType))

  section('Starting twice is refused rather than repeated')
  const twice = await startSeasonPlayoffs(ACTOR, s2)
  check('the second start is refused', twice.ok === false, JSON.stringify(twice))
  check('...and no extra winner appeared',
    (await prisma.seasonPlayoffMatch.count({ where: { seasonId: s2, winnerEntrantId: { not: null } } })) === 2)

  section('Double elimination classifies its own entry positions')
  const s3 = await seasonAtPlayoffSetup(3, 4)
  const de = await setSeasonPlayoffType(ACTOR, s3, true)
  check('the type can be set during setup', de.ok === true, de.error)
  const genDe = await generateSeasonBracket(ACTOR, s3)
  check('a double-elimination draft generates', genDe.ok === true, genDe.error)
  const topoDe = await bracketTopology(s3)
  check('it has more matches than a single-elimination bracket of the same size',
    topoDe.matches > 3, `${topoDe.matches}`)
  check('exactly four entry positions, all in the winners bracket',
    topoDe.entrySlots.length === 4 && topoDe.entrySlots.every((s) => s.section === 'WB'),
    `${topoDe.entrySlots.length} / ${[...new Set(topoDe.entrySlots.map((s) => s.section))].join(',')}`)
  check('every losers-bracket position is fed by play',
    topoDe.derived.length === topoDe.matches * 2 - topoDe.entrySlots.length,
    `${topoDe.derived.length} derived`)
  const deReady = await startReadiness(s3)
  check('...and the draft is ready to start', deReady.ok === true, JSON.stringify(deReady.problems))

  section('Changing the bracket type invalidates the draft')
  const backToSingle = await setSeasonPlayoffType(ACTOR, s3, false)
  check('the type changes', backToSingle.ok === true, backToSingle.error)
  check('...and the old draft is gone rather than reinterpreted',
    (await prisma.seasonPlayoffMatch.count({ where: { seasonId: s3 } })) === 0,
    String(await prisma.seasonPlayoffMatch.count({ where: { seasonId: s3 } })))
  const notReady = await startReadiness(s3)
  check('...so Start is not ready', notReady.ok === false)
  check('...because there is no bracket',
    notReady.problems.some((p) => /No bracket/i.test(p)), JSON.stringify(notReady.problems))

  section('Two participants is the floor')
  const s4 = await seasonAtPlayoffSetup(4, 4)
  const seeds4 = await loadSeasonSeeding(s4)
  for (const r of seeds4.slice(1)) await setSeasonPlayoffIncluded(ACTOR, s4, r.entrantId, false)
  const one = await generateSeasonBracket(ACTOR, s4)
  check('a bracket of one is refused', one.ok === false, JSON.stringify(one))
  const lonely = await startReadiness(s4)
  check('...and readiness says so', lonely.problems.some((p) => /at least two/i.test(p)), JSON.stringify(lonely.problems))
} finally {
  await cleanup()
  check('every fixture Season is removed',
    (await prisma.season.count({ where: { competitionYear: YEAR } })) === 0)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
