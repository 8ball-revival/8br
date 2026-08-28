/**
 * The guards that keep development away from production.
 *
 * ── What this suite is protecting ───────────────────────────────────────────────────────────────
 * The database serving 8br.gg holds the only copy of two decades of competition history. Everything
 * here is a refusal, and a refusal that stops working is silent — nothing fails, a command simply
 * starts succeeding somewhere it should not. So each one is exercised against the thing it is meant
 * to stop, rather than asserted to exist.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-environment-safety.mts
 */
import { readFileSync, existsSync } from 'node:fs'

import {
  assertFixtureDatabase,
  assertPreviewIsolation,
  inspectConnection,
  FIXTURE_DATABASES,
  FORBIDDEN_DATABASES,
  PRODUCTION_DB_ENDPOINT,
} from '../src/lib/db-guard.ts'

let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures++
}

/** Did the call refuse? Returns the first line of the refusal, or null if it was allowed through. */
const refused = (fn: () => void): string | null => {
  try { fn(); return null } catch (e) { return (e as Error).message.split('\n')[0] }
}

const PRODUCTION = `postgresql://u:p@${PRODUCTION_DB_ENDPOINT}-awpmeuv7.c-12.us-east-1.aws.neon.tech/eightballregistry_local_20260827`
const STAGING = 'postgresql://u:p@ep-odd-frost-awmhqovi.c-12.us-east-1.aws.neon.tech/8br_staging_fixtures'
const FIXTURES = 'postgresql://postgres:x@127.0.0.1:55432/8br_dev_fixtures'
const PRESERVED = 'postgresql://postgres:x@127.0.0.1:55432/PRESERVED_recovery_8br_dev_redesign_20260827'

console.log('--- Fixtures cannot be written anywhere real ---')

check('production is refused', refused(() => assertFixtureDatabase('t', { DATABASE_URL: PRODUCTION } as never)) != null)
check('the preserved recovery database is refused', refused(() => assertFixtureDatabase('t', { DATABASE_URL: PRESERVED } as never)) != null)
check('an unknown local database is refused',
  refused(() => assertFixtureDatabase('t', { DATABASE_URL: 'postgresql://postgres:x@127.0.0.1:55432/anything' } as never)) != null)
check('a remote host is refused even with a fixture name',
  refused(() => assertFixtureDatabase('t', { DATABASE_URL: 'postgresql://u:p@somewhere.neon.tech/8br_dev_fixtures' } as never)) != null)
check('a missing URL is refused rather than defaulted', refused(() => assertFixtureDatabase('t', {} as never)) != null)
/*
 * The one that matters most. `assertLocalDatabase` returns early on Vercel because the deployed app
 * is supposed to write to production; a fixture never is, anywhere, so this must not inherit that.
 */
check('a deployment is refused even with a fixture database',
  refused(() => assertFixtureDatabase('t', { VERCEL: '1', DATABASE_URL: FIXTURES } as never)) != null)
check('...and the fixture database itself is allowed',
  refused(() => assertFixtureDatabase('t', { DATABASE_URL: FIXTURES } as never)) == null)

console.log('\n--- A preview deployment cannot reach production ---')

check('a preview pointed at production is refused',
  refused(() => assertPreviewIsolation({ VERCEL_ENV: 'preview', DATABASE_URL: PRODUCTION } as never)) != null)
/*
 * By ENDPOINT as well as by name: the mistake worth catching is a fresh database created on
 * production's compute and given an innocent name, which any name-only check waves through.
 */
check('...and so is an innocent name on production\'s endpoint',
  refused(() => assertPreviewIsolation({
    VERCEL_ENV: 'preview',
    DATABASE_URL: `postgresql://u:p@${PRODUCTION_DB_ENDPOINT}-awpmeuv7.c-12.us-east-1.aws.neon.tech/harmless_looking`,
  } as never)) != null)
check('a preview on staging is allowed',
  refused(() => assertPreviewIsolation({ VERCEL_ENV: 'preview', DATABASE_URL: STAGING } as never)) == null)
check('production itself is untouched by the check',
  refused(() => assertPreviewIsolation({ VERCEL_ENV: 'production', DATABASE_URL: PRODUCTION } as never)) == null)

/*
 * The likeliest route to production is not a preview at all — it is a developer's `.env`. Production
 * is served by Vercel, so a process running anywhere else has no business connecting to it.
 */
check('a LOCAL process pointed at production is refused',
  refused(() => assertPreviewIsolation({ DATABASE_URL: PRODUCTION } as never)) != null)
check('...and local development on fixtures is allowed',
  refused(() => assertPreviewIsolation({ DATABASE_URL: FIXTURES } as never)) == null)

console.log('\n--- The lists say what they should ---')

check('the production database is named as forbidden',
  (FORBIDDEN_DATABASES as readonly string[]).includes('eightballregistry_local_20260827'))
check('the preserved recovery database is named as forbidden',
  (FORBIDDEN_DATABASES as readonly string[]).includes('8br_dev_redesign'))
check('fixtures are limited to two databases', FIXTURE_DATABASES.length === 2, FIXTURE_DATABASES.join(', '))
check('production is recognised as production by the connection inspector',
  inspectConnection(PRODUCTION).allowed === false)

console.log('\n--- The build does not touch the database ---')

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
check('vercel-build builds code only', pkg.scripts['vercel-build'] === 'npm run build', pkg.scripts['vercel-build'])
check('...and no build script runs db push', !/db push/.test(pkg.scripts['vercel-build'] + pkg.scripts.build))
check('the old deploy-migrate step is gone', !existsSync('scripts/deploy-migrate.mjs'))
check('migrations are an explicit, separate command', typeof pkg.scripts['db:migrate:production'] === 'string')

console.log('\n--- Retired tooling refuses to run ---')

check('the refusal module exists', existsSync('scripts/_retired.mjs'))
const retired = ['scripts/archive/import.mjs', 'scripts/seed-players.mts', 'scripts/repair-merged-handles.mts', 'scripts/reset-registry-data.mts']
for (const file of retired) {
  const src = existsSync(file) ? readFileSync(file, 'utf8') : ''
  check(`${file} imports the refusal`, /_retired\.mjs/.test(src))
}

console.log('\n--- No credentials in anything committed ---')

/*
 * `.env` is ignored, but the example that replaces it is not, and an example with a real password in
 * it is how a credential reaches a repository.
 */
const gitignore = readFileSync('.gitignore', 'utf8')
check('.env files are ignored', /^\.env\*?$/m.test(gitignore) || /\.env\*/.test(gitignore))
if (existsSync('.env.example')) {
  const example = readFileSync('.env.example', 'utf8')
  check('the example holds no real password', !/npg_[A-Za-z0-9]/.test(example) && !/SXvLdG/.test(example))
  check('...and points at the fixture database', /8br_dev_fixtures/.test(example))
  check('...and never names production', !new RegExp(PRODUCTION_DB_ENDPOINT).test(example) && !/eightballregistry/.test(example))
}

console.log(`\n${failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} check(s) failed`}`)
process.exit(failures === 0 ? 0 : 1)
