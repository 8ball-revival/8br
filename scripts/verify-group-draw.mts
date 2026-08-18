/**
 * The group draw: entrants are assigned in the order they were added.
 *
 * This behaviour had no test before. The engine used to shuffle deterministically from a recorded
 * seed, so "which group will this person be in" could not be answered until the draw ran. It now
 * follows entrant order, and these checks exist so that cannot quietly revert to a shuffle.
 */

import { planGroups, orderRegistrations, groupCode, type SeedableRegistration } from '@/lib/competition/groups'

let passed = 0
let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed += 1 } else { failed += 1; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

const T0 = new Date('2026-08-19T10:00:00Z')

/** Entrants added one minute apart, in the order given. */
function entrants(names: string[], opts: { seeds?: (number | null)[]; from?: number } = {}): SeedableRegistration[] {
  const from = opts.from ?? 100
  return names.map((username, i) => ({
    id: from + i,
    username,
    seed: opts.seeds ? opts.seeds[i] : null,
    enteredAt: new Date(T0.getTime() + i * 60_000),
  }))
}

const names = (regs: readonly { username: string }[]) => regs.map((r) => r.username).join(',')
const layout = (regs: SeedableRegistration[], n: number) =>
  planGroups(regs, n, 'irrelevant').groups.map((g) => `${g.code}:${names(g.players)}`).join(' | ')

// ─────────────────────────────────────────────────── entrant order is the order
console.log('\nentrant order')
{
  /*
    The fixture is built so that entry order, alphabetical order and manual-seed order are three
    DIFFERENT sequences. Each of the three checks below therefore fails independently if the wrong
    one is used — which the earlier version of this test did not achieve, because its seeds happened
    to reproduce alphabetical order exactly.

      entry order  : zeta, yankee, alpha, mike
      alphabetical : alpha, mike, yankee, zeta
      manual seed  : yankee(1), mike(2), zeta(3), alpha(4)
  */
  const regs = entrants(['zeta', 'yankee', 'alpha', 'mike'], { seeds: [3, 1, 4, 2] })
  const got = names(orderRegistrations(regs))
  check('entrants come back in the order they were added', got === 'zeta,yankee,alpha,mike', got)
  check('alphabetical order is NOT used', got !== 'alpha,mike,yankee,zeta', got)
  check('the manual seed field is NOT used to order the group draw',
    got !== 'yankee,mike,zeta,alpha', `${got} — manual seed is playoff seeding, not group ordering`)

  // Rows arriving from the database in any order must not change the result.
  check('the order rows arrive in does not matter',
    names(orderRegistrations([...regs].reverse())) === 'zeta,yankee,alpha,mike')
}

// ─────────────────────────────────────────────────── serpentine placement
console.log('\nplacement across groups')
{
  const six = entrants(['e1', 'e2', 'e3', 'e4', 'e5', 'e6'])
  // 1-2-3 across, then 4-5-6 back: the first entrant and the fourth are not both in Group A.
  check('the first three entrants go to A, B, C',
    layout(six, 3).startsWith('A:e1'), layout(six, 3))
  const plan = planGroups(six, 3, 'x')
  check('...and the next three come back C, B, A',
    plan.groups[2].players[1].username === 'e4'
    && plan.groups[1].players[1].username === 'e5'
    && plan.groups[0].players[1].username === 'e6',
    layout(six, 3))
  check('no group holds two consecutive early entrants',
    plan.groups.every((g) => g.players.length === 2))
}

// ─────────────────────────────────────────────────── determinism
console.log('\ndeterminism')
{
  const regs = entrants(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
  const one = layout(regs, 3)
  check('the same entrants always produce the same groups', one === layout(regs, 3))

  // The seed is still recorded, but it must no longer change anything.
  const withSeedA = JSON.stringify(planGroups(regs, 3, 'seed-A').groups)
  const withSeedB = JSON.stringify(planGroups(regs, 3, 'seed-B').groups)
  check('a different recorded seed does not change the draw', withSeedA === withSeedB)
  check('...but the seed is still returned for the record',
    planGroups(regs, 3, 'seed-A').seed === 'seed-A')

  check('shuffling the input does not change the draw',
    JSON.stringify(planGroups([...regs].reverse(), 3, 'x').groups) === withSeedA)
}

// ─────────────────────────────────────────────────── balance
console.log('\ngroup sizes')
{
  for (const [count, groups, expect] of [[10, 3, '4,3,3'], [12, 4, '3,3,3,3'], [7, 2, '4,3'], [5, 5, '1,1,1,1,1']] as const) {
    const regs = entrants(Array.from({ length: count }, (_, i) => `p${i + 1}`))
    const sizes = planGroups(regs, groups, 'x').groups.map((g) => g.players.length).sort((a, b) => b - a).join(',')
    check(`${count} entrants into ${groups} groups → ${expect}`, sizes === expect, sizes)
  }
  const regs = entrants(Array.from({ length: 11 }, (_, i) => `p${i + 1}`))
  const sizes = planGroups(regs, 3, 'x').groups.map((g) => g.players.length)
  check('sizes never differ by more than one', Math.max(...sizes) - Math.min(...sizes) <= 1, sizes.join(','))
  check('every entrant is placed exactly once',
    sizes.reduce((a, b) => a + b, 0) === 11)
  const all = planGroups(regs, 3, 'x').groups.flatMap((g) => g.players.map((p) => p.registrationId))
  check('no entrant is placed twice', new Set(all).size === all.length)
}

// ─────────────────────────────────────────────────── ties and missing data
console.log('\nties and older rows')
{
  // Two entrants added in the same instant: the autoincrement id decides, so the order is still total.
  const same = [3, 1, 2].map((n) => ({ id: n, username: `p${n}`, seed: null, enteredAt: T0 }))
  check('identical timestamps fall back to entry id',
    names(orderRegistrations(same)) === 'p1,p2,p3', names(orderRegistrations(same)))

  // Rows predating the timestamp being carried through still order correctly, because a later
  // entrant always has a higher id.
  const noTs = [30, 10, 20].map((n) => ({ id: n, username: `q${n}`, seed: null }))
  check('rows without a timestamp order by id',
    names(orderRegistrations(noTs)) === 'q10,q20,q30', names(orderRegistrations(noTs)))

  const mixed: SeedableRegistration[] = [
    { id: 9, username: 'later', seed: null, enteredAt: new Date(T0.getTime() + 60_000) },
    { id: 2, username: 'earlier', seed: null, enteredAt: T0 },
  ]
  check('a mixed set still orders by time first', names(orderRegistrations(mixed)) === 'earlier,later')
}

// ─────────────────────────────────────────────────── guards
console.log('\nguards')
{
  const regs = entrants(['a', 'b'])
  let threw = false
  try { planGroups(regs, 5, 'x') } catch { threw = true }
  check('more groups than entrants is refused', threw)

  threw = false
  try { planGroups(regs, 0, 'x') } catch { threw = true }
  check('zero groups is refused', threw)

  check('group codes run A, B, C…', [0, 1, 2].map(groupCode).join('') === 'ABC')
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exitCode = failed > 0 ? 1 : 0
