import 'server-only'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { ReviewStatus } from './config'

// `fs` via createRequire (not a static `import fs from 'node:fs'`): a static fs
// import + fs.X() calls makes the Turbopack production build emit consuming pages
// as ESM, breaking Vercel's CommonJS launcher (ERR_REQUIRE_ESM, Next.js #91663).
const fs = createRequire(import.meta.url)('node:fs') as typeof import('node:fs')

const DECISIONS_DIR = path.join(process.cwd(), 'data', 'review-decisions')
const DECISIONS_FILE = path.join(DECISIONS_DIR, 'decisions.json')
const HISTORY_FILE = path.join(DECISIONS_DIR, 'history.json')

export interface Decision {
  issueId: string
  category: string
  relatedIds: string[]
  resolution: string
  status: ReviewStatus
  note: string | null
  evidence: Record<string, unknown> | null
  reviewer: string
  timestamp: string
  version: number
  previous: Decision | null
  // Optional, backwards-compatible extensions:
  batchId?: string | null
  evidenceSignals?: string[] | null
  reviewerReason?: string | null
  affectedFields?: string[] | null
  relatedDecisionIds?: string[] | null
}

export interface DecisionInput {
  issueId: string
  category: string
  relatedIds?: string[]
  resolution: string
  status: ReviewStatus
  note?: string | null
  evidence?: Record<string, unknown> | null
  reviewer: string
  batchId?: string | null
  evidenceSignals?: string[] | null
  reviewerReason?: string | null
  affectedFields?: string[] | null
  relatedDecisionIds?: string[] | null
}

function readJsonSafe<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T
}

export function readDecisions(): Record<string, Decision> {
  const store = readJsonSafe<{ decisions?: Record<string, Decision> }>(DECISIONS_FILE, { decisions: {} })
  return store.decisions ?? {}
}

export function readHistory(): Decision[] {
  return readJsonSafe<Decision[]>(HISTORY_FILE, [])
}

/** Write a decision. Same on-disk format as scripts/archive/lib/decisions.mjs.
 *  Never overwrites: the prior decision is kept on `previous` and appended to history. */
export function recordDecision(input: DecisionInput): Decision {
  fs.mkdirSync(DECISIONS_DIR, { recursive: true })
  const decisions = readDecisions()
  const prior = decisions[input.issueId] ?? null
  const next: Decision = {
    issueId: input.issueId,
    category: input.category,
    relatedIds: input.relatedIds ?? [],
    resolution: input.resolution,
    status: input.status,
    note: input.note ?? null,
    evidence: input.evidence ?? null,
    reviewer: input.reviewer,
    timestamp: new Date().toISOString(),
    version: (prior?.version ?? 0) + 1,
    previous: prior,
    batchId: input.batchId ?? null,
    evidenceSignals: input.evidenceSignals ?? null,
    reviewerReason: input.reviewerReason ?? null,
    affectedFields: input.affectedFields ?? null,
    relatedDecisionIds: input.relatedDecisionIds ?? null,
  }
  decisions[input.issueId] = next
  const sorted: Record<string, Decision> = {}
  for (const k of Object.keys(decisions).sort()) sorted[k] = decisions[k]
  fs.writeFileSync(DECISIONS_FILE, JSON.stringify({ decisions: sorted }, null, 2) + '\n', 'utf8')
  const history = readHistory()
  history.push(next)
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2) + '\n', 'utf8')
  return next
}
