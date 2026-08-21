'use server'

import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'
import config from '@payload-config'

import { requireCapability } from '@/lib/competition/staff-auth'
import { recordAudit } from '@/lib/competition/audit'
import { warnMember, applyTimeout, applyBan, removePenalty, softDeleteAccount, restoreMember } from './service'

export interface ModResult {
  ok?: boolean
  error?: string
  ipShared?: boolean
}

function revalidateModeration(userId: number) {
  for (const p of ['/staff/members', `/staff/members/${userId}`, '/staff/registrations', '/', '/groups', '/playoffs', '/tournaments']) revalidatePath(p)
}

/**
 * Derive a hashed, normalized IP identifier from the request headers for ban IP-protection.
 * SECONDARY safeguard only — returns null when no trustworthy client IP is available (e.g.
 * local/dev), and flags obviously shared/proxy chains so staff are warned. Never the sole gate.
 */
async function hashedClientIp(): Promise<{ ipHash: string | null; shared: boolean }> {
  const h = await headers()
  const fwd = h.get('x-forwarded-for') ?? ''
  const parts = fwd.split(',').map((s) => s.trim()).filter(Boolean)
  const real = parts[0] || h.get('x-real-ip') || ''
  if (!real || real === '::1' || real === '127.0.0.1') return { ipHash: null, shared: false }
  const ipHash = createHash('sha256').update(real.toLowerCase()).digest('hex')
  return { ipHash, shared: parts.length > 1 }
}

export async function warnMemberAction(userId: number, reason: string, internalNotes?: string): Promise<ModResult> {
  const actor = await requireCapability('moderate_members')
  const res = await warnMember(actor, userId, { reason, internalNotes })
  if (!res.ok) return { error: res.error }
  revalidateModeration(userId)
  return { ok: true }
}

export async function timeoutMemberAction(userId: number, untilISO: string, reason: string): Promise<ModResult> {
  const actor = await requireCapability('moderate_members')
  const res = await applyTimeout(actor, userId, { until: new Date(untilISO), reason })
  if (!res.ok) return { error: res.error }
  revalidateModeration(userId)
  return { ok: true }
}

export async function banMemberAction(userId: number, reason: string, useIpProtection = false): Promise<ModResult> {
  const actor = await requireCapability('moderate_members')
  const ip = useIpProtection ? await hashedClientIp() : { ipHash: null, shared: false }
  const res = await applyBan(actor, userId, { reason, ipHash: ip.ipHash })
  if (!res.ok) return { error: res.error }
  revalidateModeration(userId)
  return { ok: true, ipShared: ip.shared }
}

export async function removePenaltyAction(penaltyId: number, userId: number, reason: string): Promise<ModResult> {
  const actor = await requireCapability('moderate_members')
  const res = await removePenalty(actor, penaltyId, { reason })
  if (!res.ok) return { error: res.error }
  revalidateModeration(userId)
  return { ok: true }
}

/** Soft delete (default): status DELETED, participation withdrawn, profile preserved + unlinked.
 *  OWNER-only — deleting/restoring an account is a heavier action than day-to-day moderation. */
export async function deleteAccountAction(userId: number, reason: string): Promise<ModResult> {
  const actor = await requireCapability('delete_account')
  const res = await softDeleteAccount(actor, userId, { reason })
  if (!res.ok) return { error: res.error }
  revalidateModeration(userId)
  return { ok: true }
}

/** Restore a soft-deleted (or otherwise penalised) member. OWNER-only, mirroring delete. */
export async function restoreMemberAction(userId: number, reason?: string): Promise<ModResult> {
  const actor = await requireCapability('delete_account')
  const res = await restoreMember(actor, userId, { reason })
  if (!res.ok) return { error: res.error }
  revalidateModeration(userId)
  return { ok: true }
}

/**
 * PERMANENT purge (Owner-only) — a hard delete of the Payload account, SEPARATE from soft
 * delete. The Player, rankings, matches, championships, aliases and audit are preserved
 * (soft-delete already unlinked the profile); the Payload `beforeDelete` backstop withdraws
 * any remaining active participation. The Owner account itself can never be purged.
 */
export async function purgeAccountAction(userId: number, reason: string): Promise<ModResult> {
  const actor = await requireCapability('purge_account')
  if (!reason.trim()) return { error: 'A reason is required to permanently delete an account.' }
  // Ensure the profile is unlinked + participation withdrawn first (idempotent if already soft-deleted).
  await softDeleteAccount(actor, userId, { reason })
  const p = await getPayload({ config: await config })
  try {
    await p.delete({ collection: 'users', id: userId, overrideAccess: true })
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not permanently delete the account.' }
  }
  await recordAudit(actor, { action: 'member.purge', entity: 'User', entityId: userId, reason })
  revalidateModeration(userId)
  return { ok: true }
}
