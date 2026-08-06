import { prisma } from '../src/lib/prisma.ts'
import { transitionCupState, getCupState, canTransition, bracketMatchesEntrants } from '../src/lib/competition/cup-lifecycle.ts'
import { addManualEntrant, rebuildManualPlayoff, publishPlayoff } from '../src/lib/competition/service.ts'
let pass = 0, fail = 0
const check = (n: string, c: boolean) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n) } }
const actor = { userId: 990970, username: 'wf-verify' }

console.log('--- matrix: registration toggle + permanent live lock ---')
check('REGISTRATION_CLOSED → REGISTRATION_OPEN allowed (re-open toggle)', canTransition('REGISTRATION_CLOSED', 'REGISTRATION_OPEN'))
check('BRACKET_GENERATED → REGISTRATION_OPEN allowed (re-open, invalidates bracket)', canTransition('BRACKET_GENERATED', 'REGISTRATION_OPEN'))
check('IN_PROGRESS → REGISTRATION_OPEN REJECTED (permanent lock once live)', !canTransition('IN_PROGRESS', 'REGISTRATION_OPEN'))
check('COMPLETED → REGISTRATION_OPEN REJECTED', !canTransition('COMPLETED', 'REGISTRATION_OPEN'))
check('REGISTRATION_CLOSED → IN_PROGRESS REJECTED (must generate bracket)', !canTransition('REGISTRATION_CLOSED', 'IN_PROGRESS'))

const cup = await prisma.season.create({ data: { slug: 'zzz-wf', name: 'WF Cup', competitionType: 'CUP', competitionCode: 'CWF', cupNumber: 99060, cupState: 'REGISTRATION_OPEN', registrationStatus: 'OPEN', seasonStatus: 'UPCOMING', playoffsStatus: 'PENDING', raceLength: 5, participantFormat: 'INDIVIDUAL' } })
const id = cup.id
try {
  console.log('\n--- temporary entrants are refused server-side ---')
  const temp = await addManualEntrant(actor, id, 'Some Free Text Name')
  check('addManualEntrant refuses (no free-text entrants)', !temp.ok && /no longer supported/i.test(temp.error || ''))
  check('no account-less entrant row was created', (await prisma.registration.count({ where: { seasonId: id } })) === 0)

  console.log('\n--- close ⇄ re-open registration persists ---')
  check('REGISTRATION_OPEN → REGISTRATION_CLOSED ok', (await transitionCupState(actor, id, 'REGISTRATION_CLOSED')).ok)
  check('  persisted CLOSED', getCupState(await prisma.season.findUniqueOrThrow({ where: { id } })) === 'REGISTRATION_CLOSED')
  check('REGISTRATION_CLOSED → REGISTRATION_OPEN ok (re-open before bracket)', (await transitionCupState(actor, id, 'REGISTRATION_OPEN')).ok)
  check('  persisted OPEN', getCupState(await prisma.season.findUniqueOrThrow({ where: { id } })) === 'REGISTRATION_OPEN')

  console.log('\n--- bracket staleness: entrant change after generation ---')
  // Seed 4 registered entrants (permanent player refs simulated by registration ids).
  const regs = []
  for (const nm of ['A', 'B', 'C', 'D']) regs.push(await prisma.registration.create({ data: { seasonId: id, username: nm, status: 'APPROVED' } }))
  await transitionCupState(actor, id, 'REGISTRATION_CLOSED')
  await rebuildManualPlayoff(actor, id, regs.map((r) => r.id))
  await publishPlayoff(actor, id)
  await transitionCupState(actor, id, 'BRACKET_GENERATED')
  check('fresh bracket matches entrants', (await bracketMatchesEntrants(id)).ok)

  // Re-open, add a 5th entrant → bracket now stale.
  check('BRACKET_GENERATED → REGISTRATION_OPEN ok (re-open)', (await transitionCupState(actor, id, 'REGISTRATION_OPEN')).ok)
  await prisma.registration.create({ data: { seasonId: id, username: 'E', status: 'APPROVED' } })
  const stale = await bracketMatchesEntrants(id)
  check('bracket is STALE after an entrant is added', !stale.ok && /added after/i.test(stale.reason || ''))

  // Withdraw a seeded entrant → also stale.
  await transitionCupState(actor, id, 'REGISTRATION_CLOSED')
  await prisma.registration.update({ where: { id: regs[0].id }, data: { status: 'WITHDRAWN' } })
  const stale2 = await bracketMatchesEntrants(id)
  check('bracket is STALE after a seeded entrant withdraws', !stale2.ok)
} finally {
  await prisma.season.delete({ where: { id } }).catch(() => {})
  await prisma.auditLog.deleteMany({ where: { actorUsername: 'wf-verify' } })
  const { regenerateCupSnapshot } = await import('../src/lib/cups/migrate.ts')
  await regenerateCupSnapshot().catch(() => {})
  console.log('cleaned up synthetic cup + audit + snapshot')
}
console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect(); process.exit(fail === 0 ? 0 : 1)
