'use server'

import { revalidatePath } from 'next/cache'

import { requireCapability } from '@/lib/competition/staff-auth'
import { getCurrentUser } from '@/lib/account/auth'
import { prisma } from '@/lib/prisma'
import { isOwner } from '@/lib/auth/roles'
import { recordAudit } from '@/lib/competition/audit'
import {
  mergeAccounts,
  undoMerge,
  searchMergeCandidates,
  checkMergeAllowed,
  type MergeCandidate,
} from './merge'
import { assessAccountDeletion, type DeletionAssessment } from './deletion-safety'
import { softDeleteAccount } from '@/lib/moderation/service'

/**
 * Server actions for account merging and safe deletion.
 *
 * Merging is gated on `manage_players` (ADMIN/OWNER). Deletion is gated on `delete_account`
 * (OWNER only) — the same capability the existing moderation delete uses, so this does not widen
 * who may remove an account. Every rule is re-checked here and again in the service, so the UI is
 * never the control.
 */

export interface MergeActionResult {
  ok?: boolean
  error?: string
}

function revalidateMember(userId?: number | null) {
  if (userId != null) revalidatePath(`/staff/members/${userId}`)
  revalidatePath('/staff/members')
  revalidatePath('/rankings')
}

export async function searchMergeCandidatesAction(
  primaryPlayerId: string,
  q: string,
): Promise<MergeCandidate[]> {
  await requireCapability('manage_players')
  return searchMergeCandidates(primaryPlayerId, q)
}

/** Pre-flight for the confirmation dialog: is this pair mergeable? */
export async function checkMergeAction(
  primaryPlayerId: string,
  secondaryPlayerId: string,
): Promise<MergeActionResult> {
  await requireCapability('manage_players')
  const res = await checkMergeAllowed(primaryPlayerId, secondaryPlayerId)
  return res.ok ? { ok: true } : { error: res.error }
}

export async function mergeAccountsAction(
  primaryPlayerId: string,
  secondaryPlayerId: string,
  primaryUserId?: number,
): Promise<MergeActionResult> {
  const actor = await requireCapability('manage_players')
  const res = await mergeAccounts(actor, primaryPlayerId, secondaryPlayerId)
  if (!res.ok) return { error: res.error }
  revalidateMember(primaryUserId)
  return { ok: true }
}

export async function undoMergeAction(
  mergeId: string,
  primaryUserId?: number,
): Promise<MergeActionResult> {
  const actor = await requireCapability('manage_players')
  const res = await undoMerge(actor, mergeId)
  if (!res.ok) return { error: res.error }
  revalidateMember(primaryUserId)
  return { ok: true }
}

// --------------------------------------------------------------------------- deletion

export interface DeletionPlan extends DeletionAssessment {
  /** Typed-confirmation target: the operator must type this exactly. */
  confirmName: string
  /** Set when deletion is refused outright (e.g. the signed-in Owner). */
  blockedReason?: string
}

/** What would happen if this account were deleted — drives the confirmation dialog copy. */
export async function planAccountDeletionAction(userId: number): Promise<DeletionPlan> {
  await requireCapability('delete_account')

  const [profile, me] = await Promise.all([
    prisma.player.findUnique({
      where: { linkedUserId: String(userId) },
      select: { id: true, cueverseId: true, primaryName: true },
    }),
    getCurrentUser(),
  ])

  const username = me?.id === String(userId) ? me.username : await usernameOf(userId)
  const assessment = await assessAccountDeletion(userId, profile?.id ?? null, username)
  const confirmName = profile?.cueverseId || profile?.primaryName || username || String(userId)

  const blockedReason = await ownerSelfBlock(userId)
  return { ...assessment, confirmName, ...(blockedReason ? { blockedReason } : {}) }
}

/**
 * Archive (or, when nothing depends on it, permanently delete) an account.
 *
 * The typed name must match, the signed-in Owner can never delete themselves, and the
 * archive-vs-permanent decision is recomputed HERE rather than trusted from the client — a stale
 * dialog cannot talk us into a hard delete.
 */
export async function deleteAccountSafelyAction(
  userId: number,
  typedName: string,
): Promise<MergeActionResult & { outcome?: 'permanent' | 'archive' }> {
  const actor = await requireCapability('delete_account')

  const blocked = await ownerSelfBlock(userId)
  if (blocked) return { error: blocked }

  const plan = await planAccountDeletionAction(userId)
  if (typedName.trim() !== plan.confirmName) {
    return { error: `Type "${plan.confirmName}" exactly to confirm.` }
  }

  if (!plan.canPermanentlyDelete) {
    // Historical data exists — archive instead, using the existing reversible soft delete.
    const res = await softDeleteAccount(actor, userId, {
      reason: `Archived by staff (${plan.totalDependencies} dependent record(s) preserved)`,
    })
    if (!res.ok) return { error: res.error }
    const profile = await prisma.player.findUnique({
      where: { linkedUserId: String(userId) },
      select: { id: true },
    })
    if (profile) await prisma.player.update({ where: { id: profile.id }, data: { active: false } })
    await recordAudit(actor, {
      action: 'member.archive',
      entity: 'User',
      entityId: userId,
      newValue: { dependencies: plan.dependencies },
    })
    revalidateMember(userId)
    return { ok: true, outcome: 'archive' }
  }

  // Nothing references this account — safe to remove outright.
  const { getPayload } = await import('payload')
  const config = (await import('@payload-config')).default
  const p = await getPayload({ config: await config })
  const profile = await prisma.player.findUnique({
    where: { linkedUserId: String(userId) },
    select: { id: true },
  })
  if (profile) await prisma.player.delete({ where: { id: profile.id } })
  await p.delete({ collection: 'users', id: userId, overrideAccess: true })

  await recordAudit(actor, {
    action: 'member.delete.permanent',
    entity: 'User',
    entityId: userId,
    oldValue: { hadProfile: Boolean(profile) },
  })
  revalidateMember(userId)
  return { ok: true, outcome: 'permanent' }
}

async function usernameOf(userId: number): Promise<string | null> {
  const { getPayload } = await import('payload')
  const config = (await import('@payload-config')).default
  const p = await getPayload({ config: await config })
  const doc = await p.findByID({ collection: 'users', id: userId, overrideAccess: true }).catch(() => null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (doc as any)?.username ?? null
}

/** The signed-in Owner may never delete their own account. */
async function ownerSelfBlock(targetUserId: number): Promise<string | null> {
  const me = await getCurrentUser()
  if (!me) return 'Not signed in.'
  if (String(targetUserId) !== me.id) return null
  return isOwner(me.roles)
    ? 'You cannot delete the account you are signed in as. Transfer ownership first.'
    : 'You cannot delete your own account here.'
}
