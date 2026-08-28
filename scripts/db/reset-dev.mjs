/**
 * Rebuild the development database from fixtures.
 *
 * ── What it does ────────────────────────────────────────────────────────────────────────────────
 *   1. Refuses unless DATABASE_URL names a fixture database on localhost.
 *   2. Drops and recreates the `public` and `payload` schemas.
 *   3. Applies the Prisma schema and the Payload migrations.
 *   4. Creates the five permission-level accounts through Payload, so their passwords work.
 *   5. Writes the deterministic fixture world.
 *
 * ── Why it refuses so much ──────────────────────────────────────────────────────────────────────
 * This command drops schemas. Pointed at the wrong database it would be the single most destructive
 * thing in the repository, so it does not rely on the operator having the right `.env` open: it
 * checks, and it fails closed. `assertFixtureDatabase` accepts only databases that hold dummy data,
 * has no Vercel exemption, and offers no override flag.
 *
 * Idempotent by construction — it rebuilds from empty every time, so running it twice leaves exactly
 * what running it once did.
 *
 * Usage:
 *   npm run dev:reset        drop, migrate, seed
 *   npm run dev:seed         reseed only, leaving the schema alone
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SEED_ONLY = process.argv.includes('--seed-only')

function run(label, command, args) {
  process.stdout.write(`\n▶ ${label}\n`)
  execFileSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: true })
}

/*
 * The guard lives in TypeScript beside the application, so there is one definition of "safe" rather
 * than a second, drifting copy in a shell script. tsx runs it; a refusal exits non-zero and takes
 * this process with it before anything is dropped.
 */
run('Checking the target database is a fixture database',
  'npx', ['tsx', '--tsconfig', 'scripts/tsconfig.verify.json', '--env-file=.env', 'scripts/db/assert-fixture-db.mts'])

if (!SEED_ONLY) {
  run('Dropping and recreating schemas',
    'npx', ['tsx', '--tsconfig', 'scripts/tsconfig.verify.json', '--env-file=.env', 'scripts/db/drop-schemas.mts'])

  run('Applying the Prisma schema', 'npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'])

  // Objects production has that Prisma cannot express — without these, development runs a LOOSER
  // schema than production and only finds the difference after a deploy.
  run('Applying schema extras',
    'npx', ['tsx', '--tsconfig', 'scripts/tsconfig.verify.json', '--env-file=.env', 'scripts/db/apply-schema-extras.mts'])

  // Payload's CLI needs an ES module graph; run-with-esm flips package.json for the one command.
  run('Applying Payload migrations', 'node', ['scripts/run-with-esm.mjs', 'npx', 'payload', 'migrate'])
}

run('Seeding fixtures',
  'node', ['scripts/run-with-esm.mjs', 'npx', 'tsx', '--tsconfig', 'scripts/tsconfig.verify.json', '--env-file=.env', 'scripts/db/seed-dev.mts'])

process.stdout.write('\n✓ Development database rebuilt from fixtures.\n')
process.stdout.write('  Accounts: owner@example.test, admin@example.test, author@example.test, member@example.test\n')
process.stdout.write('  Password: DevPassw0rd!\n')
