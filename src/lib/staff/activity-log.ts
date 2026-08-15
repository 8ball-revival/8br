import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/** Activity Log — classification, filtering, pagination over the immutable audit log.
 *  Read-only: the Admin UI never mutates audit rows. Sensitive values are never surfaced. */

export const ACTIVITY_CATEGORIES = [
  'Authentication', 'Accounts', 'Password resets', 'Roles', 'Seasons', 'Tournaments', 'Registration',
  'Teams', 'Results', 'FF', 'KO', 'No Contest', 'Wildcards', 'Disqualifications', 'Rankings', 'Awards',
  'Settings', 'Deletion', 'Security', 'System', 'QA',
] as const
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number]
export type Severity = 'info' | 'notice' | 'warning' | 'critical'

const QA_ACTOR = /verify|vis-|field-|(^|[^a-z])qa([^a-z]|$)/i

/** Actor-level classification: automated verification/QA actors and the internal `system` actor. */
export function actorClass(actorUsername: string): 'human' | 'qa' | 'system' {
  if (actorUsername === 'system') return 'system'
  if (QA_ACTOR.test(actorUsername)) return 'qa'
  return 'human'
}

/** Map an audit action + actor to a category + severity. Category is derived from the action verb; QA
 *  and System classification override so automated noise is filtered from the default human view. */
export function classify(action: string, actorUsername: string): { category: ActivityCategory; severity: Severity } {
  const a = action.toLowerCase()
  const cls = actorClass(actorUsername)
  const category: ActivityCategory =
    cls === 'system' ? 'System'
    : cls === 'qa' ? 'QA'
    : /password/.test(a) ? 'Password resets'
    : /disqualif/.test(a) ? 'Disqualifications'
    : /wildcard/.test(a) ? 'Wildcards'
    : /forfeit|\bff\b/.test(a) ? 'FF'
    : /kick|\bko\b/.test(a) ? 'KO'
    : /no.?contest|void/.test(a) ? 'No Contest'
    : /role|promote|demote|headadmin|head_admin|owner/.test(a) ? 'Roles'
    : /login|logout|auth|session|signin|sign_in/.test(a) ? 'Authentication'
    : /delete|purge/.test(a) ? 'Deletion'
    : /security|lock|unlock/.test(a) ? 'Security'
    : /award|trophy|champion|diamond/.test(a) ? 'Awards'
    : /rank|ladder|rating/.test(a) ? 'Rankings'
    : /setting/.test(a) ? 'Settings'
    : /registration|entrant|register/.test(a) ? 'Registration'
    : /team|free.?agent|roster/.test(a) ? 'Teams'
    : /result|score|correct|report|save/.test(a) ? 'Results'
    : /account|user|suspend|ban|warn|timeout|moderat/.test(a) ? 'Accounts'
    : /season/.test(a) ? 'Seasons'
    : /tournament|cup|playoff|swiss|group|bracket/.test(a) ? 'Tournaments'
    : 'Accounts'

  const severity: Severity =
    /delete|purge|ban|disqualif|kick|\bko\b/.test(a) ? 'critical'
    : /password|role|promote|demote|headadmin|close|complete|reversal|revert|correct/.test(a) ? 'warning'
    : /reset|suspend|timeout|setting|unlock/.test(a) ? 'notice'
    : 'info'

  return { category, severity }
}

export interface ActivityFilters {
  search?: string
  from?: string // ISO date
  to?: string
  actor?: string
  target?: string
  category?: ActivityCategory | ''
  action?: string
  severity?: Severity | ''
  includeAutomated?: boolean // include System + QA (default false = human actions only)
}

export interface ActivityRow {
  id: number
  createdAt: string
  actorUsername: string
  action: string
  entity: string
  entityId: string | null
  category: ActivityCategory
  severity: Severity
  reason: string | null
  oldValue: unknown
  newValue: unknown
}

export interface ActivityPage { rows: ActivityRow[]; total: number; page: number; pageSize: number }

/** Paginated, filtered activity. Category/severity are computed in-app, so category filtering is
 *  applied after fetching a bounded window; text/date/actor/target filters push down to SQL. */
export async function getActivityLog(filters: ActivityFilters, page = 1, pageSize = 25): Promise<ActivityPage> {
  const where: Prisma.AuditLogWhereInput = {}
  if (filters.from) where.createdAt = { ...(where.createdAt as object), gte: new Date(filters.from) }
  if (filters.to) where.createdAt = { ...(where.createdAt as object), lte: new Date(filters.to + 'T23:59:59.999Z') }
  if (filters.actor) where.actorUsername = { contains: filters.actor, mode: 'insensitive' }
  if (filters.target) where.entityId = { contains: filters.target }
  if (filters.action) where.action = { contains: filters.action, mode: 'insensitive' }
  if (filters.search) {
    where.OR = [
      { action: { contains: filters.search, mode: 'insensitive' } },
      { actorUsername: { contains: filters.search, mode: 'insensitive' } },
      { reason: { contains: filters.search, mode: 'insensitive' } },
      { entity: { contains: filters.search, mode: 'insensitive' } },
    ]
  }

  // Fetch a bounded window ordered newest-first, then apply the computed category/severity/automated
  // filters in-app and paginate. (Audit volume is modest; a materialized category column can come later.)
  const raw = await prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 5000 })
  const enriched: ActivityRow[] = raw.map((r) => {
    const c = classify(r.action, r.actorUsername)
    return { id: r.id, createdAt: r.createdAt.toISOString(), actorUsername: r.actorUsername, action: r.action, entity: r.entity, entityId: r.entityId, category: c.category, severity: c.severity, reason: r.reason, oldValue: r.oldValue, newValue: r.newValue }
  })
  const filtered = enriched.filter((r) => {
    if (!filters.includeAutomated && (r.category === 'System' || r.category === 'QA')) return false
    if (filters.category && r.category !== filters.category) return false
    if (filters.severity && r.severity !== filters.severity) return false
    return true
  })
  const total = filtered.length
  const start = (page - 1) * pageSize
  return { rows: filtered.slice(start, start + pageSize), total, page, pageSize }
}

/** Recent HUMAN admin actions for the dashboard (System/QA excluded). */
export async function getRecentHumanActions(limit = 10): Promise<ActivityRow[]> {
  const { rows } = await getActivityLog({ includeAutomated: false }, 1, limit)
  return rows
}
