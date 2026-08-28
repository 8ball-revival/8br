/**
 * The gate every destructive development command passes through first.
 *
 * A tiny file on purpose: it is invoked as its own process by `reset-dev.mjs` before anything is
 * dropped, so a refusal is a non-zero exit that stops the sequence rather than a condition somebody
 * has to remember to check. The rule itself lives in `src/lib/db-guard.ts`, beside the application,
 * so there is one definition of "safe" rather than a second copy drifting in a script.
 */
import { assertFixtureDatabase, FIXTURE_DATABASES } from '../../src/lib/db-guard.ts'

assertFixtureDatabase('dev:reset')

const database = (process.env.DATABASE_URL ?? '').split('/').pop()?.split('?')[0] ?? '(none)'
console.log(`  ✓ ${database} is a fixture database (${FIXTURE_DATABASES.join(', ')} are permitted)`)
