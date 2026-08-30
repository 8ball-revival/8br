/**
 * Prepares the database before the Next.js build so a deployment against a brand-new
 * (empty) PostgreSQL database (e.g. Neon on Vercel) needs zero manual DB work. Applies:
 *   1. Prisma migrations (public schema — competition + records tables) via `prisma migrate deploy`
 *   2. Payload migrations (payload schema — auth / CMS tables) via `payload migrate`
 *
 * ── Why this no longer uses `db push --accept-data-loss` ────────────────────────────────────────
 * It used to, because the Prisma migration history could not replay from empty: some changes
 * (notably Season→Tournament, comp_season→comp_tournament) were applied by hand and never captured,
 * so `20260813000000_remove_tournament_flair_colors` refers to a table no earlier migration creates.
 * `db push` sidestepped that by reconciling the database to schema.prisma directly.
 *
 * The cost of that was a build step allowed to drop whatever stood between the database and the
 * schema, on production, unattended, on every deploy. `--accept-data-loss` is not a warning about a
 * hypothetical: it is the flag that lets a rename be executed as a drop.
 *
 * So the database is BASELINED instead. Every historical migration is recorded as applied in
 * `_prisma_migrations`, which is Prisma's documented answer for an existing database whose history
 * cannot be replayed, and `migrate deploy` then applies only what is genuinely new — reviewed SQL,
 * in a file, that someone approved. It still never runs the broken early migrations, because the
 * baseline says they are done.
 *
 * The one thing this requires: the database must carry that baseline. A brand-new empty database
 * cannot be built by this path, and would need `prisma migrate diff` to generate a fresh baseline
 * first. That is a deliberate trade — the deployment target is an existing database, and protecting
 * it matters more than being able to bootstrap an empty one unattended.
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
 * Idempotent: `migrate deploy` applies only migrations not yet recorded, and `payload migrate`
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
  console.log('\n✓ Database ready: Prisma migrations applied + Payload migrations applied.')
} catch (err) {
  console.error('\n✗ Database preparation failed. Aborting build.')
  console.error(err?.message ?? err)
  process.exit(1)
}
