/**
 * Verifies the SINGLE centralized standings comparator (computeStandings) — the one order used by the
 * public crosstable, admin views, previews, and playoff seeding. Covers: descending points, each
 * tiebreaker (game differential, games won, head-to-head), the stable name fallback, and that the
 * order automatically changes when a result changes. Pure — no DB.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-standings.mts
 */
import { computeStandings, type StandingMatchInput } from '../src/lib/competition/standings.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n) } }

const P = (ids: string[]) => ids.map((u, i) => ({ registrationId: i + 1, username: u }))
const id = (roster: { registrationId: number; username: string }[], u: string) => roster.find((r) => r.username === u)!.registrationId
// A decided match: `home` beat `away` hg–ag.
function M(roster: { registrationId: number; username: string }[], home: string, away: string, hg: number, ag: number): StandingMatchInput {
  const h = id(roster, home), a = id(roster, away)
  return { homeRegistrationId: h, awayRegistrationId: a, homeUsername: home, awayUsername: away, homeGames: hg, awayGames: ag, winnerRegistrationId: hg > ag ? h : a }
}
const order = (rows: ReturnType<typeof computeStandings>) => rows.map((r) => r.username)

console.log('Descending points (most wins on top)')
{
  const r = P(['b', 'a', 'c']) // deliberately NOT alphabetical / not seed order
  const rows = computeStandings(r, [M(r, 'a', 'b', 7, 3), M(r, 'a', 'c', 7, 1), M(r, 'b', 'c', 7, 4)], 2)
  check('leader (most wins) is first, loser last', order(rows).join(',') === 'a,b,c')
  check('ranks are 1..n in order', rows.map((x) => x.rank).join(',') === '1,2,3')
  check('top-N flagged qualified', rows[0].qualified && rows[1].qualified && !rows[2].qualified)
}

console.log('\nTiebreak 1 — game differential (equal wins)')
{
  const r = P(['a', 'b', 'c'])
  // a & b each have 1 win over c, but a won by more.
  const rows = computeStandings(r, [M(r, 'a', 'c', 7, 0), M(r, 'b', 'c', 7, 5)], 2)
  check('better game differential ranks higher', order(rows).slice(0, 2).join(',') === 'a,b')
}

console.log('\nTiebreak 2 — games won (equal wins & differential)')
{
  const r = P(['a', 'b', 'c', 'd'])
  // a beat d 7-2 (+5, 7 gw); b beat c 5-0 (+5, 5 gw). Equal wins & diff, a has more games won.
  const rows = computeStandings(r, [M(r, 'a', 'd', 7, 2), M(r, 'b', 'c', 5, 0)], 2)
  const top2 = order(rows).slice(0, 2)
  check('more games won breaks the diff tie', top2[0] === 'a' && top2[1] === 'b')
}

console.log('\nTiebreak 3 — head-to-head (equal wins, diff, games won)')
{
  const r = P(['a', 'b', 'c', 'd'])
  // a & b both 2-1, +2 diff, 18 games won; a beat b head-to-head, so a > b. c is clear of both (+4).
  const rows = computeStandings(r, [
    M(r, 'a', 'b', 7, 5), M(r, 'c', 'a', 7, 5), M(r, 'a', 'd', 6, 4),
    M(r, 'b', 'c', 7, 5), M(r, 'b', 'd', 6, 4), M(r, 'c', 'd', 7, 3),
  ], 2)
  const a = rows.find((x) => x.username === 'a')!, b = rows.find((x) => x.username === 'b')!
  check('tied a & b share wins/diff/gamesWon', a.wins === b.wins && a.gameDiff === b.gameDiff && a.gamesWon === b.gamesWon)
  check('head-to-head winner (a beat b) ranks above', a.rank < b.rank)
}

console.log('\nStable fallback — display name when everything else is equal')
{
  const r = P(['bravo', 'alpha']) // reverse-alphabetical roster order
  // Both 0-0, identical, never played each other → falls back to name; must be deterministic + stable.
  const rows = computeStandings(r, [], 2)
  check('identical rows fall back to name alphabetically', order(rows).join(',') === 'alpha,bravo')
  check('repeat run gives the same order (stable)', order(computeStandings(r, [], 2)).join(',') === 'alpha,bravo')
}

console.log('\nAuto-update — order changes when a result changes')
{
  const r = P(['a', 'b'])
  const before = order(computeStandings(r, [M(r, 'a', 'b', 7, 3)], 1)) // a beat b
  const after = order(computeStandings(r, [M(r, 'b', 'a', 7, 3)], 1)) // result edited: b beat a
  check('a on top before', before.join(',') === 'a,b')
  check('b on top after the result flips', after.join(',') === 'b,a')
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
