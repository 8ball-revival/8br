/**
 * PRODUCTION SANITIZATION — run ONCE against the freshly-restored production database (never local).
 *
 * Set PROD_DATABASE_URL to the Neon UNPOOLED/direct connection, then:
 *   PROD_DATABASE_URL="postgres://…-unpooled…" npx tsx --tsconfig scripts/tsconfig.verify.json scripts/sanitize-production.mts
 *
 * Removes ONLY clearly-identified disposable test records; preserves all real data (31 migrated
 * players + bridges, 30 accounts + claim hashes, the Owner, Season 2, Payload content, the
 * Brian/fsm-brian merge). Idempotent + reports before/after counts.
 */
import { PrismaClient } from '@prisma/client'

const url = process.env.PROD_DATABASE_URL
if (!url) { console.error('✗ Set PROD_DATABASE_URL (Neon direct/unpooled) — refusing to run against the default (local) DB.'); process.exit(1) }
if (/localhost|127\.0\.0\.1/.test(url)) { console.error('✗ PROD_DATABASE_URL points at localhost — aborting to protect the local DB.'); process.exit(1) }
const prisma = new PrismaClient({ datasources: { db: { url } } })

const TEST_REGISTRATION_NAMES = ['testuser', 'ghost', 'godriel'] // withdrawn test entrants
const PASCAL_ID = 'cmsgu48tt00056rfkhib4zmnz' // "Pascal"/Godriel — test profile, dangling link, no ranking bridge

async function counts() {
  return {
    players: await prisma.player.count(),
    bridged: await prisma.player.count({ where: { legacyPlayerId: { not: null } } }),
    accounts: await prisma.accountClaim.count(),
    registrations: await prisma.registration.count(),
    seasons: await prisma.tournament.count(),
  }
}

const before = await counts()
console.log('BEFORE:', JSON.stringify(before))

await prisma.$transaction(async (tx) => {
  // 1) Disposable WITHDRAWN test registrations (by test name, or pointing at the Pascal test profile).
  const delRegs = await tx.registration.deleteMany({
    where: { status: 'WITHDRAWN', OR: [{ username: { in: TEST_REGISTRATION_NAMES, mode: 'insensitive' } }, { playerId: PASCAL_ID }, { username: { equals: 'sixohtwo', mode: 'insensitive' }, userId: 4 }] },
  })
  console.log(`  removed ${delRegs.count} disposable test registration(s)`)

  // 2) The Pascal/Godriel test profile (only if it's still the unbridged test leftover — never a real player).
  const pascal = await tx.player.findUnique({ where: { id: PASCAL_ID }, select: { legacyPlayerId: true, cueverseId: true } })
  if (pascal && pascal.legacyPlayerId === null && (pascal.cueverseId ?? '').toLowerCase() === 'godriel') {
    await tx.playerAlias.deleteMany({ where: { playerId: PASCAL_ID } })
    await tx.player.delete({ where: { id: PASCAL_ID } })
    console.log('  removed Pascal/Godriel test profile')
  } else {
    console.log('  Pascal profile already absent or not the test leftover — skipped')
  }
})

const after = await counts()
console.log('AFTER: ', JSON.stringify(after))
console.log('\nExpected after: players=31, bridged=31, accounts=30, registrations=1, seasons=1')
console.log(`Verify: bridged unchanged (${before.bridged}→${after.bridged}), accounts unchanged (${before.accounts}→${after.accounts})`)
await prisma.$disconnect()
