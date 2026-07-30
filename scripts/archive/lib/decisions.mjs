/**
 * Review-decision store (shared logic for the pipeline scripts). The dashboard
 * (TS) writes decisions in the SAME on-disk format; this module reads them (for
 * apply-reviews) and can write them (for the save/history test). Never deletes
 * history — every write is appended to history.json and the prior current decision
 * is preserved on the new decision's `previous` field.
 */
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './io.mjs'

export const DECISIONS_DIR = path.join(REPO_ROOT, 'data', 'review-decisions')
const DECISIONS_FILE = 'decisions.json'
const HISTORY_FILE = 'history.json'

/** Stable, content-derived issue id (survives review-queue regeneration). */
export function issueIdOf(type, ref) {
  return `${type}::${ref}`
}

function readJsonSafe(dir, name, fallback) {
  const p = path.join(dir, name)
  if (!fs.existsSync(p)) return fallback
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

function writeJsonDet(dir, name, data) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2) + '\n', 'utf8')
}

/** Sort object keys so decisions.json is deterministic for a given decision set. */
function sortedDecisions(map) {
  const out = {}
  for (const k of Object.keys(map).sort()) out[k] = map[k]
  return out
}

export function readDecisions(dir = DECISIONS_DIR) {
  const store = readJsonSafe(dir, DECISIONS_FILE, { decisions: {} })
  return store.decisions || {}
}

export function readHistory(dir = DECISIONS_DIR) {
  return readJsonSafe(dir, HISTORY_FILE, [])
}

/**
 * Record a decision. `input` = { issueId, category, relatedIds, resolution,
 * status, note, reviewer, evidence? }. Returns the new decision.
 */
export function recordDecision(input, opts = {}) {
  const dir = opts.dir || DECISIONS_DIR
  const now = opts.now || new Date().toISOString()
  const decisions = readDecisions(dir)
  const prior = decisions[input.issueId] || null
  const next = {
    issueId: input.issueId,
    category: input.category,
    relatedIds: input.relatedIds || [],
    resolution: input.resolution,
    status: input.status,
    note: input.note || null,
    evidence: input.evidence || null,
    reviewer: input.reviewer,
    timestamp: now,
    version: (prior?.version || 0) + 1,
    previous: prior, // full prior decision preserved (never overwritten)
    // Optional, backwards-compatible extensions:
    batchId: input.batchId || null,
    evidenceSignals: input.evidenceSignals || null,
    reviewerReason: input.reviewerReason || null,
    affectedFields: input.affectedFields || null,
    relatedDecisionIds: input.relatedDecisionIds || null,
  }
  decisions[input.issueId] = next
  writeJsonDet(dir, DECISIONS_FILE, { decisions: sortedDecisions(decisions) })
  const history = readHistory(dir)
  history.push(next)
  writeJsonDet(dir, HISTORY_FILE, history)
  return next
}
