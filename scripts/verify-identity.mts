/**
 * Identity model verification — the CueVerse-ID-as-canonical-identity invariants at the service +
 * database layer. Uses UNLINKED Player rows (linkedUserId = null) so it exercises the full Prisma-side
 * logic (validation, case-insensitive uniqueness, cooldown, admin override, case-only recasing,
 * whitespace normalization, audit, and the DB UNIQUE-index concurrent-claim guard) WITHOUT booting
 * Payload (tsx can't load the CMS). The Payload username projection/sync is covered separately by
 * scripts/identity-integrity.mts (asserts username == normalized CueVerse ID for every real account)
 * and by browser QA. Cleans up all rows it creates.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-identity.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { normalizeCueverseId, cueverseLoginKey, validateCueverseId } from '../src/lib/account/validation.ts'
import { changeCueverseId, isCueverseIdAvailable, cueverseCooldownState } from '../src/lib/players/service.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n) } }
const actor = { userId: 990001, username: 'identity-verify' }
const TAG = 'idv-' // all test CueVerse IDs are prefixed so cleanup is exact

async function mkPlayer(cueverseId: string, changedAt: Date | null = null) {
  return prisma.player.create({
    data: {
      primaryName: cueverseId,
      cueverseId,
      cueverseIdNormalized: cueverseLoginKey(cueverseId),
      cueverseIdChangedAt: changedAt,
      linkStatus: 'UNLINKED',
    },
  })
}

async function run() {
  // --- pure validation / normalization ---
  check('valid CueVerse ID accepted', validateCueverseId('Sixohtwo') === null)
  check('empty CueVerse ID rejected', validateCueverseId('') !== null)
  check('too-short (1 char) rejected', validateCueverseId('a') !== null)
  check('illegal char (space) rejected', validateCueverseId('a b') !== null)
  check('normalize trims surrounding whitespace', normalizeCueverseId('  Ant  ') === 'Ant')
  check('login key lowercases + trims', cueverseLoginKey('  AnT ') === 'ant')
  check('case-only ids share one login key', cueverseLoginKey('Ant') === cueverseLoginKey('ant'))

  // --- availability (case-insensitive) ---
  const a = await mkPlayer(`${TAG}Alpha`)
  check('taken id is unavailable (exact)', (await isCueverseIdAvailable(`${TAG}Alpha`)) === false)
  check('taken id is unavailable (different case)', (await isCueverseIdAvailable(`${TAG}ALPHA`)) === false)
  check('a free id is available', (await isCueverseIdAvailable(`${TAG}Free`)) === true)
  check('own id excluded → available to self', (await isCueverseIdAvailable(`${TAG}Alpha`, a.id)) === true)

  // --- change: case-insensitive uniqueness (a second player can't claim Alpha) ---
  const b = await mkPlayer(`${TAG}Beta`)
  const clash = await changeCueverseId(actor, b.id, `${TAG}alpha`, { override: true })
  check('claiming an existing id (diff case) is refused', clash.ok === false && clash.conflict === true)
  const bAfter = await prisma.player.findUniqueOrThrow({ where: { id: b.id } })
  check('refused change left the id untouched', bAfter.cueverseId === `${TAG}Beta`)

  // --- change: normal rename updates display + normalized + timestamp ---
  const okChange = await changeCueverseId(actor, b.id, `${TAG}Gamma`, { override: true })
  const bG = await prisma.player.findUniqueOrThrow({ where: { id: b.id } })
  check('rename succeeds', okChange.ok === true)
  check('display casing stored', bG.cueverseId === `${TAG}Gamma`)
  check('normalized key stored (lowercased)', bG.cueverseIdNormalized === cueverseLoginKey(`${TAG}Gamma`))
  check('changedAt stamped', bG.cueverseIdChangedAt != null)

  // --- change: whitespace is normalized away on write ---
  const ws = await changeCueverseId(actor, b.id, `  ${TAG}Delta  `, { override: true })
  const bD = await prisma.player.findUniqueOrThrow({ where: { id: b.id } })
  check('surrounding whitespace trimmed on change', ws.ok === true && bD.cueverseId === `${TAG}Delta`)

  // --- change: invalid rejected ---
  const badFmt = await changeCueverseId(actor, b.id, 'x', { override: true })
  check('invalid new id rejected', badFmt.ok === false)

  // --- case-only recasing: allowed, same identity, updates display capitalization ---
  const caseOnly = await changeCueverseId(actor, b.id, `${TAG}DELTA`, { override: true })
  const bDU = await prisma.player.findUniqueOrThrow({ where: { id: b.id } })
  check('case-only recasing allowed (no self-collision)', caseOnly.ok === true)
  check('recasing updates display capitalization', bDU.cueverseId === `${TAG}DELTA`)
  check('recasing keeps the same normalized key', bDU.cueverseIdNormalized === cueverseLoginKey(`${TAG}Delta`))

  // --- cooldown: enforced for player-initiated, bypassed by admin override ---
  const cd = await mkPlayer(`${TAG}Cool`, new Date()) // just changed → inside cooldown
  const cdState = cueverseCooldownState(new Date())
  check('cooldown state reports not-yet-changeable', cdState.canChange === false && cdState.nextAvailableAt != null)
  const blocked = await changeCueverseId(actor, cd.id, `${TAG}Cooler`, { override: false })
  check('player-initiated change blocked during cooldown', blocked.ok === false)
  const overridden = await changeCueverseId(actor, cd.id, `${TAG}Cooler`, { override: true })
  check('admin override bypasses cooldown', overridden.ok === true)

  // --- DB-level guard: the UNIQUE index blocks a concurrent duplicate that slips past the check ---
  let indexBlocked = false
  try {
    await prisma.player.update({ where: { id: cd.id }, data: { cueverseIdNormalized: cueverseLoginKey(`${TAG}Alpha`) } })
  } catch { indexBlocked = true }
  check('UNIQUE index rejects a duplicate normalized id at the DB', indexBlocked)

  // --- audit: a change wrote an immutable before→after entry ---
  const audits = await prisma.auditLog.count({ where: { actorUsername: 'identity-verify', action: 'account.cueverseId.change' } })
  check('identity change writes an audit entry (prev→new)', audits > 0)
}

try {
  await run()
} finally {
  // Exact cleanup: only rows this script created.
  await prisma.player.deleteMany({ where: { cueverseId: { startsWith: TAG } } }).catch(() => {})
  await prisma.player.deleteMany({ where: { cueverseIdNormalized: { startsWith: TAG.toLowerCase() } } }).catch(() => {})
  await prisma.auditLog.deleteMany({ where: { actorUsername: 'identity-verify' } }).catch(() => {})
}
console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
