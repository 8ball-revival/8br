/**
 * Pure-logic tests for the RANDOM-draw engine (no DB). Run:
 *   npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-random-teams.mts
 */
import { TEAM_NAME_POOL, MAX_SUPPORTED_TEAMS, assertNamePoolInvariant, drawTeamNames } from '@/lib/competition/team-name-pool'
import { secureShuffle } from '@/lib/competition/secure-random'
import { planBalancedRosters, validateRandomCount, type RandomEntrant } from '@/lib/competition/random-teams'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

function entrant(i: number, rating: number, ranked = true, topFive = false): RandomEntrant {
  return { registrationId: i, playerId: `p${i}`, name: `P${i}`, handle: `p${i}`, rating, ranked, topFive }
}

// ---- 1. Name pool invariant ------------------------------------------------
console.log('Name pool')
let invariantOk = true
try { assertNamePoolInvariant() } catch { invariantOk = false }
check('invariant passes', invariantOk)
check(`pool has ≥200 names (${TEAM_NAME_POOL.length})`, TEAM_NAME_POOL.length >= 200)
check(`pool ≥ MAX_SUPPORTED_TEAMS (${MAX_SUPPORTED_TEAMS})`, TEAM_NAME_POOL.length >= MAX_SUPPORTED_TEAMS)
check('no case-insensitive duplicates', new Set(TEAM_NAME_POOL.map((n) => n.toLowerCase())).size === TEAM_NAME_POOL.length)
check('pool contains punctuation/number names', TEAM_NAME_POOL.includes("Guns N' Roses") && TEAM_NAME_POOL.includes('Blink-182') && TEAM_NAME_POOL.includes('311'))

// ---- 2. drawTeamNames ------------------------------------------------------
console.log('drawTeamNames')
const drawn = drawTeamNames(8, secureShuffle)
check('draws requested count', drawn.length === 8)
check('drawn names are unique', new Set(drawn).size === 8)
check('drawn names are from the pool', drawn.every((n) => TEAM_NAME_POOL.includes(n)))
let overdrawThrew = false
try { drawTeamNames(TEAM_NAME_POOL.length + 1, secureShuffle) } catch { overdrawThrew = true }
check('over-draw throws (never duplicates)', overdrawThrew)
// two draws differ (secure/unpredictable) — allow a tiny chance of equality but effectively never
check('successive draws differ', drawTeamNames(8, secureShuffle).join('|') !== drawTeamNames(8, secureShuffle).join('|'))

// ---- 3. Count validation ---------------------------------------------------
console.log('Count validation')
check('16 @ 2v2 → 8 teams', validateRandomCount(16, 2).ok && (validateRandomCount(16, 2) as { numTeams: number }).numTeams === 8)
check('non-multiple blocked', !validateRandomCount(15, 2).ok)
check('fewer than two teams blocked', !validateRandomCount(2, 2).ok)
check('non-multiple message mentions add/remove', /Add .* or remove/.test((validateRandomCount(15, 2) as { error: string }).error))

// ---- 4. Balanced rating bands ---------------------------------------------
console.log('Balanced bands (16 players, 2v2)')
{
  // ratings 160,150,...,10 → clear rank order; ranks 1-8 are the top band, 9-16 the low band.
  const es = Array.from({ length: 16 }, (_, i) => entrant(i + 1, 160 - i * 10))
  const ratingRank = new Map(es.map((e, i) => [e.registrationId, i + 1])) // 1 = strongest
  const rosters = planBalancedRosters(es, 2)
  check('produces 8 teams', rosters.length === 8)
  check('each team has 2 members', rosters.every((r) => r.members.length === 2))
  const bandOk = rosters.every((r) => {
    const ranks = r.members.map((m) => ratingRank.get(m.registrationId)!)
    return ranks.some((x) => x <= 8) && ranks.some((x) => x >= 9)
  })
  check('every team = one top-band + one low-band player', bandOk)
  const allIds = rosters.flatMap((r) => r.members.map((m) => m.registrationId)).sort((a, b) => a - b)
  check('all 16 players placed exactly once (no drops/dupes)', JSON.stringify(allIds) === JSON.stringify(es.map((e) => e.registrationId)))
}

// ---- 5. Non-deterministic teammate combinations ---------------------------
console.log('Non-determinism')
{
  const es = Array.from({ length: 16 }, (_, i) => entrant(i + 1, 160 - i * 10))
  const partnersOfRank1 = new Set<number>()
  for (let run = 0; run < 60; run++) {
    const rosters = planBalancedRosters(es, 2)
    const team = rosters.find((r) => r.members.some((m) => m.registrationId === 1))!
    const partner = team.members.find((m) => m.registrationId !== 1)!
    partnersOfRank1.add(partner.registrationId)
  }
  check('rank 1 gets varied partners across runs', partnersOfRank1.size >= 3, `distinct partners: ${partnersOfRank1.size}`)
  check('rank 1 not always paired with the very bottom (rank 16)', !(partnersOfRank1.size === 1 && partnersOfRank1.has(16)))
}

// ---- 6. Top-five separation (teams ≥ top-five) ----------------------------
console.log('Top-five separation — 8 teams, 5 top-five')
{
  const es = Array.from({ length: 16 }, (_, i) => entrant(i + 1, 160 - i * 10, true, i < 5))
  let worst = 0
  for (let run = 0; run < 40; run++) {
    const rosters = planBalancedRosters(es, 2)
    const m = Math.max(...rosters.map((r) => r.members.filter((x) => x.topFive).length))
    worst = Math.max(worst, m)
  }
  check('never more than one top-five per team', worst === 1, `worst-case max per team: ${worst}`)
}

// ---- 7. Top-five collisions minimized (teams < top-five) ------------------
console.log('Top-five separation — 3 teams, 5 top-five (unavoidable)')
{
  // 6 players, 2v2 → 3 teams; 5 top-five + 1 normal. Minimum collisions = 5 - 3 = 2 teams with 2.
  const es = [
    entrant(1, 200, true, true), entrant(2, 190, true, true), entrant(3, 180, true, true),
    entrant(4, 170, true, true), entrant(5, 160, true, true), entrant(6, 100, true, false),
  ]
  for (let run = 0; run < 40; run++) {
    const rosters = planBalancedRosters(es, 2)
    const counts = rosters.map((r) => r.members.filter((x) => x.topFive).length)
    const maxPer = Math.max(...counts)
    const collisions = counts.filter((c) => c >= 2).length
    if (maxPer > 2 || collisions !== 2) { check('minimal, capped collisions each run', false, `counts=${counts}`); break }
    if (run === 39) check('minimal, capped collisions every run (≤2 per team, exactly 2 doubled)', true)
  }
}

// ---- 8. Unranked players sink to lowest band ------------------------------
console.log('Unranked handling')
{
  // 8 ranked (high) + 8 unranked → 8 teams of 2; every team should pair one ranked with one unranked.
  const ranked = Array.from({ length: 8 }, (_, i) => entrant(i + 1, 160 - i * 10, true))
  const unranked = Array.from({ length: 8 }, (_, i) => entrant(100 + i, 1500, false))
  const rosters = planBalancedRosters([...ranked, ...unranked], 2)
  const ok = rosters.every((r) => r.members.some((m) => m.ranked) && r.members.some((m) => !m.ranked))
  check('each team = one ranked + one unranked', ok)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
