import 'server-only'
import type { MemberStatus, PenaltyType } from '@prisma/client'
import { getPayload } from 'payload'
import config from '@payload-config'

import { prisma } from '@/lib/prisma'
import { isOwner, isAdmin } from '@/lib/auth/roles'
import { getIntegrityLog, type IntegrityEvent } from '@/lib/moderation/integrity-log'

/**
 * Member Management read model — the single query layer for the staff Members area. Joins
 * Payload accounts (users + roles) with the Prisma competition/moderation data (Player,
 * MemberModeration, Penalty, Warning, StaffDesignation, Registration). Email is a PRIVATE
 * field and is included ONLY in the detail view and ONLY when the caller passes
 * `includeEmail` (which staff pages set from an authorized capability).
 */

export type MemberRole = 'owner' | 'admin' | 'member'

export interface MemberRow {
  userId: number
  username: string
  preferredName: string | null
  cueverseId: string | null
  slug: string | null
  playerId: string | null
  role: MemberRole
  headAdmin: boolean
  status: MemberStatus
  timeoutUntil: string | null
  activePenalty: { type: PenaltyType; endAt: string | null } | null
  registrationCount: number
  /// Trusted Author: may publish LEGACY /news articles without review. Read from the canonical
  /// Player, so it is the same value the editorial permission check uses rather than a second copy.
  /// It has never gated posting in The Break - see `breakPostingBlocked` for that.
  trustedAuthor: boolean
  /// The Break: posting removed for abuse. A revocation, so `false` is the ordinary state and every
  /// member has it. Set only by an administrator; read fresh on every posting attempt.
  breakPostingBlocked: boolean
  /// Every handle this member also answers to. Shown in full on the roster so a search that failed
  /// on the current ID can be understood at a glance — the old handle is usually the reason.
  aliases: string[]
  /** Every spelling AND every key, for matching a search box. Never displayed. */
  aliasSearch: string[]
}

export interface MemberDetail extends MemberRow {
  email: string | null // ONLY populated when the caller is authorized
  /// When posting was removed, and the reason the member is shown. Null whenever it is not removed.
  breakPostingBlockedAt: string | null
  breakPostingBlockedReason: string | null
  discord: string | null
  timeZone: string | null
  createdAt: string | null
  warnings: { id: number; reason: string; internalNotes: string | null; staffUsername: string; createdAt: string }[]
  penalties: {
    id: number
    type: PenaltyType
    reason: string
    startAt: string
    endAt: string | null
    appliedByUsername: string
    removedByUsername: string | null
    removedReason: string | null
    removedAt: string | null
    active: boolean
  }[]
  competitions: { registrationId: number; tournament: string; status: string; withdrawnAt: string | null }[]
  integrity: IntegrityEvent[]
}

async function payload() {
  return getPayload({ config: await config })
}

function roleOf(roles: string[]): MemberRole {
  if (isOwner(roles)) return 'owner'
  if (isAdmin(roles)) return 'admin'
  return 'member'
}

/** Effective status without a DB write (list view): a lapsed timeout reads as ACTIVE. */
function effectiveStatus(row: { status: MemberStatus; timeoutUntil: Date | null } | undefined): { status: MemberStatus; timeoutUntil: string | null } {
  if (!row) return { status: 'ACTIVE', timeoutUntil: null }
  if (row.status === 'TIMED_OUT' && row.timeoutUntil && row.timeoutUntil.getTime() <= Date.now()) return { status: 'ACTIVE', timeoutUntil: null }
  return { status: row.status, timeoutUntil: row.timeoutUntil ? row.timeoutUntil.toISOString() : null }
}

export async function listMembers(opts: { q?: string; status?: MemberStatus | 'ALL'; trustedOnly?: boolean } = {}): Promise<MemberRow[]> {
  const p = await payload()
  const res = await p.find({ collection: 'users', limit: 1000, overrideAccess: true, depth: 0 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const users = res.docs as any[]
  const userIds = users.map((u) => Number(u.id))

  // Management-only accounts (the head-admin login) run the site rather than compete, so they are
  // not part of the member roster. They stay reachable at /staff/members/<id> and from My Account.
  const managementProfiles = await prisma.player.findMany({
    where: { managementOnly: true, linkedUserId: { not: null } },
    select: { linkedUserId: true },
  })
  const managementUserIds = new Set(managementProfiles.map((m) => Number(m.linkedUserId)))

  const [profiles, mods, heads, activePenalties] = await Promise.all([
    prisma.player.findMany({
      where: { linkedUserId: { in: userIds.map(String) } },
      select: {
        id: true, linkedUserId: true, primaryName: true, cueverseId: true, blogTrustedAuthor: true,
        breakPostingBlocked: true,
        // Included with the profile rather than fetched per row: a hundred members would otherwise
        // be a hundred extra queries to draw one table.
        // The spelling for display; search below still matches on whatever is shown plus the key.
        aliases: { select: { alias: true, aliasDisplay: true }, orderBy: { alias: 'asc' } },
      },
    }),
    prisma.memberModeration.findMany({ where: { userId: { in: userIds } } }),
    prisma.staffDesignation.findMany({ where: { userId: { in: userIds }, headAdmin: true }, select: { userId: true } }),
    prisma.penalty.findMany({ where: { userId: { in: userIds }, removedAt: null }, select: { userId: true, type: true, endAt: true } }),
  ])
  const profByUser = new Map(profiles.map((pr) => [pr.linkedUserId!, pr]))
  const modByUser = new Map(mods.map((m) => [m.userId, m]))
  const headSet = new Set(heads.map((h) => h.userId))
  const penByUser = new Map<number, { type: PenaltyType; endAt: string | null }>()
  const now = Date.now()
  for (const pen of activePenalties) {
    if (pen.type === 'TIMEOUT' && pen.endAt && pen.endAt.getTime() <= now) continue // expired
    if (!penByUser.has(pen.userId)) penByUser.set(pen.userId, { type: pen.type, endAt: pen.endAt ? pen.endAt.toISOString() : null })
  }

  // Registration counts (self + linked-profile), one grouped query each.
  const regByUser = await prisma.registration.groupBy({ by: ['userId'], where: { userId: { in: userIds } }, _count: { _all: true } })
  const countByUser = new Map<number, number>()
  for (const r of regByUser) if (r.userId != null) countByUser.set(r.userId, r._count._all)

  const rows: MemberRow[] = users
    .filter((u) => !managementUserIds.has(Number(u.id)))
    .map((u) => {
    const uid = Number(u.id)
    const prof = profByUser.get(String(uid)) ?? null
    const eff = effectiveStatus(modByUser.get(uid))
    return {
      userId: uid,
      username: String(u.username ?? ''),
      preferredName: prof?.primaryName ?? null,
      cueverseId: prof?.cueverseId ?? null,
      slug: prof?.cueverseId ?? null,
      playerId: prof?.id ?? null,
      role: roleOf(Array.isArray(u.roles) ? u.roles : []),
      headAdmin: headSet.has(uid),
      status: eff.status,
      timeoutUntil: eff.timeoutUntil,
      activePenalty: penByUser.get(uid) ?? null,
      registrationCount: countByUser.get(uid) ?? 0,
      trustedAuthor: prof?.blogTrustedAuthor ?? false,
      breakPostingBlocked: prof?.breakPostingBlocked ?? false,
      aliases: (prof?.aliases ?? []).map((a) => a.aliasDisplay?.trim() || a.alias),
      /*
       * Both forms, for search only.
       *
       * `aliases` above is what a reader sees, and it is now the SPELLING. Searching that alone
       * would have quietly broken the case this feature exists for: somebody typing `fsmbrian`
       * would stop finding the member recorded as `fsm_brian`. The key is what survives however
       * either side punctuates it, so both go in the haystack and neither is displayed from here.
       */
      aliasSearch: (prof?.aliases ?? []).flatMap((a) => [a.alias, a.aliasDisplay ?? '']).filter(Boolean),
    }
  })

  const q = (opts.q ?? '').trim().toLowerCase()
  // Search by the canonical identity only — Preferred Name, CueVerse ID, or immutable User ID.
  // There is no separate "username" concept to search.
  return rows
    /*
     * Deleted accounts are hidden unless they are asked for by name.
     *
     * A deleted member has had their identity cleared, so the row shows an empty handle and no name
     * — it is a tombstone, and one sitting at the top of an alphabetical list is the first thing
     * anyone sees on this page. They remain reachable by choosing the Deleted status, which is the
     * only time anyone actually wants them.
     */
    .filter((r) => (opts.status === 'DELETED' ? r.status === 'DELETED' : r.status !== 'DELETED'))
    .filter((r) => (opts.status && opts.status !== 'ALL' ? r.status === opts.status : true))
    .filter((r) => (opts.trustedOnly ? r.trustedAuthor : true))
    // Aliases are searchable too: somebody looking for a member by the handle they remember should
    // find them, and the handle they remember is usually the one that was replaced.
    .filter((r) => (q
      ? `${r.preferredName ?? ''} ${r.cueverseId ?? ''} ${r.aliasSearch.join(' ')} #${r.userId}`.toLowerCase().includes(q)
      : true))
    .sort((a, b) => (a.cueverseId ?? '').localeCompare(b.cueverseId ?? '') || a.userId - b.userId)
}

export async function getMemberDetail(userId: number, opts: { includeEmail?: boolean } = {}): Promise<MemberDetail | null> {
  const p = await payload()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const u = (await p.findByID({ collection: 'users', id: userId, overrideAccess: true }).catch(() => null)) as any
  if (!u) return null

  const [profile, mod, head, warnings, penalties, regs] = await Promise.all([
    prisma.player.findUnique({
      where: { linkedUserId: String(userId) },
      select: {
        id: true, primaryName: true, cueverseId: true, discord: true, timeZone: true,
        blogTrustedAuthor: true,
        breakPostingBlocked: true, breakPostingBlockedAt: true, breakPostingBlockedReason: true,
        // The spelling for display; search below still matches on whatever is shown plus the key.
        aliases: { select: { alias: true, aliasDisplay: true }, orderBy: { alias: 'asc' } },
      },
    }),
    prisma.memberModeration.findUnique({ where: { userId } }),
    prisma.staffDesignation.findUnique({ where: { userId }, select: { headAdmin: true } }),
    prisma.warning.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    prisma.penalty.findMany({ where: { userId }, orderBy: { startAt: 'desc' } }),
    prisma.registration.findMany({ where: { OR: [{ userId }, ...(await linkedPlayerFilter(userId))] }, include: { tournament: { select: { name: true } } }, orderBy: { createdAt: 'desc' } }),
  ])
  const eff = effectiveStatus(mod ?? undefined)
  const now = Date.now()
  const integrity = await getIntegrityLog(userId, profile?.id ?? null)

  return {
    userId,
    username: String(u.username ?? ''),
    email: opts.includeEmail ? String(u.email ?? '') : null,
    preferredName: profile?.primaryName ?? null,
    cueverseId: profile?.cueverseId ?? null,
    slug: profile?.cueverseId ?? null,
    playerId: profile?.id ?? null,
    discord: profile?.discord ?? null,
    timeZone: profile?.timeZone ?? null,
    role: roleOf(Array.isArray(u.roles) ? u.roles : []),
    headAdmin: !!head?.headAdmin,
    status: eff.status,
    timeoutUntil: eff.timeoutUntil,
    createdAt: u.createdAt ? String(u.createdAt) : null,
    activePenalty: (() => {
      const active = penalties.find((pen) => !pen.removedAt && (pen.type === 'BAN' || !pen.endAt || pen.endAt.getTime() > now))
      return active ? { type: active.type, endAt: active.endAt ? active.endAt.toISOString() : null } : null
    })(),
    registrationCount: regs.length,
    trustedAuthor: profile?.blogTrustedAuthor ?? false,
    /*
     * Posting in The Break is open to every member, so this reports a REMOVAL. `false` is the
     * ordinary state and is also what a member with no linked profile gets, which is correct: an
     * account that cannot be resolved to a Player cannot have had anything taken away from it.
     */
    breakPostingBlocked: profile?.breakPostingBlocked ?? false,
    breakPostingBlockedAt: profile?.breakPostingBlockedAt?.toISOString() ?? null,
    breakPostingBlockedReason: profile?.breakPostingBlockedReason ?? null,
    aliases: (profile?.aliases ?? []).map((a) => a.aliasDisplay?.trim() || a.alias),
    aliasSearch: (profile?.aliases ?? []).flatMap((a) => [a.alias, a.aliasDisplay ?? '']).filter(Boolean),
    warnings: warnings.map((w) => ({ id: w.id, reason: w.reason, internalNotes: w.internalNotes, staffUsername: w.staffUsername, createdAt: w.createdAt.toISOString() })),
    penalties: penalties.map((pen) => ({
      id: pen.id,
      type: pen.type,
      reason: pen.reason,
      startAt: pen.startAt.toISOString(),
      endAt: pen.endAt ? pen.endAt.toISOString() : null,
      appliedByUsername: pen.appliedByUsername,
      removedByUsername: pen.removedByUsername,
      removedReason: pen.removedReason,
      removedAt: pen.removedAt ? pen.removedAt.toISOString() : null,
      active: !pen.removedAt && (pen.type === 'BAN' || !pen.endAt || pen.endAt.getTime() > now),
    })),
    competitions: regs.map((r) => ({ registrationId: r.id, tournament: r.tournament.name, status: r.status, withdrawnAt: r.withdrawnAt ? r.withdrawnAt.toISOString() : null })),
    integrity,
  }
}

async function linkedPlayerFilter(userId: number): Promise<{ playerId: string }[]> {
  const prof = await prisma.player.findUnique({ where: { linkedUserId: String(userId) }, select: { id: true } })
  return prof ? [{ playerId: prof.id }] : []
}

export type PenaltyView = {
  id: number
  userId: number
  username: string
  preferredName: string | null
  cueverseId: string | null
  type: PenaltyType
  state: 'active' | 'expired' | 'removed'
  reason: string
  appliedByUsername: string
  startAt: string
  endAt: string | null
  removedByUsername: string | null
  removedReason: string | null
  removedAt: string | null
  affectedCompetitions: string[]
}

export type PenaltyFilter = 'ALL' | 'ACTIVE' | 'EXPIRED' | 'REMOVED' | 'TIMEOUT' | 'BAN'

/** Penalties history for the staff Penalties page (audit/history view). */
export async function listPenalties(filter: PenaltyFilter = 'ALL'): Promise<PenaltyView[]> {
  const penalties = await prisma.penalty.findMany({ orderBy: { startAt: 'desc' }, take: 500 })
  if (penalties.length === 0) return []
  const userIds = [...new Set(penalties.map((p) => p.userId))]

  const p = await payload()
  const usersRes = await p.find({ collection: 'users', where: { id: { in: userIds } }, overrideAccess: true, limit: 1000, depth: 0 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usernameByUser = new Map<number, string>((usersRes.docs as any[]).map((u) => [Number(u.id), String(u.username ?? '')]))
  const profiles = await prisma.player.findMany({ where: { linkedUserId: { in: userIds.map(String) } }, select: { linkedUserId: true, primaryName: true, cueverseId: true } })
  const profByUser = new Map(profiles.map((pr) => [pr.linkedUserId!, pr]))
  // Best-effort "affected competitions": the member's withdrawn registrations.
  const withdrawn = await prisma.registration.findMany({ where: { userId: { in: userIds }, status: 'WITHDRAWN' }, include: { tournament: { select: { name: true } } } })
  const affByUser = new Map<number, string[]>()
  for (const w of withdrawn) if (w.userId != null) affByUser.set(w.userId, [...(affByUser.get(w.userId) ?? []), w.tournament.name])

  const now = Date.now()
  const rows: PenaltyView[] = penalties.map((pen) => {
    const state: PenaltyView['state'] = pen.removedAt ? 'removed' : pen.type === 'TIMEOUT' && pen.endAt && pen.endAt.getTime() <= now ? 'expired' : 'active'
    const prof = profByUser.get(String(pen.userId)) ?? null
    return {
      id: pen.id,
      userId: pen.userId,
      username: usernameByUser.get(pen.userId) ?? String(pen.userId),
      preferredName: prof?.primaryName ?? null,
      cueverseId: prof?.cueverseId ?? null,
      type: pen.type,
      state,
      reason: pen.reason,
      appliedByUsername: pen.appliedByUsername,
      startAt: pen.startAt.toISOString(),
      endAt: pen.endAt ? pen.endAt.toISOString() : null,
      removedByUsername: pen.removedByUsername,
      removedReason: pen.removedReason,
      removedAt: pen.removedAt ? pen.removedAt.toISOString() : null,
      affectedCompetitions: affByUser.get(pen.userId) ?? [],
    }
  })

  return rows.filter((r) => {
    switch (filter) {
      case 'ACTIVE': return r.state === 'active'
      case 'EXPIRED': return r.state === 'expired'
      case 'REMOVED': return r.state === 'removed'
      case 'TIMEOUT': return r.type === 'TIMEOUT'
      case 'BAN': return r.type === 'BAN'
      default: return true
    }
  })
}

/** Active registrations that a moderation action would withdraw (for the confirm preview). */
export async function getActiveRegistrations(userId: number): Promise<{ tournament: string; status: string }[]> {
  const linked = await linkedPlayerFilter(userId)
  const regs = await prisma.registration.findMany({
    where: { OR: [{ userId }, ...linked], status: { in: ['PENDING', 'APPROVED'] }, tournament: { status: { not: 'COMPLETED' } } },
    include: { tournament: { select: { name: true } } },
  })
  return regs.map((r) => ({ tournament: r.tournament.name, status: r.status }))
}
