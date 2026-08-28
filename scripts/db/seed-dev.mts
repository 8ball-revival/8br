/**
 * Create the development accounts through Payload, then write the fixture world.
 *
 * Accounts go through Payload's own API rather than straight into the table, because a row written
 * directly has no valid password hash and cannot be logged in to — which would make five carefully
 * separated permission levels useless for testing permissions.
 */
import { getPayload } from 'payload'
import config from '@payload-config'

import { prisma } from '../../src/lib/prisma.ts'
import { assertFixtureDatabase } from '../../src/lib/db-guard.ts'
import { DEV_ACCOUNTS, DEV_PASSWORD, seedAll } from './fixtures.mts'

assertFixtureDatabase('dev:seed')

/*
 * The contexts the Users collection's hooks look for.
 *
 * They are not a bypass invented here — they are the same flags the guarded /setup route and the
 * owner-transfer flow set. The hooks exist so a fresh database cannot have an Owner claimed by
 * accident; a seed building a throwaway fixture database is the one caller that legitimately needs
 * to say "yes, deliberately", and `assertFixtureDatabase` above has already proved where it points.
 */
const SEED_CONTEXT = { allowBootstrap: true, allowOwnerTransfer: true, allowIdentitySync: true }

const log = (message: string) => console.log(`  · ${message}`)
const payload = await getPayload({ config })

log('creating accounts')
const userIdByKey: Record<string, number> = {}

for (const account of DEV_ACCOUNTS) {
  // A reseed re-runs against an existing account list, so an existing address is updated rather
  // than duplicated — Payload rejects a duplicate email, and the seed should be repeatable.
  const existing = await payload.find({
    collection: 'users',
    where: { email: { equals: account.email } },
    limit: 1,
    overrideAccess: true,
  })

  if (existing.docs.length > 0) {
    const id = Number(existing.docs[0].id)
    await payload.update({
      collection: 'users',
      id,
      data: { username: account.username, roles: [account.role] } as never,
      overrideAccess: true,
      context: SEED_CONTEXT,
    })
    userIdByKey[account.key] = id
    continue
  }

  const created = await payload.create({
    collection: 'users',
    data: {
      email: account.email,
      password: DEV_PASSWORD,
      username: account.username,
      roles: [account.role],
    } as never,
    overrideAccess: true,
    context: SEED_CONTEXT,
  })
  userIdByKey[account.key] = Number(created.id)
}

for (const account of DEV_ACCOUNTS) {
  log(`  ${account.role.padEnd(6)} ${account.email} -> user ${userIdByKey[account.key]}`)
}

await seedAll({ log }, userIdByKey)

const counts = {
  players: await prisma.player.count(),
  aliases: await prisma.playerAlias.count(),
  seasons: await prisma.season.count(),
  entrants: await prisma.seasonEntrant.count(),
  groupMatches: await prisma.seasonMatch.count(),
  playoffMatches: await prisma.seasonPlayoffMatch.count(),
  tournaments: await prisma.tournament.count(),
  posts: await prisma.breakPost.count(),
  comments: await prisma.breakComment.count(),
  ledger: await prisma.ratingLedger.count(),
}
console.log('\n  seeded:', JSON.stringify(counts))

await prisma.$disconnect()
process.exit(0)
