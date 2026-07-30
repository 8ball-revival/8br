import 'server-only'
import path from 'node:path'
import { createRequire } from 'node:module'
import { readDecisions, readHistory, type Decision } from './decisions'

// Load `fs` via createRequire rather than a static `import fs from 'node:fs'`.
// A static fs import + fs.X() calls makes the Turbopack production build emit the
// consuming pages as ESM, which breaks Vercel's CommonJS serverless launcher
// (ERR_REQUIRE_ESM). See Next.js discussion #91663. This keeps the sync fs API
// while removing the trigger. (These files are read only by the local-only
// archive-review tool; the data lives in gitignored dirs not deployed to Vercel.)
const fs = createRequire(import.meta.url)('node:fs') as typeof import('node:fs')

const ROOT = process.cwd()
const readJson = <T = unknown>(rel: string): T => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')) as T
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel))

export const ACTIONABLE_TYPES = ['shared-alias', 'merge-candidate', 'name-duplicate', 'match', 'championship']
const APPLIED = ['approved', 'resolved']

export function issueIdOf(type: string, ref: string) {
  return `${type}::${ref}`
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let _context: Record<string, any> | null = null
function context(): Record<string, any> {
  if (_context) return _context
  _context = exists('reports/archive/review-context.json')
    ? readJson<Record<string, any>>('reports/archive/review-context.json')
    : {}
  return _context
}
function reviewQueue(): any[] {
  return exists('reports/archive/review-queue.json') ? readJson('reports/archive/review-queue.json') : []
}
function historicalNotes(): any[] {
  return exists('data/staging/historical-notes.json') ? readJson('data/staging/historical-notes.json') : []
}

export interface RawIssue {
  issueId: string
  category: string
  ref: string
  reason: string
  severity: string
  detail: any
}

export function buildUniverse(): RawIssue[] {
  const items: RawIssue[] = []
  for (const it of reviewQueue()) {
    if (!ACTIONABLE_TYPES.includes(it.type)) continue
    items.push({ issueId: issueIdOf(it.type, it.ref), category: it.type, ref: it.ref, reason: it.reason, severity: it.severity, detail: it.detail })
  }
  for (const n of historicalNotes())
    items.push({ issueId: issueIdOf('historical-note', n.stagingId), category: 'historical-note', ref: n.stagingId, reason: n.title, severity: 'info', detail: n })
  items.push({ issueId: 'entry-method::global', category: 'entry-method', ref: 'global', reason: 'Default historical CompetitionEntry method', severity: 'medium', detail: null })
  return items
}

const EMPTY_STATUS = { pending: 0, approved: 0, rejected: 0, deferred: 0, needs_evidence: 0, resolved: 0 }

export function getProgress() {
  const decisions = readDecisions()
  const history = readHistory()
  const universe = buildUniverse()
  const byStatus: Record<string, number> = { ...EMPTY_STATUS }
  const byCategory: Record<string, any> = {}
  let highRemaining = 0
  let advisoryRemaining = 0
  for (const u of universe) {
    const d = decisions[u.issueId]
    const st = d?.status ?? 'pending'
    byStatus[st] = (byStatus[st] ?? 0) + 1
    byCategory[u.category] = byCategory[u.category] ?? { total: 0, ...EMPTY_STATUS }
    byCategory[u.category].total++
    byCategory[u.category][st] = (byCategory[u.category][st] ?? 0) + 1
    const applied = d && APPLIED.includes(d.status)
    if (!applied) {
      if (u.severity === 'high') highRemaining++
      else advisoryRemaining++
    }
  }
  const reviewed = universe.filter((u) => decisions[u.issueId]).length
  const lastActivity = history.length ? history[history.length - 1].timestamp : null
  return {
    total: universe.length,
    reviewed,
    completionPct: universe.length ? Math.round((reviewed / universe.length) * 100) : 0,
    byStatus,
    byCategory,
    highSeverityRemaining: highRemaining,
    advisoryRemaining,
    lastActivity,
    decided: Object.keys(decisions).length,
  }
}

export function getImportReadiness() {
  return exists('reports/archive/validation-summary.json') ? readJson<any>('reports/archive/validation-summary.json').importReadiness : null
}

export function getRecentHistory(limit = 40): Decision[] {
  return readHistory().slice(-limit).reverse()
}

export interface DashboardIssue extends RawIssue {
  status: string
  decision: Decision | null
  historyCount: number
  relatedIds: string[]
  enriched: any
}

export function listIssues(
  category: string,
  opts: { q?: string; severity?: string; status?: string; page?: number; pageSize?: number } = {},
) {
  const { q = '', severity = '', status = '', page = 1, pageSize = 20 } = opts
  const decisions = readDecisions()
  const history = readHistory()
  const ctx = context()
  const historyCounts = new Map<string, number>()
  for (const h of history) historyCounts.set(h.issueId, (historyCounts.get(h.issueId) ?? 0) + 1)

  let items = buildUniverse().filter((u) => u.category === category)
  const query = q.trim().toLowerCase()
  if (query) items = items.filter((u) => `${u.ref} ${u.reason} ${JSON.stringify(ctx[u.issueId] ?? u.detail ?? '')}`.toLowerCase().includes(query))
  if (severity) items = items.filter((u) => u.severity === severity)
  if (status) items = items.filter((u) => (decisions[u.issueId]?.status ?? 'pending') === status)

  const total = items.length
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const cur = Math.min(Math.max(1, page), pages)
  const slice = items.slice((cur - 1) * pageSize, cur * pageSize)

  const issues: DashboardIssue[] = slice.map((u) => ({
    ...u,
    status: decisions[u.issueId]?.status ?? 'pending',
    decision: decisions[u.issueId] ?? null,
    historyCount: historyCounts.get(u.issueId) ?? 0,
    relatedIds: u.detail?.players ?? [u.ref],
    enriched: ctx[u.issueId] ?? (u.category === 'historical-note' ? { kind: 'note', note: u.detail } : { kind: 'other' }),
  }))
  return { issues, total, page: cur, pages }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
