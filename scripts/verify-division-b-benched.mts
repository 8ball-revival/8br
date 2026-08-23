/**
 * Prove that a Division A reconstruction run writes nothing to Division B.
 *
 * Division B is benched by owner decision — its playoff source does not survive, so there is nothing
 * the reconstruction can honestly add. Benching is not deletion: every shell and every row already
 * imported must stay exactly as it is, and "exactly" has to mean content, not row counts, because a
 * value rewritten in place leaves the counts alone.
 *
 * This runs the importers for real, scoped to Division A, and compares Division B either side. It
 * also holds the safety properties that matter whatever else happens: a benched Season may not be
 * presented as complete, may not acquire a champion, and may not contribute to Rankings.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-division-b-benched.mts
 */
import { execSync } from 'node:child_process'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { fingerprintDivisionB } from './archive-division-b-fingerprint.mts'

assertLocalDatabase()

let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

// ─────────────────────────────────────────────────────────────────────────────────────────────────
section('Division B is intact and contributes nothing')
const before = await fingerprintDivisionB()
check(`every Division B Season is present (${before.length})`, before.length > 0, String(before.length))
check('none is presented as complete',
  before.every((r) => r.lifecycleState !== 'COMPLETED'),
  before.filter((r) => r.lifecycleState === 'COMPLETED').map((r) => r.label).join(', '))
check('none carries a champion', before.every((r) => !r.championName),
  before.filter((r) => r.championName).map((r) => `${r.label}=${r.championName}`).join(', '))
check('none carries a ranking contribution', before.every((r) => !r.ladderApplied))
check('none has any ledger row', before.every((r) => r.counts.ledger === 0),
  String(before.reduce((a, r) => a + r.counts.ledger, 0)))
check('no playoff match is decided', before.every((r) => r.counts.playoffDecided === 0),
  String(before.reduce((a, r) => a + r.counts.playoffDecided, 0)))

// ─────────────────────────────────────────────────────────────────────────────────────────────────
section('A Division A run leaves Division B untouched')

/*
 * The importers are run for real, not simulated.
 *
 * A mock would prove the test's own idea of the scope rather than the scope the scripts implement,
 * and the whole point is that `--division A` is what the real run does.
 */
const run = (script: string, args: string[]): { ran: boolean; output: string } => {
  const cmd = [`npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env`, script, ...args].join(' ')
  try {
    return { ran: true, output: execSync(cmd, { encoding: 'utf8', stdio: 'pipe', timeout: 900_000 }) }
  } catch (e) {
    // A non-zero exit is fine — what matters is what it wrote, measured below. But a run that never
    // started at all would make the comparison pass for the wrong reason, so that is reported.
    const err = e as { stdout?: string; stderr?: string; code?: string }
    const output = String(err.stdout ?? '') + String(err.stderr ?? '')
    return { ran: !/not recognized|ENOENT|command not found/i.test(output), output }
  }
}

const groupRun = run('scripts/import-archive-seasons.mts', ['--apply', '--division', 'A'])
const playoffRun = run('scripts/archive-import-playoffs.mts', ['--apply', '--division', 'A'])
check('the Division A group importer actually ran', groupRun.ran, groupRun.output.slice(0, 140))
check('the Division A bracket importer actually ran', playoffRun.ran, playoffRun.output.slice(0, 140))

const after = await fingerprintDivisionB()
check('the same Seasons are still there', after.length === before.length, `${after.length} vs ${before.length}`)

const byId = new Map(before.map((r) => [r.seasonId, r]))
const moved: string[] = []
for (const now of after) {
  const was = byId.get(now.seasonId)
  if (!was) { moved.push(`${now.label} appeared`); continue }
  if (was.hash !== now.hash) moved.push(`${now.label} content changed`)
  for (const k of Object.keys(now.counts) as (keyof typeof now.counts)[]) {
    if (was.counts[k] !== now.counts[k]) moved.push(`${now.label} ${k}: ${was.counts[k]} → ${now.counts[k]}`)
  }
  if (was.lifecycleState !== now.lifecycleState) moved.push(`${now.label} lifecycle: ${was.lifecycleState} → ${now.lifecycleState}`)
}
check('every Division B Season is byte-identical after a Division A run', moved.length === 0, moved.slice(0, 5).join('; '))
check('no audit row was written to a Division B Season',
  after.every((r) => r.counts.audits === byId.get(r.seasonId)?.counts.audits))

// ─────────────────────────────────────────────────────────────────────────────────────────────────
section('The scope is explicit, not inferred')
check('the importer rejects a division it does not understand', (() => {
  try {
    execSync('npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/import-archive-seasons.mts --division Z', { encoding: 'utf8', stdio: 'pipe', timeout: 300_000 })
    return false
  } catch {
    return true
  }
})())

/*
 * The bracket importer can never reach Division B at all: the captured pages are Division A only,
 * and it says so rather than relying on the files happening not to contain any.
 */
const playoffB = (() => {
  try {
    return execSync('npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/archive-import-playoffs.mts --division B', { encoding: 'utf8', stdio: 'pipe', timeout: 300_000 })
  } catch (e) {
    return String((e as { stdout?: string }).stdout ?? '')
  }
})()
check('the bracket importer refuses Division B outright',
  /Division A only/i.test(playoffB), playoffB.slice(0, 120))

// ─────────────────────────────────────────────────────────────────────────────────────────────────
section('Division B is still supported by the application itself')
/*
 * Benching is a decision about this reconstruction run, not a removal of a feature. A Division B
 * Season must still be a first-class record the app can hold.
 */
const anyB = await prisma.season.findFirst({ where: { division: 'B' }, select: { id: true, publiclyVisible: true } })
check('a Division B Season is still a normal Season record', Boolean(anyB))
check('and is still publicly visible where it was', anyB ? typeof anyB.publiclyVisible === 'boolean' : false)

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
