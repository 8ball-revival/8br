import 'server-only'
import { prisma } from '@/lib/prisma'

/**
 * SHARED Integrity Log — a single, chronological assembly of a member's competition- and
 * moderation-affecting events. Nothing new is stored; it is assembled on read from the
 * existing sources of truth: Warnings, Penalties, the audit log (moderation / role / profile
 * / CueVerse-ID changes), and the member's registration changes (entries + withdrawals).
 *
 * Staff see the complete log. `internalNotes` on warnings are NEVER included here (staff read
 * those on the warning itself); public exposure is governed by the existing privacy model —
 * a public caller should filter to competition outcomes only.
 */

export type IntegrityKind =
  | 'warning'
  | 'timeout'
  | 'ban'
  | 'penalty_removed'
  | 'account_deleted'
  | 'account_restored'
  | 'role_change'
  | 'profile_change'
  | 'cueverse_change'
  | 'registration'
  | 'withdrawal'
  | 'other'

export interface IntegrityEvent {
  at: string // ISO
  kind: IntegrityKind
  summary: string
  actor?: string | null // staff/actor username, when known
  reason?: string | null
  competition?: boolean // true = a competition-history event (public-safe)
}

function kindForAudit(action: string): IntegrityKind {
  if (action === 'member.warn') return 'warning'
  if (action === 'member.timeout') return 'timeout'
  if (action === 'member.ban') return 'ban'
  if (action === 'member.penalty.remove') return 'penalty_removed'
  if (action === 'member.delete') return 'account_deleted'
  if (action === 'member.restore') return 'account_restored'
  if (action === 'staff.promote' || action === 'staff.demote' || action === 'staff.headAdmin.transfer' || action === 'owner.transfer') return 'role_change'
  if (action.startsWith('profile.cueverse') || action === 'profile.cueverseId') return 'cueverse_change'
  if (action.startsWith('profile')) return 'profile_change'
  if (action.startsWith('registration')) return 'withdrawal'
  return 'other'
}

/** Assemble the full staff-facing Integrity Log for an account (+ its linked profile). */
export async function getIntegrityLog(userId: number, playerId?: string | null): Promise<IntegrityEvent[]> {
  const events: IntegrityEvent[] = []

  // 1) Warnings (summary only — internal notes stay on the warning record).
  const warnings = await prisma.warning.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } })
  for (const w of warnings) events.push({ at: w.createdAt.toISOString(), kind: 'warning', summary: `Warning issued`, actor: w.staffUsername, reason: w.reason })

  // 2) Penalties (applied + removed).
  const penalties = await prisma.penalty.findMany({ where: { userId }, orderBy: { startAt: 'desc' } })
  for (const p of penalties) {
    events.push({
      at: p.startAt.toISOString(),
      kind: p.type === 'BAN' ? 'ban' : 'timeout',
      summary: p.type === 'BAN' ? 'Banned' : `Timed out${p.endAt ? ` until ${p.endAt.toLocaleString()}` : ''}`,
      actor: p.appliedByUsername,
      reason: p.reason,
    })
    if (p.removedAt) events.push({ at: p.removedAt.toISOString(), kind: 'penalty_removed', summary: `${p.type === 'BAN' ? 'Ban' : 'Timeout'} removed`, actor: p.removedByUsername, reason: p.removedReason })
  }

  // 3) Audit entries about this account / its profile (moderation, role, profile, CueVerse).
  const or: { entity: string; entityId: string }[] = [{ entity: 'User', entityId: String(userId) }]
  if (playerId) or.push({ entity: 'Player', entityId: playerId })
  const audits = await prisma.auditLog.findMany({ where: { OR: or }, orderBy: { createdAt: 'desc' }, take: 200 })
  for (const a of audits) {
    const kind = kindForAudit(a.action)
    // Warnings/penalties/deletes/restores are already captured above with richer detail.
    if (['warning', 'timeout', 'ban', 'penalty_removed', 'account_deleted', 'account_restored'].includes(kind)) continue
    events.push({ at: a.createdAt.toISOString(), kind, summary: a.action, actor: a.actorUsername, reason: a.reason })
  }

  // 4) The member's registration changes (entries + self/forced withdrawals) — competition history.
  const regs = await prisma.registration.findMany({
    where: { OR: [{ userId }, ...(playerId ? [{ playerId }] : [])] },
    include: { season: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  })
  for (const r of regs) {
    events.push({ at: r.createdAt.toISOString(), kind: 'registration', summary: `Entered ${r.season.name}`, competition: true })
    if (r.withdrawnAt) events.push({ at: r.withdrawnAt.toISOString(), kind: 'withdrawal', summary: `Withdrawn from ${r.season.name}`, competition: true })
  }

  return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
}
