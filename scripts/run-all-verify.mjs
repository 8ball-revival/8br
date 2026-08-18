/**
 * Run every verify suite and report one summary.
 *
 * Suites that touch Payload need the ESM wrapper (it transiently flips package.json to
 * "type":"module"); the rest run directly, which is faster. Each suite gets a timeout so one hung
 * script cannot stall the whole sweep, and the wrapper is always given the chance to restore
 * package.json rather than being killed outright.
 *
 * Run:  node scripts/run-all-verify.mjs
 */
import { readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const TIMEOUT_MS = 240_000

const suites = readdirSync(path.join(ROOT, 'scripts'))
  .filter((f) => f.startsWith('verify-') && f.endsWith('.mts'))
  .sort()

/** A suite needs the ESM wrapper if anything it pulls in reaches Payload. */
function needsEsm(file) {
  const src = readFileSync(path.join(ROOT, 'scripts', file), 'utf8')
  return /payload|staff-auth|account\/auth|editorial\/(permissions|comments|service|queries|pages|actions)|editorial\/article-editor|staff\/members|moderation/.test(src)
}

const results = []
for (const suite of suites) {
  const esm = needsEsm(suite)
  const args = esm
    ? ['scripts/run-with-esm.mjs', 'npx', 'tsx', '--tsconfig', 'scripts/tsconfig.verify.json', '--env-file=.env', `scripts/${suite}`]
    : ['npx', 'tsx', '--tsconfig', 'scripts/tsconfig.verify.json', '--env-file=.env', `scripts/${suite}`]
  const cmd = esm ? process.execPath : 'npx.cmd'
  const argv = esm ? args : args.slice(1)

  const started = Date.now()
  const run = spawnSync(cmd, argv, { cwd: ROOT, encoding: 'utf8', timeout: TIMEOUT_MS, shell: !esm })
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`

  // Prefer the suite's own tally; fall back to the exit code for suites that do not print one.
  const tally = /(PASS|FAIL) — (\d+) passed, (\d+) failed/.exec(out)
  const ok = run.status === 0 && (!tally || tally[1] === 'PASS')
  results.push({
    suite,
    ok,
    seconds,
    detail: tally ? `${tally[2]} passed, ${tally[3]} failed` : run.error ? String(run.error.message) : `exit ${run.status}`,
    output: ok ? '' : out.slice(-2500),
  })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${suite.padEnd(42)} ${results.at(-1).detail}  (${seconds}s)`)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${'='.repeat(72)}`)
console.log(`${results.length - failed.length}/${results.length} suites passed`)

if (failed.length) {
  for (const f of failed) {
    console.log(`\n--- ${f.suite} ---\n${f.output}`)
  }
}

// A wrapper killed mid-run leaves package.json flipped; say so loudly rather than leaving it broken.
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
if (pkg.type === 'module') {
  console.log('\nWARNING: package.json still has "type":"module" — restore it with: git checkout package.json')
}

process.exit(failed.length === 0 ? 0 : 1)
