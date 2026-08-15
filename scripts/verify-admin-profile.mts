/**
 * Admin profile edit — the CueVerse-ID cooldown OVERRIDE (staff edits have no 7-day cooldown).
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-admin-profile.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { changeCueverseId, updateProfile } from '../src/lib/players/service.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n) } }
const actor = { userId: 990300, username: 'profile-verify' }
const PID = 'APV-player-1'

try {
  // Fresh synthetic player whose CueVerse ID was "just changed" (cooldown active).
  await prisma.player.deleteMany({ where: { id: PID } }).catch(() => {})
  await prisma.player.create({ data: { id: PID, primaryName: 'APV', cueverseId: 'apv_one', cueverseIdChangedAt: new Date() } })

  const blocked = await changeCueverseId(actor, PID, 'apv_two')
  check('member path is blocked by the 7-day cooldown', blocked.ok === false && /again after/i.test(blocked.error ?? ''))

  const overridden = await changeCueverseId(actor, PID, 'apv_two', { override: true })
  check('admin OVERRIDE bypasses the cooldown', overridden.ok === true)
  check('CueVerse ID actually changed', (await prisma.player.findUniqueOrThrow({ where: { id: PID } })).cueverseId === 'apv_two')

  await updateProfile(actor, PID, { primaryName: 'Renamed', discord: 'tag#1', timeZone: 'America/New_York' })
  const p = await prisma.player.findUniqueOrThrow({ where: { id: PID } })
  check('admin can edit preferred name / discord / time zone', p.primaryName === 'Renamed' && p.discord === 'tag#1' && p.timeZone === 'America/New_York')
} finally {
  await prisma.player.deleteMany({ where: { id: PID } }).catch(() => {})
}
console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
