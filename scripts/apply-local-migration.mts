// RETIRED — see scripts/_retired.mjs. Importing this file refuses to run.
import './_retired.mjs'

/**
 * Apply one forward-only SQL migration to an approved LOCAL database.
 *
 * This project reconciles Prisma's schema with `db push`, so migration files exist for the record
 * rather than as the mechanism. This applies one of them directly, which is the safe half of
 * `db push`: additive SQL that cannot drop a column the schema file happens not to mention.
 *
 *   npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env \
 *     scripts/apply-local-migration.mts prisma/migrations/<name>/migration.sql
 */
import { readFileSync } from 'node:fs'
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase, inspectConnection } from '../src/lib/db-guard.ts'

assertLocalDatabase('apply-local-migration')

const file = process.argv[2]
if (!file) { console.error('usage: apply-local-migration.mts <path to migration.sql>'); process.exit(1) }

const sql = readFileSync(file, 'utf8')
console.log(`applying ${file} to ${inspectConnection(process.env.DATABASE_URL).summary}`)

// Statement by statement: a single $executeRawUnsafe refuses multiple commands.
const statements = sql
  .split(/;\s*$/m)
  .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
  .filter(Boolean)

for (const statement of statements) {
  console.log(`  ${statement.split('\n')[0].slice(0, 90)}`)
  await prisma.$executeRawUnsafe(statement)
}
console.log(`${statements.length} statement(s) applied`)
await prisma.$disconnect()
