import 'server-only'
import { prisma } from '@/lib/prisma'

import { recordAudit, type Actor } from '@/lib/competition/audit'
import { softDeleteAccount, restoreMember } from '@/lib/moderation/service'
import { isAdmin, isOwner } from '@/lib/auth/roles'

/**
 * Reversible account merging.
 *
 * A merge NEVER deletes the secondary account and never rewrites historical rows. It records the
 * relationship in the existing `PlayerMerge` table and flips two reversible switches:
 *
 *   · the secondary Player is set `active = false` (hides it from Players lists and selectors)
 *   · the secondary's login is blocked through the existing moderation soft-delete, which is the
 *     established, already-tested "blocked login, history fully preserved" mechanism
 *
 * Undo reverses exactly those two switches and drops the merge record, so the secondary comes back
 * with its own login and its history displayed independently again. Because nothing was destroyed,
 * "restore exactly" is a property of the design rather than something we have to reconstruct.
 *
 * The pre-merge state of both switches is snapshotted into `PlayerMerge.note` as JSON, so undo
 * restores what was actually there rather than assuming defaults (a Player that was already
 * inactive before the merge stays inactive afterwards).
 */

export interface MergeSnapshot {
  /** `Player.active` on the secondary immediately before the merge. */
  secondaryWasActive: boolean
  /** Whether the secondary's account was already blocked before the merge. */
  secondaryWasBlocked: boolean
  /**
   * The account the secondary profile was linked to.
   *
   * Disabling the login goes through `softDeleteAccount`, which also clears `Player.linkedUserId`.
   * That means undo cannot read the account back off the Player — by then it is null — so the id
   * has to be remembered here or the login can never be restored.
   */
  secondaryUserId?: number | null
  /** `Player.linkStatus` before the merge, so undo restores what was there. */
  secondaryLinkStatus?: string | null
  mergedAt: string
}

export interface MergeCandidate {
  playerId: string
  userId: number | null
  cueverseId: string | null
  primaryName: string
  active: boolean
}

export interface MergedAccountRow extends MergeCandidate {
  mergeId: string
  mergedAt: Date
}

const PLAYER_SELECT = {
  id: true,
  linkedUserId: true,
  linkStatus: true,
  cueverseId: true,
  primaryName: true,
  active: true,
} as const

/* eslint-disable @typescript-eslint/no-explicit-any */
const toCandidate = (p: any): MergeCandidate => ({
  playerId: p.id,
  userId: p.linkedUserId ? Number(p.linkedUserId) : null,
  cueverseId: p.cueverseId,
  primaryName: p.primaryName,
  active: p.active,
})
/* eslint-enable @typescript-eslint/no-explicit-any */

// --------------------------------------------------------------------------- canonical resolution

/**
 * THE single place that answers "which player does this one really belong to?".
 *
 * Every surface that aggregates results, ratings, achievements or profile data must resolve through
 * here, so two pages can never disagree about who a player is. Chains are prohibited at merge time,
 * but this still walks defensively (bounded) so a hand-edited row cannot cause an infinite loop.
 */
export async function resolveCanonicalPlayerId(playerId: string): Promise<string> {
  let current = playerId
  const seen = new Set<string>([current])
  for (let hops = 0; hops < 8; hops++) {
    const merge = await prisma.playerMerge.findFirst({
      where: { mergedPlayerId: current, status: 'APPROVED' },
      select: { canonicalPlayerId: true },
    })
    if (!merge) return current
    if (seen.has(merge.canonicalPlayerId)) return current // cycle guard
    seen.add(merge.canonicalPlayerId)
    current = merge.canonicalPlayerId
  }
  return current
}

/** Resolve many ids at once — one query instead of N. Unmerged ids map to themselves. */
export async function resolveCanonicalPlayerIds(ids: string[]): Promise<Map<string, string>> {
  const map = new Map(ids.map((id) => [id, id]))
  if (ids.length === 0) return map
  const merges = await prisma.playerMerge.findMany({
    where: { mergedPlayerId: { in: ids }, status: 'APPROVED' },
    select: { mergedPlayerId: true, canonicalPlayerId: true },
  })
  for (const m of merges) map.set(m.mergedPlayerId, m.canonicalPlayerId)
  return map
}

/** Every player id whose history should roll up under `canonicalId` — itself plus its secondaries. */
export async function expandCanonicalPlayerIds(canonicalId: string): Promise<string[]> {
  const merges = await prisma.playerMerge.findMany({
    where: { canonicalPlayerId: canonicalId, status: 'APPROVED' },
    select: { mergedPlayerId: true },
  })
  return [canonicalId, ...merges.map((m) => m.mergedPlayerId)]
}

/** Player ids hidden from normal listings because they are merged into someone else. */
export async function mergedSecondaryPlayerIds(): Promise<string[]> {
  const rows = await prisma.playerMerge.findMany({
    where: { status: 'APPROVED' },
    select: { mergedPlayerId: true },
  })
  return rows.map((r) => r.mergedPlayerId)
}

/** The secondaries currently merged into a primary — powers the "Merged Accounts" section. */
export async function listMergedAccounts(canonicalPlayerId: string): Promise<MergedAccountRow[]> {
  const rows = await prisma.playerMerge.findMany({
    where: { canonicalPlayerId, status: 'APPROVED' },
    orderBy: { createdAt: 'desc' },
    include: { mergedPlayer: { select: PLAYER_SELECT } },
  })
  return rows.map((r) => ({ ...toCandidate(r.mergedPlayer), mergeId: r.id, mergedAt: r.createdAt }))
}

/** If this player is a merged secondary, the primary it should redirect to. */
export async function primaryOfMergedPlayer(playerId: string): Promise<MergeCandidate | null> {
  const merge = await prisma.playerMerge.findFirst({
    where: { mergedPlayerId: playerId, status: 'APPROVED' },
    include: { canonicalPlayer: { select: PLAYER_SELECT } },
  })
  return merge ? toCandidate(merge.canonicalPlayer) : null
}

// --------------------------------------------------------------------------- search

/** Candidate secondaries for the merge picker. Excludes the primary and anything already merged. */
export async function searchMergeCandidates(
  primaryPlayerId: string,
  q: string,
  limit = 10,
): Promise<MergeCandidate[]> {
  const term = q.trim()
  if (term.length < 2) return []
  const excluded = new Set([primaryPlayerId, ...(await mergedSecondaryPlayerIds())])
  const rows = await prisma.player.findMany({
    where: {
      OR: [
        { primaryName: { contains: term, mode: 'insensitive' } },
        { cueverseId: { contains: term, mode: 'insensitive' } },
      ],
    },
    orderBy: { primaryName: 'asc' },
    take: limit + excluded.size,
    select: PLAYER_SELECT,
  })
  return rows.filter((r) => !excluded.has(r.id)).slice(0, limit).map(toCandidate)
}

// --------------------------------------------------------------------------- guards

export type MergeCheck = { ok: true } | { ok: false; error: string }

/**
 * Every rule that makes a merge invalid, enforced server-side. Checked again inside the merge
 * transaction so a race cannot slip past a stale UI.
 */
export async function checkMergeAllowed(
  primaryPlayerId: string,
  secondaryPlayerId: string,
): Promise<MergeCheck> {
  if (!primaryPlayerId || !secondaryPlayerId) return { ok: false, error: 'Two accounts are required.' }
  if (primaryPlayerId === secondaryPlayerId) {
    return { ok: false, error: 'An account cannot be merged into itself.' }
  }

  const [primary, secondary] = await Promise.all([
    prisma.player.findUnique({ where: { id: primaryPlayerId }, select: PLAYER_SELECT }),
    prisma.player.findUnique({ where: { id: secondaryPlayerId }, select: PLAYER_SELECT }),
  ])
  if (!primary) return { ok: false, error: 'The primary account no longer exists.' }
  if (!secondary) return { ok: false, error: 'The selected account no longer exists.' }

  // Already a secondary somewhere? (covers duplicate merges too)
  const alreadyMerged = await prisma.playerMerge.findFirst({
    where: { mergedPlayerId: secondaryPlayerId, status: 'APPROVED' },
    select: { canonicalPlayerId: true },
  })
  if (alreadyMerged) {
    return {
      ok: false,
      error:
        alreadyMerged.canonicalPlayerId === primaryPlayerId
          ? 'That account is already merged into this one.'
          : 'That account is already merged into a different account. Undo that merge first.',
    }
  }

  // No chains: the secondary must not itself be a primary holding other accounts...
  const secondaryOwnsMerges = await prisma.playerMerge.count({
    where: { canonicalPlayerId: secondaryPlayerId, status: 'APPROVED' },
  })
  if (secondaryOwnsMerges > 0) {
    return {
      ok: false,
      error: 'That account already has accounts merged into it. Undo those first.',
    }
  }
  // ...and the primary must not itself be a secondary (that would create a chain).
  const primaryIsSecondary = await prisma.playerMerge.count({
    where: { mergedPlayerId: primaryPlayerId, status: 'APPROVED' },
  })
  if (primaryIsSecondary > 0) {
    return { ok: false, error: 'This account is itself merged into another account.' }
  }

  // A cycle can only form via a chain, which is already blocked — but assert it directly so the
  // invariant is enforced by this function rather than inferred from the two rules above.
  const canonicalOfPrimary = await resolveCanonicalPlayerId(primaryPlayerId)
  if (canonicalOfPrimary === secondaryPlayerId) {
    return { ok: false, error: 'That merge would create a cycle.' }
  }

  // Never absorb a privileged account as the secondary.
  if (secondary.linkedUserId) {
    const roles = await rolesOfUser(Number(secondary.linkedUserId))
    if (isOwner(roles) || isAdmin(roles)) {
      return { ok: false, error: 'An Owner or Admin account cannot be merged as a secondary.' }
    }
  }
  return { ok: true }
}

async function rolesOfUser(userId: number): Promise<string[]> {
  const { getPayload } = await import('payload')
  const config = (await import('@payload-config')).default
  const p = await getPayload({ config: await config })
  const doc = await p.findByID({ collection: 'users', id: userId, overrideAccess: true }).catch(() => null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Array.isArray((doc as any)?.roles) ? (doc as any).roles : []
}

// --------------------------------------------------------------------------- merge / undo

export async function mergeAccounts(
  actor: Actor,
  primaryPlayerId: string,
  secondaryPlayerId: string,
  reason?: string,
): Promise<{ ok: boolean; error?: string; mergeId?: string }> {
  const allowed = await checkMergeAllowed(primaryPlayerId, secondaryPlayerId)
  if (!allowed.ok) return { ok: false, error: allowed.error }

  const secondary = await prisma.player.findUnique({
    where: { id: secondaryPlayerId },
    select: PLAYER_SELECT,
  })
  if (!secondary) return { ok: false, error: 'The selected account no longer exists.' }

  const secondaryUserId = secondary.linkedUserId ? Number(secondary.linkedUserId) : null
  const wasBlocked = secondaryUserId ? await isAccountBlocked(secondaryUserId) : false

  const snapshot: MergeSnapshot = {
    secondaryWasActive: secondary.active,
    secondaryWasBlocked: wasBlocked,
    secondaryUserId,
    secondaryLinkStatus: secondary.linkStatus ?? null,
    mergedAt: new Date().toISOString(),
  }

  // The merge record and the Player flag move together; either both land or neither does.
  const mergeId = await prisma.$transaction(async (tx) => {
    const dup = await tx.playerMerge.findFirst({
      where: { mergedPlayerId: secondaryPlayerId, status: 'APPROVED' },
      select: { id: true },
    })
    if (dup) throw new Error('ALREADY_MERGED')

    const created = await tx.playerMerge.create({
      data: {
        canonicalPlayerId: primaryPlayerId,
        mergedPlayerId: secondaryPlayerId,
        status: 'APPROVED',
        note: JSON.stringify(snapshot),
        reviewedByUserId: String(actor.userId ?? ''),
        reviewedAt: new Date(),
      },
      select: { id: true },
    })
    await tx.player.update({ where: { id: secondaryPlayerId }, data: { active: false } })
    return created.id
  }).catch((e: unknown) => {
    if (e instanceof Error && e.message === 'ALREADY_MERGED') return null
    throw e
  })

  if (!mergeId) return { ok: false, error: 'That account was merged by someone else just now.' }

  // Login block lives in Payload, outside the Prisma transaction. If it fails, roll the merge back
  // so we never leave a half-merged account.
  if (secondaryUserId && !wasBlocked) {
    const blocked = await softDeleteAccount(actor, secondaryUserId, {
      reason: `Merged into player ${primaryPlayerId}`,
    })
    if (!blocked.ok) {
      await prisma.$transaction(async (tx) => {
        await tx.playerMerge.delete({ where: { id: mergeId } })
        await tx.player.update({
          where: { id: secondaryPlayerId },
          data: { active: snapshot.secondaryWasActive },
        })
      })
      return { ok: false, error: blocked.error ?? 'Could not disable the secondary account login.' }
    }
  }

  await recordAudit(actor, {
    action: 'player.merge',
    entity: 'Player',
    entityId: primaryPlayerId,
    newValue: { secondaryPlayerId, secondaryUserId, mergeId, snapshot },
    reason,
  })
  return { ok: true, mergeId }
}

export async function undoMerge(
  actor: Actor,
  mergeId: string,
  reason?: string,
): Promise<{ ok: boolean; error?: string; warning?: string }> {
  const merge = await prisma.playerMerge.findUnique({
    where: { id: mergeId },
    include: { mergedPlayer: { select: PLAYER_SELECT } },
  })
  if (!merge) return { ok: false, error: 'That merge no longer exists.' }
  if (merge.status !== 'APPROVED') return { ok: false, error: 'That merge is not active.' }

  let snapshot: MergeSnapshot | null = null
  try {
    snapshot = merge.note ? (JSON.parse(merge.note) as MergeSnapshot) : null
  } catch {
    snapshot = null
  }
  // Absent or unreadable snapshot: assume the pre-merge state was a normal, active, unblocked
  // account — the only state a merge is allowed to start from.
  const restoreActive = snapshot?.secondaryWasActive ?? true
  const wasBlocked = snapshot?.secondaryWasBlocked ?? false

  // The live column is null whenever we disabled the login, because that unlinks the profile. The
  // snapshot is the only place the account id survives, so prefer whichever is actually present.
  // Merges recorded before the snapshot carried the id fall back to the audit trail, which has
  // always logged it — without that, undoing an older merge could never restore its login.
  const liveUserId = merge.mergedPlayer.linkedUserId ? Number(merge.mergedPlayer.linkedUserId) : null
  const secondaryUserId =
    liveUserId ?? snapshot?.secondaryUserId ?? (await secondaryUserIdFromAudit(mergeId))

  // Re-linking can only fail if another profile claimed the account while this one was merged.
  // Restoring `active` still matters in that case, so the link is attempted separately.
  const needsRelink = liveUserId == null && secondaryUserId != null
  let relinkBlockedBy: string | null = null
  if (needsRelink) {
    const holder = await prisma.player.findFirst({
      where: { linkedUserId: String(secondaryUserId) },
      select: { id: true },
    })
    if (holder && holder.id !== merge.mergedPlayerId) relinkBlockedBy = holder.id
  }

  await prisma.$transaction(async (tx) => {
    await tx.playerMerge.delete({ where: { id: mergeId } })
    await tx.player.update({
      where: { id: merge.mergedPlayerId },
      data: {
        active: restoreActive,
        ...(needsRelink && !relinkBlockedBy
          ? {
              linkedUserId: String(secondaryUserId),
              linkStatus: (snapshot?.secondaryLinkStatus as 'VERIFIED' | null) ?? 'VERIFIED',
              linkedAt: new Date(),
            }
          : {}),
      },
    })
  })

  // Only lift the login block if WE applied it.
  if (secondaryUserId && !wasBlocked) {
    await restoreMember(actor, secondaryUserId, { reason: 'Merge undone' }).catch(() => null)
  }

  await recordAudit(actor, {
    action: 'player.merge.undo',
    entity: 'Player',
    entityId: merge.canonicalPlayerId,
    oldValue: { mergeId, secondaryPlayerId: merge.mergedPlayerId, snapshot, relinkBlockedBy },
    reason,
  })
  return relinkBlockedBy
    ? { ok: true, warning: `The account is now linked to another profile, so ${merge.mergedPlayer.primaryName} was reactivated without its login.` }
    : { ok: true }
}

/**
 * Recover a legacy merge's account id from the audit trail.
 *
 * `player.merge` has always logged `secondaryUserId`, so merges made before the snapshot carried it
 * can still be undone completely.
 */
async function secondaryUserIdFromAudit(mergeId: string): Promise<number | null> {
  const row = await prisma.auditLog.findFirst({
    where: { action: 'player.merge', newValue: { path: ['mergeId'], equals: mergeId } },
    orderBy: { createdAt: 'desc' },
    select: { newValue: true },
  }).catch(() => null)
  const raw = (row?.newValue as { secondaryUserId?: unknown } | null)?.secondaryUserId
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

async function isAccountBlocked(userId: number): Promise<boolean> {
  const { resolveMemberStatus } = await import('@/lib/moderation/service')
  const view = await resolveMemberStatus(userId)
  return !view.canLogin
}
