import { prisma } from '../src/lib/prisma.ts'
import { reportOwnLoss } from '../src/lib/competition/service.ts'
import { getTournamentHistory, deriveLegacyState } from '../src/lib/competition/tournament-lifecycle.ts'
let pass = 0, fail = 0
const check = (n: string, c: boolean) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n) } }
const UID_A = 990911, UID_B = 990912, UID_X = 990913
const A = (action: string, extra: Record<string, unknown> = {}) => ({ actorUserId: 1, actorUsername: 'cup-rh', action, entity: 'Tournament', ...extra })

console.log('--- Part C: deriveLegacyState (migration safety) ---')
const D = (o: Record<string, unknown>) => deriveLegacyState({ lifecycleState: null, status: null, registrationStatus: null, playoffsStatus: null, ...o } as never)
check('published bracket → IN_PROGRESS (legacy safe, NOT BRACKET_GENERATED)', D({ playoffsStatus: 'PUBLISHED' }) === 'IN_PROGRESS')
check('explicit lifecycleState BRACKET_GENERATED wins', deriveLegacyState({ lifecycleState: 'BRACKET_GENERATED' } as never) === 'BRACKET_GENERATED')
check('completed → COMPLETED', D({ status: 'COMPLETED' }) === 'COMPLETED')
check('registration OPEN → REGISTRATION_OPEN', D({ registrationStatus: 'OPEN' }) === 'REGISTRATION_OPEN')
check('registration CLOSED → REGISTRATION_CLOSED', D({ registrationStatus: 'CLOSED' }) === 'REGISTRATION_CLOSED')
check('default → DRAFT', D({}) === 'DRAFT')

const cup = await prisma.tournament.create({ data: { slug: 'zzz-verify-rh', name: 'RH Cup', code: 'CRH', number: 99002, lifecycleState: 'IN_PROGRESS', registrationStatus: 'CLOSED', status: 'ACTIVE', playoffsStatus: 'PUBLISHED', raceLength: 5, participantFormat: 'INDIVIDUAL' } })
const id = cup.id
try {
  console.log('\n--- Part A: player self-report (loss only) ---')
  const rA = await prisma.registration.create({ data: { tournamentId: id, username: 'A', status: 'APPROVED', userId: UID_A } })
  const rB = await prisma.registration.create({ data: { tournamentId: id, username: 'B', status: 'APPROVED', userId: UID_B } })
  const finalM = await prisma.playoffMatch.create({ data: { tournamentId: id, round: 1, slot: 1, label: 'Final', homeRegistrationId: rA.id, awayRegistrationId: rB.id, homeUsername: 'A', awayUsername: 'B', published: true } })

  const stranger = await reportOwnLoss(UID_X, 'X', finalM.id, 1)
  check('non-participant rejected', !stranger.ok && /not an entrant/i.test(stranger.error || ''))

  const rep = await reportOwnLoss(UID_A, 'A', finalM.id, 2)
  check('participant self-report accepted', rep.ok)
  const after = await prisma.playoffMatch.findUniqueOrThrow({ where: { id: finalM.id } })
  check('opponent recorded as WINNER (never self)', after.winnerRegistrationId === rB.id)
  check('reporter got their games (2), opponent got the race (5)', after.homeGames === 2 && after.awayGames === 5)

  const dup = await reportOwnLoss(UID_A, 'A', finalM.id, 3)
  check('duplicate/conflicting report rejected', !dup.ok && /already/i.test(dup.error || ''))

  console.log('\n--- Part B: cup history (audit-derived, public vs admin) ---')
  // Seed representative audit rows spanning the lifecycle + admin-only bookkeeping.
  await prisma.auditLog.createMany({ data: [
    A('tournament.create'),
    A('tournament.state', { newValue: { state: 'REGISTRATION_OPEN' } }),
    A('tournament.state', { newValue: { state: 'BRACKET_GENERATED' } }),
    A('playoff.manualBuild'), // after BRACKET_GENERATED → counts as a regeneration
    A('entrant.add'),
    A('playoff.verify'),
    A('tournament.ladder.apply'),
    A('tournament.state.recovery', { newValue: { state: 'IN_PROGRESS' }, reason: 'SENSITIVE ADMIN NOTE' }),
  ].map((d) => ({ ...d, entityId: String(id) })) })

  const admin = await getTournamentHistory(id, { admin: true })
  const pub = await getTournamentHistory(id, { admin: false })
  const kinds = (evs: typeof admin) => new Set(evs.map((e) => e.kind))
  const ak = kinds(admin), pk = kinds(pub)

  check('admin history includes actor names', admin.some((e) => e.actor === 'cup-rh'))
  check('admin history includes bracket_regenerated (build after generated)', ak.has('bracket_regenerated'))
  check('admin history includes match_result + ladder_applied + entrant_added', ak.has('match_result') && ak.has('ladder_applied') && ak.has('entrant_added'))
  check('admin recovery event carries the reason', admin.some((e) => e.kind === 'recovery' && e.detail === 'SENSITIVE ADMIN NOTE'))

  check('PUBLIC history strips actor from every event', pub.every((e) => e.actor === undefined))
  check('PUBLIC history strips detail/reason from every event', pub.every((e) => e.detail === undefined))
  check('PUBLIC history omits ladder_applied + entrant_added (admin-only)', !pk.has('ladder_applied') && !pk.has('entrant_added'))
  check('PUBLIC history keeps lifecycle milestones', pk.has('registration_open') && pk.has('bracket_generated') && pk.has('recovery'))
  check('PUBLIC recovery has NO reason text anywhere', !JSON.stringify(pub).includes('SENSITIVE'))
} finally {
  await prisma.tournament.delete({ where: { id } }).catch(() => {})
  await prisma.auditLog.deleteMany({ where: { actorUsername: 'cup-rh' } })
  const { regenerateTournamentSnapshot } = await import('../src/lib/tournaments/migrate.ts')
  await regenerateTournamentSnapshot().catch(() => {})
  console.log('cleaned up synthetic cup + audit + snapshot')
}
console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect(); process.exit(fail === 0 ? 0 : 1)
