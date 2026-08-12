/**
 * Pure verification of the double-elimination planner (no DB, no dev server).
 * Builds DE brackets for several field sizes and SIMULATES a full play-through
 * (deterministic: lower seed number always wins), advancing winners and dropping
 * losers exactly as the live engine will, then checks the bracket completes with a
 * single champion, no match is played twice, and no one survives 2 losses.
 */
import { planDoubleElim, isByeSlot, type DEMatch } from '../src/lib/competition/bracket-de.ts'
import type { Qualifier } from '../src/lib/competition/bracket.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n) } }

function qualifiers(n: number): Qualifier[] {
  return Array.from({ length: n }, (_, i) => ({ registrationId: i + 1, username: `P${i + 1}`, seed: i + 1 }))
}

// Deterministic sim: the lower seed number (better seed) wins every match.
function simulate(n: number) {
  const plan = planDoubleElim(qualifiers(n))
  const m = plan.matches
  const played = new Set<number>()
  const losses = new Map<number, number>() // registrationId → losses
  const seatSeed = (slot: { registrationId: number | null; seed: number | null }) => slot.seed

  const put = (idx: number, sslot: number | null, val: { registrationId: number | null; username: string | null; seed: number | null }) => {
    const t = m[idx]
    if (sslot === 0) t.home = val
    else t.away = val
  }

  let guard = 0
  for (;;) {
    if (guard++ > 10000) throw new Error('sim did not terminate')

    // 1) Walkovers: a real player next to a Bye advances without playing (no loss, no drop).
    const walkover = m.find(
      (x) =>
        !played.has(x.index) &&
        ((x.home.registrationId != null && isByeSlot(x.away)) || (x.away.registrationId != null && isByeSlot(x.home))),
    )
    if (walkover) {
      const winner = walkover.home.registrationId != null ? walkover.home : walkover.away
      played.add(walkover.index)
      if (walkover.feedsIndex != null) put(walkover.feedsIndex, walkover.feedsSlot, winner)
      // loser is a Bye → nothing drops; propagate the Bye so downstream also resolves.
      if (walkover.loserFeedsIndex != null) put(walkover.loserFeedsIndex, walkover.loserFeedsSlot, { registrationId: null, username: 'Bye', seed: null })
      continue
    }

    // 2) A normal, playable match: both real.
    const ready = m.find(
      (x) => !played.has(x.index) && x.home.registrationId != null && x.away.registrationId != null,
    )
    if (!ready) break
    const homeWins = (seatSeed(ready.home) ?? 1e9) <= (seatSeed(ready.away) ?? 1e9) // lower seed wins
    const winner = homeWins ? ready.home : ready.away
    const loser = homeWins ? ready.away : ready.home
    played.add(ready.index)
    losses.set(loser.registrationId!, (losses.get(loser.registrationId!) ?? 0) + 1)
    if (ready.feedsIndex != null) put(ready.feedsIndex, ready.feedsSlot, winner)
    if (ready.loserFeedsIndex != null) put(ready.loserFeedsIndex, ready.loserFeedsSlot, loser)
  }

  // Champion = grand-final winner if a GF exists, else the (single) winners-final winner.
  const gf = m.find((x) => x.section === 'GF') ?? m.filter((x) => x.section === 'WB').at(-1)!
  const gfPlayed = played.has(gf.index)
  const champion = gfPlayed ? ((seatSeed(gf.home) ?? 1e9) <= (seatSeed(gf.away) ?? 1e9) ? gf.home : gf.away) : null
  const maxLosses = Math.max(0, ...[...losses.values()])
  const everyoneAtMostTwo = maxLosses <= 2
  // champion is the best seed (seed 1) in a deterministic lower-seed-wins sim
  const championIsTop = champion?.registrationId === 1
  const allReachablePlayed = m.every((x) => played.has(x.index) || unreachable(x))
  return { plan, gfPlayed, championIsTop, everyoneAtMostTwo, allReachablePlayed }
}

// A match is "unreachable" (never played) only if a bye left it permanently empty.
function unreachable(x: DEMatch): boolean {
  return x.home.registrationId == null || x.away.registrationId == null
}

for (const n of [2, 4, 6, 8, 16, 5, 12]) {
  console.log(`\n--- double-elim, ${n} players ---`)
  const r = simulate(n)
  check(`final resolves a champion`, r.gfPlayed)
  check(`champion is the top seed (deterministic)`, r.championIsTop)
  check(`no player survives more than 2 losses`, r.everyoneAtMostTwo)
  check(`every reachable match is played (bracket completes)`, r.allReachablePlayed)
  check(`plan has a grand final (for ≥3 players)`, n <= 2 ? true : r.plan.matches.some((x) => x.section === 'GF'))
  check(`plan has a losers bracket (for ≥3 players)`, n <= 2 ? true : r.plan.matches.some((x) => x.section === 'LB'))
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
