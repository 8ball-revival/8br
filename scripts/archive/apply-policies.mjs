/**
 * archive:apply-policies — record the APPROVED default policy decisions as explicit
 * review decisions in the real decision store. Idempotent: skips if the current
 * decision already matches (won't spam history on rerun). These are approved policies,
 * not test data.
 *
 * Applied policies:
 *  1. Historical CompetitionEntry method → Historical Import (how the record entered
 *     EGO's DB, NOT how the player entered the historical competition).
 *  2. EGO Season 1 / 8B Retro seeding note → keep as Historical Administrative
 *     Annotation, internal-only, UNRESOLVED (bracket unchanged; testimony unverified).
 *  3. Non-explicit championships → intentionally NOT auto-upgraded (no decision here).
 */
import { readDecisions, recordDecision } from './lib/decisions.mjs'

const REVIEWER = 'policy@ego (approved default)'

const POLICIES = [
  {
    issueId: 'entry-method::global',
    category: 'entry-method',
    resolution: 'historical_import',
    status: 'approved',
    note: 'Approved policy: archived 8BRCAM competition entries default to Historical Import (how the record entered EGO, not the original registration method).',
    reviewerReason: 'policy',
  },
  {
    issueId: 'historical-note::note:ego-s1-seeding',
    category: 'historical-note',
    resolution: 'keep_internal_only',
    status: 'deferred', // unresolved
    note: 'Approved policy: keep as a Historical Administrative Annotation, internal only, UNRESOLVED. Do not rewrite the bracket or publish the allegation; surviving evidence does not verify the testimony.',
    reviewerReason: 'policy',
  },
]

function main() {
  const current = readDecisions()
  let applied = 0
  let skipped = 0
  for (const p of POLICIES) {
    const cur = current[p.issueId]
    if (cur && cur.resolution === p.resolution && cur.status === p.status) {
      skipped++
      console.log(`  skip (already set): ${p.issueId} → ${p.resolution}/${p.status}`)
      continue
    }
    recordDecision({ ...p, reviewer: REVIEWER })
    applied++
    console.log(`  recorded: ${p.issueId} → ${p.resolution}/${p.status}`)
  }
  console.log(`archive:apply-policies complete — recorded ${applied}, skipped ${skipped}. (Non-explicit championships intentionally left for individual review.)`)
}

main()
