import { planBracket } from '../src/lib/competition/bracket.ts'
let pass = 0, fail = 0
const check = (n: string, c: boolean) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n) } }
const nextPow2 = (n: number) => { let p = 1; while (p < n) p *= 2; return p }
const qs = (n: number) => Array.from({ length: n }, (_, i) => ({ registrationId: i + 1, username: 'P' + (i + 1), seed: i + 1 }))

// Cover power-of-two AND odd / non-power-of-two field sizes.
for (const n of [2, 3, 4, 5, 6, 7, 9, 11, 12, 16]) {
  const plan = planBracket(qs(n))
  const size = nextPow2(n)
  const byes = size - n
  const round1 = plan.matches.filter((m) => m.round === 1)

  console.log(`field=${n} → bracketSize=${size}, byes=${byes}`)
  check(`  bracket size = next power of two (${size})`, plan.bracketSize === size)

  // A bye = a round-1 match with exactly one filled side.
  const byeMatches = round1.filter((m) => (m.home.registrationId == null) !== (m.away.registrationId == null))
  check(`  exactly ${byes} bye match(es) created`, byeMatches.length === byes)

  // No bye-vs-bye (both sides empty) and no first-round match is fully empty.
  check('  no bye-vs-bye pairing', round1.every((m) => !(m.home.registrationId == null && m.away.registrationId == null)))

  // Every player who receives a bye is auto-advanced into the round-2 match the bye feeds.
  let advancedOk = byes === 0 ? true : true
  for (const bm of byeMatches) {
    const winner = bm.home.registrationId != null ? bm.home : bm.away
    const next = plan.matches.find((x) => x.index === bm.feedsIndex)
    const seated = bm.feedsSlot === 0 ? next?.home : next?.away
    if (!next || seated?.registrationId !== winner.registrationId) advancedOk = false
  }
  check('  bye winners auto-advanced into round 2', advancedOk)

  // A bye is not a played result: the planner never marks a winner/score — round-1 bye matches
  // simply carry one empty slot, so they are never scored and never award ladder credit.
  const planHasWinnerField = byeMatches.some((m) => 'winner' in (m as Record<string, unknown>))
  check('  byes are not recorded as a played win/loss', !planHasWinnerField)

  // Every non-final match feeds a real downstream match (bracket wiring is complete).
  const wiringOk = plan.matches.every((m) => m.round === plan.rounds ? m.feedsIndex === null : m.feedsIndex !== null)
  check('  downstream matches wired correctly', wiringOk)

  // Deterministic seeding: same input → identical plan.
  check('  deterministic', JSON.stringify(planBracket(qs(n))) === JSON.stringify(plan))
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
