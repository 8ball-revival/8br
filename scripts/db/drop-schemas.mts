/**
 * Drop the application's schemas so the next step can rebuild them from scratch.
 *
 * Separate from the reset orchestrator because this is the irreversible half, and it re-checks the
 * guard itself. A destructive step that trusts its caller to have checked is a destructive step that
 * eventually runs unchecked.
 */
import { prisma } from '../../src/lib/prisma.ts'
import { assertFixtureDatabase } from '../../src/lib/db-guard.ts'

assertFixtureDatabase('dev:reset (drop-schemas)')

await prisma.$executeRawUnsafe('drop schema if exists payload cascade')
await prisma.$executeRawUnsafe('drop schema if exists public cascade')
await prisma.$executeRawUnsafe('create schema public')
console.log('  ✓ public and payload schemas dropped and public recreated')
await prisma.$disconnect()
