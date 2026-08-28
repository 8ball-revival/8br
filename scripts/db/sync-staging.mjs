/**
 * Fill the staging database with the local fixture data.
 *
 * ── Why a copy rather than a seed ───────────────────────────────────────────────────────────────
 * The seed refuses to run against anything that is not a loopback fixture database, deliberately —
 * a seed that can reach a remote host is a seed that can eventually reach the wrong one. So staging
 * is filled by copying the local fixture database, which is dummy data by construction. Nothing
 * needs permission to write invented rows over a network, because nothing does.
 *
 * ── What it refuses ─────────────────────────────────────────────────────────────────────────────
 * Any target that looks like production, by name or by endpoint, and any SOURCE that is not the
 * local fixture database. Staging is allowed to be remote; it is not allowed to be production, and
 * the data going into it is not allowed to be real.
 *
 * Usage:
 *   STAGING_DATABASE_URL=... node scripts/db/sync-staging.mjs
 */
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const source = process.env.DATABASE_URL
const target = process.env.STAGING_DATABASE_URL

if (!target) {
  console.error('✗ STAGING_DATABASE_URL is not set.')
  process.exit(1)
}

const nameOf = (url) => (url ?? '').split('/').pop()?.split('?')[0] ?? ''
const sourceDb = nameOf(source)
const targetDb = nameOf(target)

/* The source must be the local fixture database — the only place dummy data is authored. */
if (sourceDb !== '8br_dev_fixtures' || !/(localhost|127\.0\.0\.1)/.test(source ?? '')) {
  console.error(`✗ Refusing: the source must be 8br_dev_fixtures on localhost, not "${sourceDb}".`)
  console.error('  Staging is a copy of the fixtures. It is never a copy of anything real.')
  process.exit(1)
}

/*
 * Production is refused by NAME and by ENDPOINT. The name check catches the obvious mistake; the
 * endpoint check catches the one where somebody creates a fresh database on production's compute
 * and calls it something innocent.
 */
const FORBIDDEN_NAMES = [
  'eightballregistry_local_20260827',
  'eightballregistry_prod_20260827',
  'eightballregistry_launch_20260818_1458',
  'neondb',
]
const PRODUCTION_ENDPOINT = 'ep-spring-sun'

if (FORBIDDEN_NAMES.includes(targetDb) || target.includes(PRODUCTION_ENDPOINT)) {
  console.error(`✗ Refusing: "${targetDb}" is production, or sits on production's endpoint.`)
  console.error('  Production is the sole authority for real data and is never written by tooling.')
  process.exit(1)
}

if (!targetDb.includes('staging')) {
  console.error(`✗ Refusing: "${targetDb}" is not named as a staging database.`)
  console.error('  Name it so the next person can tell what it is before they connect to it.')
  process.exit(1)
}

const shown = target.replace(/:\/\/[^@]*@/, '://***@')
console.log(`Source: ${sourceDb} (local fixtures)`)
console.log(`Target: ${shown}\n`)

const dir = mkdtempSync(path.join(tmpdir(), 'staging-sync-'))
const dump = path.join(dir, 'fixtures.dump')

/*
 * Quoted, because a Neon connection string carries `&` between its query parameters and an unquoted
 * ampersand ends the command at the shell — which fails in a way that looks like a psql problem and
 * is not one.
 */
const q = (value) => `"${value}"`

console.log('▶ Dumping the local fixture database')
execSync(`pg_dump ${q(source)} -Fc -f ${q(dump)}`, { stdio: 'inherit' })

console.log('▶ Replacing staging')
execSync(`psql ${q(target)} -c ${q('drop schema if exists payload cascade; drop schema if exists public cascade; create schema public;')}`, { stdio: 'inherit' })
execSync(`pg_restore -d ${q(target)} --no-owner --no-privileges ${q(dump)}`, { stdio: 'inherit' })

console.log('\n✓ Staging now holds the same dummy data as local development.')
