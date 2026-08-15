import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { classify, type ActivityFilters, type ActivityRow, type ActivityPage } from './activity-shared'

export * from './activity-shared'

/** Paginated, filtered activity over the immutable audit log. Text/date/actor/target filters push to
 *  SQL; computed category/severity/automated filters apply over a bounded newest-first window. */
export async function getActivityLog(filters: ActivityFilters, page = 1, pageSize = 25): Promise<ActivityPage> {
  const where: Prisma.AuditLogWhereInput = {}
  const dateRange: { gte?: Date; lte?: Date } = {}
  if (filters.from) dateRange.gte = new Date(filters.from)
  if (filters.to) dateRange.lte = new Date(filters.to + 'T23:59:59.999Z')
  if (dateRange.gte || dateRange.lte) where.createdAt = dateRange
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
