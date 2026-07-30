/**
 * Runs ALL database migrations before the Next.js build so a deployment against a
 * brand-new (empty) PostgreSQL database (e.g. Neon on Vercel) needs zero manual DB
 * work. Applies:
 *   1. Prisma migrations   → the `public` schema (competition + records tables)
 *   2. Payload migrations  → the `payload` schema (auth / CMS tables)
 *
 * Connection: uses DATABASE_URL. If DIRECT_URL is set (Neon's direct / unpooled
 * connection string), migrations run over it instead — Prisma's migrate engine
 * needs advisory locks that a pooled/PgBouncer endpoint cannot provide. The app
 * itself still runs against DATABASE_URL (which may be the pooled endpoint).
 *
 * Idempotent: both tools skip already-applied migrations, so re-deploys are safe.
 */
import { execSync } from 'node:child_process'

const runtimeUrl = process.env.DATABASE_URL
if (!runtimeUrl) {
  console.error('✗ DATABASE_URL is not set — cannot run migrations.')
  process.exit(1)
}

// Prefer the direct/unpooled connection for migrations when provided.
const migrateUrl = process.env.DIRECT_URL || runtimeUrl
const env = { ...process.env, DATABASE_URL: migrateUrl }

function run(label, cmd) {
  console.log(`\n▶ ${label}`)
  execSync(cmd, { stdio: 'inherit', env })
}

try {
  run('Prisma: applying migrations (public schema)', 'npx prisma migrate deploy')
  run('Payload: applying migrations (payload schema)', 'npx payload migrate')
  console.log('\n✓ All database migrations applied.')
} catch (err) {
  console.error('\n✗ Migration step failed. Aborting build.')
  console.error(err?.message ?? err)
  process.exit(1)
}
