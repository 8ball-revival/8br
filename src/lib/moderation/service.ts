import 'server-only'
import type { MemberStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from '@/lib/competition/audit'
import { cleanupActiveRegistrations } from '@/lib/competition/cleanup'

/**
 * SHARED moderation service — the single source of truth for account status and every
 * moderation action (Warning, Timeout, Ban, soft Delete, Restore, penalty removal).
 *
 * Design:
 *  - Status lives in the `MemberModeration` sidecar (one row per Payload user, created
 *    lazily). ACTIVE is the implicit default when no row exists.
 *  - Timeouts EXPIRE automatically: a TIMED_OUT row whose `timeoutUntil` has passed
 *    resolves to ACTIVE (evaluated live, and lazily healed on read).
 *  - Penalties (Timeout/Ban) are immutable history: removal is recorded in place.
 *  - Every action writes the audit log; enforcement actions also run the shared
 *    registration-cleanup so a moderated member never keeps ACTIVE participation.
 *  - Moderation NEVER deletes Player/rankings/matches/championships/aliases/audit.
 */

export interface MemberStatusView {
  status: MemberStatus // effective status (timeout expiry already applied)
  timeoutUntil: string | null
  bannedAt: string | null
  deletedAt: string | null
  // Convenience flags for eligibility / login checks.
  canLogin: boolean // false when BANNED or DELETED
  canRegister: boolean // false when TIMED_OUT, BANNED or DELETED
}

const ACTIVE_VIEW: MemberStatusView = {
  status: 'ACTIVE',
  timeoutUntil: null,
  bannedAt: null,
  deletedAt: null,
  canLogin: true,
  canRegister: true,
}

/** Effective status for an account (ACTIVE when no row / timeout expired). */
export async function resolveMemberStatus(userId: number): Promise<MemberStatusView> {
  const row = await prisma.memberModeration.findUnique({ where: { userId } })
  if (!row) return ACTIVE_VIEW

  // Auto-expire a lapsed timeout (heal the row so status stays truthful).
  if (row.status === 'TIMED_OUT' && row.timeoutUntil && row.timeoutUntil.getTime() <= Date.now()) {
    await prisma.memberModeration.update({ where: { userId }, data: { status: 'ACTIVE', timeoutUntil: null } })
    return ACTIVE_VIEW
  }

  return {
    status: row.status,
    timeoutUntil: row.timeoutUntil ? row.timeoutUntil.toISOString() : null,
    bannedAt: row.bannedAt ? row.bannedAt.toISOString() : null,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    canLogin: row.status !== 'BANNED' && row.status !== 'DELETED',
    canRegister: row.status === 'ACTIVE',
  }
}

/** The user's linked canonical Player id, if any (penalties/warnings carry it for the Integrity Log). */
async function linkedPlayerId(userId: number): Promise<string | null> {
  const p = await prisma.player.findUnique({ where: { linkedUserId: String(userId) }, select: { id: true } })
  return p?.id ?? null
}

// --------------------------------------------------------------------------- Warnings

/** Record a moderation Warning — history only, no enforcement effect. */
export async function warnMember(
  actor: Actor,
  userId: number,
  input: { reason: string; internalNotes?: string | null },
): Promise<{ ok: boolean; error?: string; id?: number }> {
  const reason = input.reason.trim()
  if (!reason) return { ok: false, error: 'A reason is required.' }
  const playerId = await linkedPlayerId(userId)
  const w = await prisma.warning.create({
    data: { userId, playerId, reason, internalNotes: input.internalNotes?.trim() || null, staffUserId: actor.userId, staffUsername: actor.username },
  })
  await recordAudit(actor, { action: 'member.warn', entity: 'User', entityId: userId, newValue: { reason }, reason })
  return { ok: true, id: w.id }
}

// --------------------------------------------------------------------------- Timeout

/** Apply a Timeout: withdraws active participation + blocks registration until it expires. */
export async function applyTimeout(
  actor: Actor,
  userId: number,
  input: { until: Date; reason: string },
): Promise<{ ok: boolean; error?: string }> {
  const reason = input.reason.trim()
  if (!reason) return { ok: false, error: 'A reason is required.' }
  if (!(input.until instanceof Date) || input.until.getTime() <= Date.now())
    return { ok: false, error: 'Timeout must end in the future.' }

  const playerId = await linkedPlayerId(userId)
  await prisma.$transaction(async (tx) => {
    await tx.memberModeration.upsert({
      where: { userId },
      create: { userId, status: 'TIMED_OUT', timeoutUntil: input.until },
      update: { status: 'TIMED_OUT', timeoutUntil: input.until, bannedAt: null, deletedAt: null },
    })
    await tx.penalty.create({
      data: { userId, playerId, type: 'TIMEOUT', reason, startAt: new Date(), endAt: input.until, appliedByUserId: actor.userId, appliedByUsername: actor.username },
    })
    await recordAudit(actor, { action: 'member.timeout', entity: 'User', entityId: userId, newValue: { until: input.until.toISOString() }, reason }, tx)
  })
  await cleanupActiveRegistrations(actor, userId, `Timeout: ${reason}`)
  return { ok: true }
}

// --------------------------------------------------------------------------- Ban

/** Ban an account: blocks login + registration and withdraws active participation. */
export async function applyBan(
  actor: Actor,
  userId: number,
  input: { reason: string; ipHash?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const reason = input.reason.trim()
  if (!reason) return { ok: false, error: 'A reason is required.' }
  const playerId = await linkedPlayerId(userId)
  await prisma.$transaction(async (tx) => {
    await tx.memberModeration.upsert({
      where: { userId },
      create: { userId, status: 'BANNED', bannedAt: new Date() },
      update: { status: 'BANNED', bannedAt: new Date(), timeoutUntil: null },
    })
    await tx.penalty.create({
      data: { userId, playerId, type: 'BAN', reason, startAt: new Date(), endAt: null, appliedByUserId: actor.userId, appliedByUsername: actor.username, ipHash: input.ipHash ?? null },
    })
    await recordAudit(actor, { action: 'member.ban', entity: 'User', entityId: userId, newValue: { ipHash: input.ipHash ? 'stored' : null }, reason }, tx)
  })
  await cleanupActiveRegistrations(actor, userId, `Ban: ${reason}`)
  return { ok: true }
}

// --------------------------------------------------------------------------- Remove a penalty

/** Remove (lift) an active penalty early. Records who/why in place; recomputes status. */
export async function removePenalty(
  actor: Actor,
  penaltyId: number,
  input: { reason: string },
): Promise<{ ok: boolean; error?: string }> {
  const reason = input.reason.trim()
  if (!reason) return { ok: false, error: 'A removal reason is required.' }
  const penalty = await prisma.penalty.findUnique({ where: { id: penaltyId } })
  if (!penalty) return { ok: false, error: 'Penalty not found.' }
  if (penalty.removedAt) return { ok: false, error: 'That penalty was already removed.' }

  await prisma.$transaction(async (tx) => {
    await tx.penalty.update({
      where: { id: penaltyId },
      data: { removedByUserId: actor.userId, removedByUsername: actor.username, removedReason: reason, removedAt: new Date() },
    })
    // Recompute the account's status from remaining ACTIVE penalties.
    const now = new Date()
    const activeBan = await tx.penalty.findFirst({ where: { userId: penalty.userId, type: 'BAN', removedAt: null } })
    const activeTimeout = await tx.penalty.findFirst({ where: { userId: penalty.userId, type: 'TIMEOUT', removedAt: null, endAt: { gt: now } } })
    const mod = await tx.memberModeration.findUnique({ where: { userId: penalty.userId } })
    // Never resurrect a soft-deleted account by lifting a penalty.
    if (mod && mod.status !== 'DELETED') {
      const next: MemberStatus = activeBan ? 'BANNED' : activeTimeout ? 'TIMED_OUT' : 'ACTIVE'
      await tx.memberModeration.update({
        where: { userId: penalty.userId },
        data: { status: next, timeoutUntil: next === 'TIMED_OUT' ? activeTimeout!.endAt : null, bannedAt: next === 'BANNED' ? (mod.bannedAt ?? now) : null },
      })
    }
    await recordAudit(actor, { action: 'member.penalty.remove', entity: 'Penalty', entityId: penaltyId, oldValue: { type: penalty.type }, reason }, tx)
  })
  return { ok: true }
}

// --------------------------------------------------------------------------- Delete (soft) / Restore

/**
 * Soft-delete an account: status DELETED, active participation withdrawn, and the linked
 * Player UNLINKED (history preserved). The Payload user is disabled by the caller; the
 * canonical Player, rankings, matches, championships, aliases and audit all remain.
 */
export async function softDeleteAccount(
  actor: Actor,
  userId: number,
  input: { reason: string },
): Promise<{ ok: boolean; error?: string; unlinkedPlayerId?: string | null }> {
  const reason = input.reason.trim() || 'Account deleted'
  const playerId = await linkedPlayerId(userId)
  await prisma.$transaction(async (tx) => {
    await tx.memberModeration.upsert({
      where: { userId },
      create: { userId, status: 'DELETED', deletedAt: new Date() },
      update: { status: 'DELETED', deletedAt: new Date(), timeoutUntil: null },
    })
    // Unlink the profile from the account — the Player and its history are preserved.
    if (playerId) {
      await tx.player.update({ where: { id: playerId }, data: { linkedUserId: null, linkStatus: 'UNLINKED', linkedAt: null } })
    }
    await recordAudit(actor, { action: 'member.delete', entity: 'User', entityId: userId, oldValue: { linkedPlayerId: playerId }, reason }, tx)
  })
  await cleanupActiveRegistrations(actor, userId, `Account deleted: ${reason}`)
  return { ok: true, unlinkedPlayerId: playerId }
}

/** Restore a timed-out / banned / deleted account to ACTIVE. Does NOT re-link a profile. */
export async function restoreMember(
  actor: Actor,
  userId: number,
  input: { reason?: string } = {},
): Promise<{ ok: boolean; error?: string }> {
  const row = await prisma.memberModeration.findUnique({ where: { userId } })
  if (!row || row.status === 'ACTIVE') return { ok: true }
  await prisma.$transaction(async (tx) => {
    await tx.memberModeration.update({ where: { userId }, data: { status: 'ACTIVE', timeoutUntil: null, bannedAt: null, deletedAt: null } })
    // Lift any still-active penalties as part of the restore.
    await tx.penalty.updateMany({
      where: { userId, removedAt: null },
      data: { removedByUserId: actor.userId, removedByUsername: actor.username, removedReason: input.reason?.trim() || 'Restored', removedAt: new Date() },
    })
    await recordAudit(actor, { action: 'member.restore', entity: 'User', entityId: userId, oldValue: { status: row.status }, reason: input.reason ?? 'Restored' }, tx)
  })
  return { ok: true }
}
