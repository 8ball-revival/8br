/**
 * Admin profile edit — CueVerse ID changes and the safe profile fields.
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-admin-profile.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { deleteFixtureAuditRows } from '../src/lib/verification/fixture-actors.ts'
import { changeCueverseId, updateProfile } from '../src/lib/players/service.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n) } }
const actor = { userId: 990300, username: 'profile-verify' }
const PID = 'APV-player-1'

try {
  // Fresh synthetic player whose CueVerse ID was changed a moment ago.
  await prisma.player.deleteMany({ where: { id: PID } }).catch(() => {})
  await prisma.player.create({ data: { id: PID, primaryName: 'APV', cueverseId: 'apv_one', cueverseIdChangedAt: new Date() } })

  // No waiting period: the member path succeeds straight after a previous change.
  const memberPath = await changeCueverseId(actor, PID, 'apv_two')
  check('member path is allowed immediately after a change', memberPath.ok === true)
  check('CueVerse ID actually changed', (await prisma.player.findUniqueOrThrow({ where: { id: PID } })).cueverseId === 'apv_two')

  const overridden = await changeCueverseId(actor, PID, 'apv_three', { override: true })
  check('admin override path still works', overridden.ok === true)
  check('the previous ID is kept as a searchable alias',
    (await prisma.playerAlias.findMany({ where: { playerId: PID }, select: { alias: true } })).some((a) => a.alias === 'apvone'))

  await updateProfile(actor, PID, { primaryName: 'Renamed', discord: 'tag#1', timeZone: 'America/New_York' })
  const p = await prisma.player.findUniqueOrThrow({ where: { id: PID } })
  check('admin can edit preferred name / discord / time zone', p.primaryName === 'Renamed' && p.discord === 'tag#1' && p.timeZone === 'America/New_York')
} finally {
  await prisma.playerAlias.deleteMany({ where: { playerId: PID } }).catch(() => {})
  await prisma.player.deleteMany({ where: { id: PID } }).catch(() => {})
  // The suite's own audit trail goes with its records — see verify-playoff-field.
  await deleteFixtureAuditRows(prisma, ['profile-verify']).catch(() => {})
}
console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
