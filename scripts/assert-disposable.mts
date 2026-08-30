/**
 * Preflight for the verification sweep: is this database one we are allowed to destroy?
 *
 * Exits non-zero with an explanation if not. Kept as its own script so `run-all-verify.mjs`, which is
 * plain JavaScript, can enforce the rule that lives in `db-guard.ts` rather than carrying a second
 * copy of it that would drift.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=<env> scripts/assert-disposable.mts
 */
import { assertDisposableTestDatabase, inspectDisposable } from '../src/lib/db-guard.ts'

try {
  assertDisposableTestDatabase('run-all-verify')
  console.log(`disposable: ${inspectDisposable(process.env.DATABASE_URL).summary}`)
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
