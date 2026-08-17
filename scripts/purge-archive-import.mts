/**
 * Remove everything the archive import created, so it can be re-run from a clean slate.
 *
 * Scoped by construction: Seasons are matched on the `8brcam-` slug prefix the importer assigns,
 * and accounts on the `@archive.8br.invalid` address it mints. Nothing a human created can match
 * either, so this cannot reach a real member or a hand-made Season.
 *
 * Run:
 *   node scripts/run-with-esm.mjs npx tsx --env-file=.env --tsconfig scripts/tsconfig.verify.json \
 *     scripts/purge-archive-import.mts --seasons --accounts --yes
 */
try {
  process.loadEnvFile('.env')
} catch {
  /* absent file is fine */
}

import { prisma } from '../src/lib/prisma.ts'

const args = process.argv.slice(2)
const has = (n: string) => args.includes(`--${n}`)
const DO_SEASONS = has('seasons')
const DO_ACCOUNTS = has('accounts')
const CONFIRMED = has('yes')

async function main() {
  if (!DO_SEASONS && !DO_ACCOUNTS) {
    console.log('Nothing selected. Pass --seasons and/or --accounts (add --yes to apply).')
    return
  }

  const seasons = await prisma.season.findMany({
    where: { slug: { startsWith: '8brcam-' } },
    select: { id: true, number: true },
  })
  const users = await prisma.$queryRaw<{ id: number }[]>`
    SELECT id FROM payload.users WHERE email ILIKE '%@archive.8br.invalid'`
  const userIds = users.map((u) => Number(u.id))
  const players = userIds.length
    ? await prisma.player.findMany({ where: { linkedUserId: { in: userIds.map(String) } }, select: { id: true } })
    : []

  console.log(`archive Seasons : ${seasons.length}`)
  console.log(`archive accounts: ${userIds.length} (with ${players.length} linked profiles)`)
  if (!CONFIRMED) {
    console.log('\nDry run — pass --yes to delete.')
    return
  }

  if (DO_SEASONS && seasons.length) {
    // Season children all cascade from Season; the ledger references it without a cascade.
    const ids = seasons.map((s) => s.id)
    await prisma.ratingLedger.deleteMany({ where: { seasonId: { in: ids } } })
    const del = await prisma.season.deleteMany({ where: { id: { in: ids } } })
    console.log(`deleted ${del.count} Season(s)`)
  }

  if (DO_ACCOUNTS && userIds.length) {
    const pids = players.map((p) => p.id)
    if (pids.length) {
      await prisma.ratingLedger.deleteMany({ where: { playerId: { in: pids } } })
      await prisma.playerMerge.deleteMany({ where: { OR: [{ canonicalPlayerId: { in: pids } }, { mergedPlayerId: { in: pids } }] } })
      await prisma.seasonEntrant.deleteMany({ where: { playerId: { in: pids } } })
      await prisma.player.deleteMany({ where: { id: { in: pids } } })
    }
    // Payload owns the users table; delete through SQL to avoid booting Payload for a teardown.
    await prisma.$executeRaw`DELETE FROM payload.users_roles WHERE parent_id IN (SELECT id FROM payload.users WHERE email ILIKE '%@archive.8br.invalid')`
    const n = await prisma.$executeRaw`DELETE FROM payload.users WHERE email ILIKE '%@archive.8br.invalid'`
    console.log(`deleted ${pids.length} profile(s) and ${n} account(s)`)
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })
