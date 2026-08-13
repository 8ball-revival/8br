/**
 * Verifies the TEAM bracket data layer that powers the redesigned bracket + team-details popover.
 * Pure test over `tournamentsFromCompRows` (adapter.ts) — no DB. Covers: roster attachment, CueVerse
 * ID → profile slug, captain flag, team average rating (ignoring missing ratings, null when all
 * missing), the team W–L record across bracket rounds (decided matches only), varied roster sizes,
 * long team names preserved in full (truncation is presentation-only), and that INDIVIDUAL (1v1)
 * tournaments attach NO roster/popover data.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-team-bracket.mts
 */
import { tournamentsFromCompRows, type CompRow, type TournamentBracketRow } from '../src/lib/tournaments/adapter.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n) } }

const LONG = 'The Extraordinarily Long Team Name That Absolutely Must Truncate In A Row'

function row(p: Partial<TournamentBracketRow> & { roundName: string; roundOrder: number; matchOrder: number }): TournamentBracketRow {
  return {
    bracketKind: 'MAIN', aPresent: true, aName: null, aHandle: null, aSeed: null, aScore: null,
    bPresent: true, bName: null, bHandle: null, bSeed: null, bScore: null, winner: null, note: null, ...p,
  }
}

const team = (name: string, members: { name: string; handle: string; captain?: boolean; rating: number | null }[]) => ({
  name,
  members: members.map((m, i) => ({ name: m.name, handle: m.handle, playerId: null, captain: !!m.captain, ratingAtClose: m.rating })),
})

// 4-team single-elim: Alpha & Charlie win the semis; Alpha beats Charlie in the final.
const teamComp: CompRow = {
  number: 1, name: 'Team Cup', tournamentFormat: 'SINGLE_ELIM', participantFormat: 'TEAM', teamSize: 2,
  lifecycleState: 'COMPLETED', status: 'COMPLETED', createdAt: new Date('2026-01-01T00:00:00Z'),
  entrantsCount: 4, currentRound: null, finalScore: '5-3',
  championName: 'Alpha', championHandle: null, runnerUpName: 'Charlie', runnerUpHandle: null,
  thirdPlaceName: null, thirdPlaceHandle: null,
  bracketMatches: [
    row({ roundName: 'Semifinals', roundOrder: 1, matchOrder: 1, aName: 'Alpha', aSeed: 1, aScore: 5, bName: 'Bravo', bSeed: 4, bScore: 2, winner: 'a' }),
    row({ roundName: 'Semifinals', roundOrder: 1, matchOrder: 2, aName: 'Charlie', aSeed: 2, aScore: 5, bName: LONG, bSeed: 3, bScore: 1, winner: 'a' }),
    row({ roundName: 'Final', roundOrder: 2, matchOrder: 1, aName: 'Alpha', aSeed: 1, aScore: 5, bName: 'Charlie', bSeed: 2, bScore: 3, winner: 'a' }),
  ],
  teams: [
    team('Alpha', [{ name: 'A1', handle: 'alphaone', captain: true, rating: 1600 }, { name: 'A2', handle: 'alphatwo', rating: 1400 }]),
    team('Bravo', [{ name: 'B1', handle: 'bravoone', captain: true, rating: null }, { name: 'B2', handle: 'bravotwo', rating: null }]),
    team('Charlie', [{ name: 'C1', handle: 'charlieone', captain: true, rating: 1500 }, { name: 'C2', handle: 'charlietwo', rating: 1500 }, { name: 'C3', handle: 'charliethree', rating: 1500 }]),
    team(LONG, [{ name: 'D1', handle: 'deltaone', captain: true, rating: 1550 }, { name: 'D2', handle: 'deltatwo', rating: null }]),
  ],
}

const [view] = tournamentsFromCompRows([teamComp])
const rounds = view.bracket ?? []
const slotByName = (name: string) => rounds.flatMap((r) => r.matches).flatMap((m) => [m.a, m.b]).find((s) => s?.name === name)

console.log('TEAM bracket enrichment')
const alpha = slotByName('Alpha')!
check('team slot carries roster members', alpha.members?.length === 2)
check('member exposes CueVerse ID as profile slug', alpha.members?.[0].slug === 'alphaone' && alpha.members?.[0].handle === 'alphaone')
check('captain flag preserved', alpha.members?.[0].captain === true && alpha.members?.[1].captain === false)
check('member rating = ratingAtClose', alpha.members?.[0].rating === 1600)
check('avg rating = mean of member ratings', alpha.avgRating === 1500)
check('Alpha record 2-0 across rounds', alpha.record === '2-0')

const charlie = slotByName('Charlie')!
check('roster size varies (3 members)', charlie.members?.length === 3)
check('Charlie record 1-1 (won SF, lost final)', charlie.record === '1-1')
check('Charlie avg = 1500', charlie.avgRating === 1500)

const bravo = slotByName('Bravo')!
check('all-missing ratings → avgRating null', bravo.avgRating === null)
check('missing rating stored as null (not omitted)', bravo.members?.[0].rating === null)
check('Bravo record 0-1', bravo.record === '0-1')

const delta = slotByName(LONG)!
check('partial ratings → avg over non-null only (1550)', delta.avgRating === 1550)
check('long team name preserved in full (no truncation in data)', delta.name === LONG)
check('losing SF team record 0-1', delta.record === '0-1')

// INDIVIDUAL (1v1) tournament: NO roster/popover data on slots.
const soloComp: CompRow = {
  ...teamComp, number: 2, name: 'Solo Cup', participantFormat: 'INDIVIDUAL', teamSize: null,
  championName: 'Neo', championHandle: 'starkiller', runnerUpName: 'Craig', runnerUpHandle: 'craig',
  bracketMatches: [row({ roundName: 'Final', roundOrder: 1, matchOrder: 1, aName: 'Neo', aHandle: 'starkiller', aScore: 5, bName: 'Craig', bHandle: 'craig', bScore: 4, winner: 'a' })],
  teams: [],
}
const [solo] = tournamentsFromCompRows([soloComp])
const neo = (solo.bracket ?? []).flatMap((r) => r.matches).flatMap((m) => [m.a, m.b]).find((s) => s?.name === 'Neo')!
console.log('\nINDIVIDUAL (1v1) — no popover data')
check('1v1 slot has NO members roster', neo.members === undefined)
check('1v1 slot has NO record', neo.record === undefined)
check('1v1 slot has NO avgRating', neo.avgRating === undefined)
check('1v1 keeps inline CueVerse ID (handle)', neo.handle === 'starkiller')

// Active/incomplete tournament: undecided matches contribute nothing to the record.
const activeComp: CompRow = {
  ...teamComp, number: 3, name: 'Live Cup', lifecycleState: 'IN_PROGRESS', status: 'LIVE',
  bracketMatches: [
    row({ roundName: 'Semifinals', roundOrder: 1, matchOrder: 1, aName: 'Alpha', aScore: 5, bName: 'Bravo', bScore: 2, winner: 'a' }),
    row({ roundName: 'Final', roundOrder: 2, matchOrder: 1, aName: 'Alpha', bName: 'Charlie', winner: null }), // not played yet
  ],
}
const [active] = tournamentsFromCompRows([activeComp])
const aAlpha = (active.bracket ?? []).flatMap((r) => r.matches).flatMap((m) => [m.a, m.b]).find((s) => s?.name === 'Alpha')!
console.log('\nACTIVE tournament — undecided matches ignored')
check('record counts only decided matches (Alpha 1-0)', aAlpha.record === '1-0')

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
