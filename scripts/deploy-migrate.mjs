/**
 * Prepares the database before the Next.js build so a deployment against a brand-new
 * (empty) PostgreSQL database (e.g. Neon on Vercel) needs zero manual DB work. Applies:
 *   1. Prisma schema (public schema — competition + records tables) via `prisma db push`
 *   2. Payload migrations  → the `payload` schema (auth / CMS tables)
 *
 * Why `db push` and not `migrate deploy`: this project's Prisma migration history is
 * intentionally INCOMPLETE — a number of schema changes (notably the Season→Tournament
 * rename, comp_season→comp_tournament) were applied locally via `db push` / raw SQL and were
 * never captured as migration files. Replaying the committed migrations against a fresh DB
 * therefore fails (later migrations reference comp_tournament, which no migration creates).
 * `db push` reconciles the database to the canonical schema.prisma directly, which is the
 * authoritative source of truth here. `--accept-data-loss` is required once to reconcile any
 * pre-existing drift (e.g. an empty comp_season table); it is harmless for purely additive
 * changes and touches only the `public` schema, never Payload's `payload` schema.
 *
 * Connection: uses DATABASE_URL. If an unpooled/direct URL is available (DATABASE_URL_UNPOOLED /
 * POSTGRES_URL_NON_POOLING / DIRECT_URL), schema ops run over it — Prisma's engine needs
 * advisory locks a pooled/PgBouncer endpoint cannot provide. The app still runs on DATABASE_URL.
 *
 * Idempotent: `db push` is a no-op when the DB already matches the schema, and `payload migrate`
 * skips already-applied migrations, so re-deploys are safe.
 */
import { execSync } from 'node:child_process'

const runtimeUrl = process.env.DATABASE_URL
if (!runtimeUrl) {
  console.error('✗ DATABASE_URL is not set — cannot run migrations.')
  process.exit(1)
}

// Prefer the direct/unpooled connection for migrations when provided. Neon (via the Vercel
// Marketplace integration) injects DATABASE_URL_UNPOOLED / POSTGRES_URL_NON_POOLING for this;
// DIRECT_URL is the manual convention. Fall back to the (possibly pooled) runtime URL.
const migrateUrl =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DIRECT_URL ||
  runtimeUrl
const env = { ...process.env, DATABASE_URL: migrateUrl }

function run(label, cmd, { closeStdin = false } = {}) {
  console.log(`\n▶ ${label}`)
  // closeStdin: give the child an EOF on stdin so an unexpected interactive prompt (e.g. Payload's
  // "you've run in dev mode" reconciliation prompt) fails fast instead of hanging the build forever.
  execSync(cmd, { stdio: [closeStdin ? 'ignore' : 'inherit', 'inherit', 'inherit'], env })
}

// NOTE: The Payload (`payload` schema) side is synced by Payload's own `push` on init
// (postgresAdapter push: true — see src/payload.config.ts), for the same reason as the Prisma
// db push above: the committed Payload migration history is incomplete and cannot reproduce the
// current schema on a fresh DB. Payload creates/updates its schema on the first `getPayload()`
// init (build-time static analysis or first request). So there is no `payload migrate` step here.

try {
  run('Prisma: syncing schema to schema.prisma (public schema)', 'npx prisma db push --accept-data-loss --skip-generate')
  console.log('\n✓ Prisma public schema synced. Payload (payload schema) syncs on init via push.')
} catch (err) {
  console.error('\n✗ Schema sync step failed. Aborting build.')
  console.error(err?.message ?? err)
  process.exit(1)
}
