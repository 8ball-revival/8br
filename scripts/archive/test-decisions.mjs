// RETIRED — see scripts/_retired.mjs. Importing this file refuses to run.
import '../_retired.mjs'

/**
 * archive:review-test — verifies the decision store: (1) a decision saves, (2) a
 * replacement preserves the prior decision (history + `previous`), nothing overwritten.
 * Runs against an ISOLATED temp dir so the real store is untouched. Exit 1 on failure.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { recordDecision, readDecisions, readHistory } from './lib/decisions.mjs'

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg)
    process.exit(1)
  }
  console.log('ok:', msg)
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ego-review-test-'))
try {
  const base = { issueId: 'championship::ch:2005-s1-single', category: 'championship', relatedIds: ['ch:2005-s1-single'], reviewer: 'test@ego' }

  const d1 = recordDecision({ ...base, resolution: 'approve_current_confidence', status: 'pending', note: 'first' }, { dir, now: '2026-07-29T00:00:00.000Z' })
  assert(d1.version === 1, 'first decision is version 1')
  assert(d1.previous === null, 'first decision has no previous')

  const d2 = recordDecision({ ...base, resolution: 'downgrade_confidence', status: 'approved', note: 'second' }, { dir, now: '2026-07-29T01:00:00.000Z' })
  assert(d2.version === 2, 'replacement is version 2')
  assert(d2.previous && d2.previous.version === 1, 'replacement preserves prior decision on `previous`')
  assert(d2.previous.resolution === 'approve_current_confidence', 'prior resolution preserved (not overwritten)')

  const current = readDecisions(dir)[base.issueId]
  assert(current.version === 2 && current.status === 'approved', 'current decision is the latest')

  const history = readHistory(dir)
  assert(history.length === 2, 'history preserved both writes (append-only)')
  assert(history[0].version === 1 && history[1].version === 2, 'history is ordered and complete')

  // ---- batch decisions: shared batchId, per-issue history, reversible ----
  const batchId = 'batch-test-001'
  const ids = ['match::ma:g:aaa', 'match::ma:g:bbb']
  for (const issueId of ids) {
    recordDecision(
      { issueId, category: 'match', resolution: 'preserve_as_archived', status: 'approved', note: 'batch preserve', reviewer: 'test@ego', batchId, relatedDecisionIds: ids },
      { dir, now: '2026-07-29T02:00:00.000Z' },
    )
  }
  const afterBatch = readDecisions(dir)
  assert(afterBatch[ids[0]].batchId === batchId && afterBatch[ids[1]].batchId === batchId, 'batch: each issue carries the shared batchId')
  assert(afterBatch[ids[0]].relatedDecisionIds.length === 2, 'batch: relatedDecisionIds links siblings')
  assert(afterBatch[ids[0]].version === 1, 'batch: individual decisions created per issue')

  // reverse one batch decision via a NEW decision (not deletion)
  const rev = recordDecision(
    { issueId: ids[0], category: 'match', resolution: 'mark_score_disputed', status: 'pending', note: 'reverse', reviewer: 'test@ego' },
    { dir, now: '2026-07-29T03:00:00.000Z' },
  )
  assert(rev.version === 2 && rev.previous.batchId === batchId, 'batch: reversal is a new version preserving the batch decision on `previous`')
  const hist = readHistory(dir)
  assert(hist.length === 5, 'batch: history is fully append-only (2 base + 2 batch + 1 reversal)')

  console.log('PASS: decision save + history preservation + safe batch + batch history')
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
