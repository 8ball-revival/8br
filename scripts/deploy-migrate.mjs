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
 * The Payload migrate CLI `require()`s the config, which uses top-level await, so
 * it must be loaded as an ES module. But the app's `package.json` has NO `"type"`
 * field (CommonJS) on purpose: it makes Next/Turbopack emit the `.next/server`
 * JS bundles as CommonJS so Vercel's `___next_launcher.cjs` can `require()` them
 * without ERR_REQUIRE_ESM. So we flip `type` to `module` for ONLY the payload
 * migrate command, then restore the original file verbatim. `next build` runs
 * afterwards under CommonJS.
 */
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
  run('Prisma: applying migrations (public schema)', 'npx prisma migrate deploy')
  withEsmPackage(() => run('Payload: applying migrations (payload schema)', 'npx payload migrate', { closeStdin: true }))
  console.log('\n✓ All database migrations applied.')
} catch (err) {
  console.error('\n✗ Migration step failed. Aborting build.')
  console.error(err?.message ?? err)
  process.exit(1)
}
