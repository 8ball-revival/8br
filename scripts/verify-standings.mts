/**
 * Verifies the SINGLE centralized standings comparator (computeStandings) — the one order used by the
 * public crosstable, admin views, previews, and playoff seeding. Points: Win = 2, Draw = 1, +1 for
 * completing all scheduled sets. Tiebreakers: Points, then head-to-head, then win percentage, then
 * name. Pure — no DB.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-standings.mts
 */
import { computeStandings, type StandingMatchInput } from '../src/lib/competition/standings.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n) } }

const P = (ids: string[]) => ids.map((u, i) => ({ registrationId: i + 1, username: u }))
const id = (roster: { registrationId: number; username: string }[], u: string) => roster.find((r) => r.username === u)!.registrationId
/** A decided match: `home` beat `away` hg–ag. */
function M(roster: { registrationId: number; username: string }[], home: string, away: string, hg: number, ag: number): StandingMatchInput {
  const h = id(roster, home), a = id(roster, away)
  return { homeRegistrationId: h, awayRegistrationId: a, homeUsername: home, awayUsername: away, homeGames: hg, awayGames: ag, winnerRegistrationId: hg > ag ? h : a }
}
/** A drawn match: `p1` vs `p2`, both `g` games, no winner. */
function D(roster: { registrationId: number; username: string }[], p1: string, p2: string, g: number): StandingMatchInput {
  return { homeRegistrationId: id(roster, p1), awayRegistrationId: id(roster, p2), homeUsername: p1, awayUsername: p2, homeGames: g, awayGames: g, winnerRegistrationId: null }
}
const order = (rows: ReturnType<typeof computeStandings>) => rows.map((r) => r.username)
const row = (rows: ReturnType<typeof computeStandings>, u: string) => rows.find((x) => x.username === u)!

console.log('Points formula — Win = 2, +1 completion')
{
  const r = P(['b', 'a', 'c']) // not alphabetical / not seed order
  const rows = computeStandings(r, [M(r, 'a', 'b', 7, 3), M(r, 'a', 'c', 7, 1), M(r, 'b', 'c', 7, 4)], 2)
  check('order by points: a, b, c', order(rows).join(',') === 'a,b,c')
  check('a (2 wins, completed) = 2·2 + 1 = 5 pts', row(rows, 'a').points === 5)
  check('b (1 win, completed) = 2 + 1 = 3 pts', row(rows, 'b').points === 3)
  check('c (0 wins, completed) = 0 + 1 = 1 pt', row(rows, 'c').points === 1)
  check('ranks 1..n', rows.map((x) => x.rank).join(',') === '1,2,3')
  check('top-N flagged qualified', rows[0].qualified && rows[1].qualified && !rows[2].qualified)
}

console.log('\nDraw = 1 point')
{
  const r = P(['a', 'b', 'c'])
  // a drew b (5–5); a beat c; b lost to c. All completed.
  const rows = computeStandings(r, [D(r, 'a', 'b', 5), M(r, 'a', 'c', 7, 2), M(r, 'c', 'b', 7, 3)], 2)
  check('a: draw(1) + win(2) + completion(1) = 4', row(rows, 'a').points === 4)
  check('b: draw(1) + loss(0) + completion(1) = 2', row(rows, 'b').points === 2)
  check('draw is recorded (a has 1 draw)', row(rows, 'a').draws === 1)
}

console.log('\nCompletion bonus — completing all sets adds a point')
{
  const r = P(['a', 'b', 'c']) // full slate = 2 matches each
  // a beat b (a played only 1 of 2 → incomplete). b beat c (b played both → completed).
  const rows = computeStandings(r, [M(r, 'a', 'b', 7, 5), M(r, 'b', 'c', 7, 5)], 2)
  const a = row(rows, 'a'), b = row(rows, 'b')
  check('a: 1 win, incomplete (played 1 of 2) → 2 pts', a.points === 2)
  check('b: 1 win, completed all sets → 2 + 1 = 3 pts', b.points === 3)
  check('completed b ranks above equal-wins-but-incomplete a', b.rank < a.rank)
}

console.log('\nTiebreak 1 — head-to-head (equal points)')
{
  const r = P(['a', 'b', 'c', 'd']) // full round-robin (6 matches)
  // a & b both finish 2-1 (equal points); a beat b head-to-head.
  const rows = computeStandings(r, [
    M(r, 'a', 'b', 7, 5), M(r, 'a', 'c', 7, 5), M(r, 'd', 'a', 7, 5),
    M(r, 'b', 'c', 7, 5), M(r, 'b', 'd', 7, 5), M(r, 'c', 'd', 7, 5),
  ], 2)
  const a = row(rows, 'a'), b = row(rows, 'b')
  check('a and b tie on points (both 2-1, completed)', a.points === b.points)
  check('head-to-head winner (a beat b) ranks above', a.rank < b.rank)
}

console.log('\nTiebreak 2 — win percentage (points equal, head-to-head drawn)')
{
  const r = P(['a', 'b', 'c'])
  // a & b drew each other (no decisive h2h) and each beat c by a different margin → win% decides.
  const rows = computeStandings(r, [D(r, 'a', 'b', 5), M(r, 'a', 'c', 10, 0), M(r, 'b', 'c', 6, 4)], 2)
  const a = row(rows, 'a'), b = row(rows, 'b')
  check('a and b tie on points (draw + win + completion)', a.points === b.points)
  check('higher game win% (a: 15/15) ranks above (b: 11/9)', a.rank < b.rank)
}

console.log('\nStable fallback — display name when everything else is equal')
{
  const r = P(['bravo', 'alpha'])
  const rows = computeStandings(r, [], 2)
  check('identical rows fall back to name alphabetically', order(rows).join(',') === 'alpha,bravo')
  check('repeat run gives the same order (stable)', order(computeStandings(r, [], 2)).join(',') === 'alpha,bravo')
}

console.log('\nAuto-update — order changes when a result changes')
{
  const r = P(['a', 'b'])
  const before = order(computeStandings(r, [M(r, 'a', 'b', 7, 3)], 1))
  const after = order(computeStandings(r, [M(r, 'b', 'a', 7, 3)], 1))
  check('a on top before', before.join(',') === 'a,b')
  check('b on top after the result flips', after.join(',') === 'b,a')
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
