/**
 * Prepares the database before the Next.js build so a deployment against a brand-new
 * (empty) PostgreSQL database (e.g. Neon on Vercel) needs zero manual DB work. Applies:
 *   1. Prisma schema (public schema — competition + records tables) via `prisma db push`
 *   2. Payload migrations (payload schema — auth / CMS tables) via `payload migrate`
 *
 * Prisma (public): uses `db push` rather than `migrate deploy` because this project's Prisma
 * migration history is intentionally INCOMPLETE — some changes (notably Season→Tournament,
 * comp_season→comp_tournament) were applied via `db push` / raw SQL and never captured as
 * migration files, so replaying them against a fresh DB fails. `db push` reconciles the DB to
 * the canonical schema.prisma directly. `--accept-data-loss` is needed once to reconcile any
 * pre-existing drift; it is harmless for additive changes and touches only the `public` schema.
 *
 * Payload (payload): uses proper, version-controlled migrations in src/migrations (regenerated
 * from the current config — see 20260815_191908_init). `payload migrate` creates the payload
 * schema on an empty DB and skips already-applied migrations on re-deploys. (Payload's runtime
 * `push` does NOT reliably run in the Vercel serverless production runtime, which is why the
 * schema must be created here at build time — the same reason Prisma runs here.)
 *
 * Connection: uses DATABASE_URL. If an unpooled/direct URL is available (DATABASE_URL_UNPOOLED /
 * POSTGRES_URL_NON_POOLING / DIRECT_URL), schema ops run over it — Prisma's engine needs
 * advisory locks a pooled/PgBouncer endpoint cannot provide. The app still runs on DATABASE_URL.
 *
 * Idempotent: `db push` is a no-op when the DB already matches the schema, and `payload migrate`
 * skips already-applied migrations, so re-deploys are safe.
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

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

/**
 * The Payload migrate CLI `require()`s the config, which uses top-level await, so it must load
 * as an ES module. But the app's package.json has NO `"type"` field (CommonJS) on purpose: it
 * makes Next/Turbopack emit the `.next/server` bundles as CommonJS so Vercel's launcher can
 * `require()` them without ERR_REQUIRE_ESM. So we flip `type` to `module` for ONLY the payload
 * migrate command, then restore the file verbatim. `next build` runs afterwards under CommonJS.
 */
/**
 * Is the Payload schema already provisioned?
 *
 * `payload migrate` refuses to run unattended against a database that was pushed in dev mode. It
 * prints "It looks like you've run Payload in dev mode" and waits for an answer -- and this database
 * carries exactly that marker: one row in payload_migrations called `dev`, standing in for the four
 * real migration files. Closing stdin was supposed to make that fail fast; in practice it is a
 * coin toss, and one production build sat on the prompt for thirty-five minutes before it was killed.
 *
 * So the question is asked here instead, where the answer is unambiguous. A database that already
 * has the Payload schema does not need migrating -- it is the live schema the site is running on --
 * and one that does not is a fresh deployment, which is the case `payload migrate` exists for.
 */
async function payloadSchemaExists() {
  const { Client } = await import('pg')
  const client = new Client({ connectionString: migrateUrl })
  try {
    await client.connect()
    const { rows } = await client.query(
      "select count(*)::int n from information_schema.tables where table_schema = 'payload'",
    )
    return rows[0].n > 0
  } catch {
    // Unreachable or unreadable: fall through to running the migration, which reports its own error.
    return false
  } finally {
    await client.end().catch(() => {})
  }
}

const pkgUrl = new URL('../package.json', import.meta.url)
function withEsmPackage(fn) {
  const original = readFileSync(pkgUrl, 'utf8')
  const pkg = JSON.parse(original)
  pkg.type = 'module'
  writeFileSync(pkgUrl, JSON.stringify(pkg, null, 2) + '\n')
  try {
    fn()
  } finally {
    writeFileSync(pkgUrl, original)
  }
}

try {
  run('Prisma: extensions the schema depends on',
      'npx prisma db execute --schema prisma/schema.prisma --file prisma/sql/pre-push.sql')
  run('Prisma: syncing schema to schema.prisma (public schema)', 'npx prisma db push --accept-data-loss --skip-generate')
  run('Prisma: restoring what the schema language cannot express',
      'npx prisma db execute --schema prisma/schema.prisma --file prisma/sql/post-push.sql')
  if (await payloadSchemaExists()) {
    console.log(String.fromCharCode(10) + 'Payload: schema already provisioned - migrations skipped')
  } else {
    withEsmPackage(() => run('Payload: applying migrations (payload schema)', 'npx payload migrate', { closeStdin: true }))
  }
  console.log('\n✓ Database ready: Prisma public schema synced + Payload migrations applied.')
} catch (err) {
  console.error('\n✗ Database preparation failed. Aborting build.')
  console.error(err?.message ?? err)
  process.exit(1)
}
