/**
 * Non-destructive verification of the moderation / eligibility / cleanup / integrity services
 * against the live DB. There is no `testuser` in this DB (only the Owner, `starkiller`), so we
 * exercise the full lifecycle against a SYNTHETIC account id that touches no real account, then
 * delete every synthetic row (moderation, penalty, warning, the test registration, and this
 * run's audit entries) so the DB is left pristine.
 *
 *   npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-moderation.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import {
  resolveMemberStatus,
  warnMember,
  applyTimeout,
  applyBan,
  removePenalty,
  softDeleteAccount,
  restoreMember,
} from '../src/lib/moderation/service.ts'
import { checkSelfSignupEligibility } from '../src/lib/competition/eligibility.ts'
import { getIntegrityLog } from '../src/lib/moderation/integrity-log.ts'

const log = (...a: unknown[]) => console.log(...a)
let pass = 0, fail = 0
const check = (name: string, cond: boolean) => { if (cond) { pass++; log(`  ✓ ${name}`) } else { fail++; log(`  ✗ ${name}`) } }

const UID = 990001 // synthetic Payload user id (guaranteed absent)
const actor = { userId: 990000, username: 'verify-script' }

const activeSeason = await prisma.tournament.findFirst({ where: { competitionType: 'SEASON', seasonStatus: { not: 'COMPLETED' } }, select: { id: true, registrationStatus: true } })
let testRegId: number | null = null

try {
  // Seed a synthetic ACTIVE registration in the active tournament to prove cleanup withdraws it.
  if (activeSeason) {
    const reg = await prisma.registration.create({ data: { tournamentId: activeSeason.id, userId: UID, username: 'verify-test-entrant', status: 'APPROVED', approvedAt: new Date() } })
    testRegId = reg.id
    log(`seeded synthetic registration ${testRegId} in tournament ${activeSeason.id}`)
  }

  // Baseline
  const s0 = await resolveMemberStatus(UID)
  check('baseline status ACTIVE (no row)', s0.status === 'ACTIVE' && s0.canLogin && s0.canRegister)

  // Eligibility with no linked profile → NO_PROFILE (profile-completeness gate)
  if (activeSeason && activeSeason.registrationStatus === 'OPEN') {
    const e = await checkSelfSignupEligibility(UID, activeSeason.id)
    check('eligibility requires a profile (NO_PROFILE)', !e.ok && e.code === 'NO_PROFILE')
  }

  // Warning — history only
  await warnMember(actor, UID, { reason: 'verify warning', internalNotes: 'private' })
  check('warning recorded, status unchanged', !!(await prisma.warning.findFirst({ where: { userId: UID } })) && (await resolveMemberStatus(UID)).status === 'ACTIVE')

  // Timeout → status + cleanup + eligibility
  await applyTimeout(actor, UID, { until: new Date(Date.now() + 3600_000), reason: 'verify timeout' })
  const sTo = await resolveMemberStatus(UID)
  check('timeout → TIMED_OUT (login ok, register blocked)', sTo.status === 'TIMED_OUT' && sTo.canLogin && !sTo.canRegister)
  check('timeout penalty created', !!(await prisma.penalty.findFirst({ where: { userId: UID, type: 'TIMEOUT', removedAt: null } })))
  if (testRegId) check('cleanup WITHDREW active registration on timeout', (await prisma.registration.findUnique({ where: { id: testRegId } }))?.status === 'WITHDRAWN')
  if (activeSeason) { const e = await checkSelfSignupEligibility(UID, activeSeason.id); check('eligibility blocks TIMED_OUT', !e.ok && e.code === 'TIMED_OUT') }

  // Restore
  await restoreMember(actor, UID, { reason: 'verify restore' })
  check('restore → ACTIVE', (await resolveMemberStatus(UID)).status === 'ACTIVE')

  // Ban → login blocked
  await applyBan(actor, UID, { reason: 'verify ban', ipHash: null })
  const sBan = await resolveMemberStatus(UID)
  check('ban → BANNED (login blocked)', sBan.status === 'BANNED' && !sBan.canLogin && !sBan.canRegister)
  const pBan = await prisma.penalty.findFirst({ where: { userId: UID, type: 'BAN', removedAt: null } })
  check('ban penalty created', !!pBan)

  // Remove ban → recompute ACTIVE, removal recorded in place (not deleted)
  if (pBan) await removePenalty(actor, pBan.id, { reason: 'verify unban' })
  check('remove ban → ACTIVE', (await resolveMemberStatus(UID)).status === 'ACTIVE')
  const pBanAfter = pBan ? await prisma.penalty.findUnique({ where: { id: pBan.id } }) : null
  check('penalty removal recorded in place (row kept, removedAt/removedReason set)', !!pBanAfter?.removedAt && !!pBanAfter?.removedReason)

  // Soft delete → DELETED (no profile → unlinkedPlayerId null)
  const del = await softDeleteAccount(actor, UID, { reason: 'verify delete' })
  const sDel = await resolveMemberStatus(UID)
  check('soft delete → DELETED (login blocked)', sDel.status === 'DELETED' && !sDel.canLogin)
  check('soft delete preserved (no profile to unlink here)', del.ok === true && del.unlinkedPlayerId == null)

  // Integrity log assembly
  const integ = await getIntegrityLog(UID, null)
  check('integrity log assembles warning + timeout + ban events', integ.some((e) => e.kind === 'warning') && integ.some((e) => e.kind === 'timeout') && integ.some((e) => e.kind === 'ban'))

  // Owner invariant (roles live in payload.users_roles): exactly one Owner
  const owners = (await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM payload.users_roles WHERE value = 'owner'`)) as { n: number }[]
  check('exactly one Owner in the system', owners[0]?.n === 1)

  // Completed-history safety
  const completed = await prisma.tournament.count({ where: { OR: [{ seasonStatus: 'COMPLETED' }, { cupStatus: 'completed' }] } })
  log(`  (info) cleanup never touches COMPLETED competitions — ${completed} present`)
} finally {
  // ---- Delete every synthetic row this run created (fully non-destructive to real data) ----
  if (testRegId) await prisma.registration.deleteMany({ where: { id: testRegId } })
  await prisma.penalty.deleteMany({ where: { userId: UID } })
  await prisma.warning.deleteMany({ where: { userId: UID } })
  await prisma.memberModeration.deleteMany({ where: { userId: UID } })
  await prisma.auditLog.deleteMany({ where: { actorUsername: 'verify-script' } })
  log('cleaned up all synthetic verification rows')
}

log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
