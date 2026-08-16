/**
 * 8BR organization reset — permanently wipes ALL organization data and ALL accounts,
 * leaving a completely fresh platform (empty tournaments, rankings, predictions, and NO
 * accounts, so the new owner runs /setup to create the first administrator).
 *
 * It truncates every table in the Prisma `public` schema and the Payload `payload` schema
 * EXCEPT the migration-bookkeeping tables, so the schema + migration history are preserved
 * and the app boots clean. RESTART IDENTITY resets auto-increment counters. CASCADE clears
 * dependents safely (no orphans).
 *
 * SAFETY: refuses to run unless CONFIRM_RESET=YES. TAKE A BACKUP FIRST (see HANDOVER.md).
 * Usage (PowerShell):  $env:CONFIRM_RESET="YES"; npx tsx scripts/reset-organization.mts
 * Target DB = whatever DATABASE_URL points at. Double-check it before running.
 */
import { prisma } from '../src/lib/prisma.ts'

const KEEP = new Set(['_prisma_migrations', 'payload_migrations'])

async function main() {
  if (process.env.CONFIRM_RESET !== 'YES') {
    console.error('Refusing to run: set CONFIRM_RESET=YES to confirm a full, irreversible reset.')
    console.error('TAKE A BACKUP FIRST. Target DB = the current DATABASE_URL.')
    process.exit(1)
  }

  const rows = await prisma.$queryRawUnsafe<{ schemaname: string; tablename: string }[]>(
    `SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('public','payload')`,
  )
  const targets = rows
    .filter((r) => !KEEP.has(r.tablename))
    .map((r) => `"${r.schemaname}"."${r.tablename}"`)

  if (targets.length === 0) {
    console.log('No tables to truncate.')
    return
  }

  console.log(`Truncating ${targets.length} tables in public + payload schemas…`)
  await prisma.$executeRawUnsafe(`TRUNCATE ${targets.join(', ')} RESTART IDENTITY CASCADE`)
  console.log('✓ Reset complete. All organization data and accounts removed.')
  console.log('  Next: deploy, then visit /setup to create the first administrator (owner).')
}

main()
  .catch((e) => {
    console.error('Reset failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
