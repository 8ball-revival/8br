/**
 * archive:import — DRY-RUN ONLY. Never connects to PostgreSQL, never writes rows.
 * Real execution is disabled: anything other than --dry-run is refused.
 *
 *   npm run archive:import -- --dry-run              # plan from data/staging
 *   npm run archive:import -- --dry-run --reviewed   # plan from data/reviewed-staging
 *
 * Future real importer design: idempotent (upsert by staging→legacy natural key),
 * transactional (per-entity batches), resumable (applied-ids log), logged, scoped
 * (--entity / --competition), gated (--max-review / --stop-on-blockers).
 */
import path from 'node:path'
import { STAGING_DIR, REPORTS_DIR, REPO_ROOT, readJson, writeJson, fileExists } from './lib/io.mjs'

const REVIEWED_DIR = path.join(REPO_ROOT, 'data', 'reviewed-staging')
const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=').slice(1).join('=') : undefined
}

if (!has('--dry-run')) {
  console.error('✋ Real archive import is DISABLED during the staging/review phase.')
  console.error('   Re-run with a dry run:  npm run archive:import -- --dry-run [--reviewed]')
  process.exit(1)
}

const ORDER = [
  ['sources', 'sources.json'],
  ['players', 'players.json'],
  ['competitors', 'competitors.json'],
  ['aliases', 'aliases.json'],
  ['competitions', 'competitions.json'],
  ['divisions', 'divisions.json'],
  ['stages', 'stages.json'],
  ['groups', 'groups.json'],
  ['entries', 'entries.json'],
  ['seeds', 'seeds.json'],
  ['standings', 'standings.json'],
  ['matches', 'matches.json'],
  ['championships', 'championships.json'],
  ['achievements', 'achievements.json'],
  ['identityRelationships', 'identity-relationships.json'],
  ['sourceReferences', 'source-references.json'],
  ['historicalNotes', 'historical-notes.json'],
]

function main() {
  const reviewed = has('--reviewed')
  const dir = reviewed ? REVIEWED_DIR : STAGING_DIR
  if (reviewed && !fileExists(path.join(REVIEWED_DIR, 'championships.json'))) {
    console.error('No reviewed-staging found. Run:  npm run archive:apply-reviews')
    process.exit(1)
  }

  const summary = readJson(REPORTS_DIR, 'validation-summary.json')
  const applied = reviewed && fileExists(path.join(REPORTS_DIR, 'applied-decisions.json'))
    ? readJson(REPORTS_DIR, 'applied-decisions.json')
    : []
  const unresolved = reviewed && fileExists(path.join(REPORTS_DIR, 'unresolved-after-review.json'))
    ? readJson(REPORTS_DIR, 'unresolved-after-review.json')
    : []

  const onlyEntity = val('entity')
  const onlyCompetition = val('competition')
  const maxReview = val('max-review') ? Number(val('max-review')) : Infinity

  const remainingBlockers = reviewed
    ? unresolved.filter((u) => u.severity === 'high').length
    : summary.importReadiness.highSeverityIssues
  const advisory = reviewed
    ? unresolved.filter((u) => u.severity !== 'high').length
    : summary.reviewQueueSize - summary.importReadiness.highSeverityIssues

  console.log(`=== archive:import (DRY RUN${reviewed ? ', REVIEWED' : ', RAW'}) — no DB connection, no rows written ===`)
  console.log(`source: ${reviewed ? 'data/reviewed-staging' : 'data/staging'}`)

  let halt = false
  if (summary.importReadiness.schemaBlockers.length > 0 && has('--stop-on-blockers')) {
    console.log(`GATE: schema blockers → real import would STOP.`)
    halt = true
  }
  if (remainingBlockers > maxReview) {
    console.log(`GATE: unresolved blockers ${remainingBlockers} > --max-review ${maxReview} → real import would STOP.`)
    halt = true
  }

  const plan = []
  let total = 0
  for (const [entity, file] of ORDER) {
    if (onlyEntity && entity !== onlyEntity) continue
    let rows = readJson(dir, file)
    if (onlyCompetition) rows = rows.filter((r) => r.competitionStagingId === onlyCompetition || r.stagingId === onlyCompetition)
    const reviewedCount = reviewed ? rows.filter((r) => r && r.review).length : 0
    total += rows.length
    plan.push({ entity, file, records: rows.length, reviewedRecords: reviewedCount })
    console.log(`  ${String(rows.length).padStart(6)} ${entity}${reviewed && reviewedCount ? `  (reviewed: ${reviewedCount})` : ''}`)
  }

  const eligible = Math.max(0, total - remainingBlockers)
  console.log('---')
  console.log(`Raw staging records:        ${reviewed ? '(see data/staging)' : total}`)
  console.log(`Reviewed staging records:   ${reviewed ? total : '(run with --reviewed)'}`)
  console.log(`Applied decisions:          ${applied.length}`)
  console.log(`Remaining unresolved blockers (high severity): ${remainingBlockers}`)
  console.log(`Advisory issues:            ${advisory}`)
  console.log(`Records eligible for import: ${eligible}`)
  console.log(halt ? 'RESULT: real import would HALT on the gate(s) above.' : 'RESULT: dry run only — nothing written.')
  console.log('No PostgreSQL connection was opened. No rows were inserted, updated, or deleted.')

  writeJson(REPORTS_DIR, reviewed ? 'import-dry-run-reviewed.json' : 'import-dry-run.json', {
    mode: 'dry-run',
    reviewed,
    databaseConnection: 'none',
    rowsWritten: 0,
    scope: { entity: onlyEntity ?? null, competition: onlyCompetition ?? null },
    appliedDecisions: applied.length,
    remainingUnresolvedBlockers: remainingBlockers,
    advisoryIssues: advisory,
    recordsEligibleForImport: eligible,
    wouldHalt: halt,
    plan,
    totalPlanned: total,
  })
}

main()
