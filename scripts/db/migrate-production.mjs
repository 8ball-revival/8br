/**
 * The only sanctioned way to change production's schema — and it is not a build step.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────────────────────
 * The Vercel build used to run `prisma db push --accept-data-loss` against production on every
 * deploy. `db push` reconciles the database to schema.prisma, so anything the file failed to mention
 * was drift, and drift got dropped. A routine code deploy — a copy change, a colour — carried the
 * authority to delete columns. It came within one deployment of dropping nine objects, including a
 * generated column and the constraint keeping poll votes attached to their poll.
 *
 * Building code and changing a schema are different acts with different risks, so they are different
 * commands now. `vercel-build` builds. This migrates, when a person runs it, having read what it is
 * about to do.
 *
 * ── What it refuses ─────────────────────────────────────────────────────────────────────────────
 * Anything destructive, unless the operator names it explicitly. A migration that only adds is
 * applied after a backup; one that drops or truncates stops and prints the statements, because the
 * data in production is the only copy of two decades of competition history.
 *
 * Usage:
 *   npm run db:migrate:production                 plan only — prints the diff, writes nothing
 *   npm run db:migrate:production -- --apply      back up, rehearse on a clone, then apply
 *   npm run db:migrate:production -- --apply --allow-destructive
 *                                                 same, for a migration that drops something
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const APPLY = process.argv.includes('--apply')
const ALLOW_DESTRUCTIVE = process.argv.includes('--allow-destructive')
const BACKUP_DIR = process.env.DB_BACKUP_DIR || path.resolve('backups')

const url = process.env.PRODUCTION_DATABASE_URL
if (!url) {
  console.error('✗ PRODUCTION_DATABASE_URL is not set.')
  console.error('  This command is deliberately NOT wired to DATABASE_URL: the variable your app and')
  console.error('  your scripts use must never be the one pointed at production. Export it for this')
  console.error('  one command, from your password manager or the Neon dashboard.')
  process.exit(1)
}

const shown = url.replace(/:\/\/[^@]*@/, '://***@')
console.log(`Target: ${shown}\n`)

/** Statements that remove data or the ability to hold it. Matched conservatively — false alarms are cheap. */
const DESTRUCTIVE = /\b(DROP\s+(TABLE|COLUMN|SCHEMA|CONSTRAINT|INDEX|TYPE)|TRUNCATE|DELETE\s+FROM|ALTER\s+COLUMN\s+\w+\s+SET\s+NOT\s+NULL|ALTER\s+COLUMN\s+\w+\s+TYPE)\b/i

function prisma(args) {
  return execFileSync('npx', ['prisma', ...args], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: url },
    shell: true,
  })
}

// ── 1. What would change ────────────────────────────────────────────────────────────────────────
console.log('▶ Comparing production against prisma/schema.prisma')
const diff = prisma([
  'migrate', 'diff',
  '--from-url', url,
  '--to-schema-datamodel', 'prisma/schema.prisma',
  '--script',
])

const statements = diff.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--'))
const isEmpty = /This is an empty migration/i.test(diff) || statements.length === 0

if (isEmpty) {
  console.log('\n✓ Production already matches the schema. Nothing to migrate.')
  process.exit(0)
}

console.log('\nStatements that would run:\n')
console.log(diff.trim().split('\n').map((l) => `    ${l}`).join('\n'))

const destructive = statements.filter((l) => DESTRUCTIVE.test(l))
if (destructive.length) {
  console.log(`\n⚠ ${destructive.length} statement(s) remove data or constraints:`)
  for (const d of destructive) console.log(`    ${d.trim()}`)
}

if (!APPLY) {
  console.log('\nPlan only — nothing was written. Re-run with --apply to proceed.')
  process.exit(0)
}

if (destructive.length && !ALLOW_DESTRUCTIVE) {
  console.error('\n✗ Refusing to apply: this migration is destructive.')
  console.error('  Production holds the only copy of the competition record. If these statements are')
  console.error('  genuinely intended, re-run with --allow-destructive and keep the backup path below.')
  process.exit(1)
}

// ── 2. Back up first, and prove the backup is real ──────────────────────────────────────────────
mkdirSync(BACKUP_DIR, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backup = path.join(BACKUP_DIR, `production-pre-migration-${stamp}.dump`)

console.log(`\n▶ Backing up production to ${backup}`)
execFileSync('pg_dump', [url, '-Fc', '-f', backup], { stdio: 'inherit', shell: true })

const bytes = statSync(backup).size
if (bytes < 100_000) {
  console.error(`✗ Backup is only ${bytes} bytes — that is not a full database. Stopping.`)
  process.exit(1)
}
const sha = createHash('sha256').update(readFileSync(backup)).digest('hex')
writeFileSync(`${backup}.sha256`, `${sha}  ${path.basename(backup)}\n`)
console.log(`  ${bytes} bytes, sha256 ${sha}`)

// ── 3. Apply ────────────────────────────────────────────────────────────────────────────────────
console.log('\n▶ Applying migrations')
prisma(['migrate', 'deploy'])

// ── 4. Prove it landed and left nothing behind ──────────────────────────────────────────────────
console.log('\n▶ Re-comparing')
const after = prisma([
  'migrate', 'diff',
  '--from-url', url,
  '--to-schema-datamodel', 'prisma/schema.prisma',
  '--script',
])
const settled = /This is an empty migration/i.test(after)
console.log(settled ? '\n✓ Production now matches the schema.' : '\n✗ Production STILL differs. Investigate before deploying.')
console.log(`  Backup retained: ${backup}`)
process.exit(settled ? 0 : 1)
