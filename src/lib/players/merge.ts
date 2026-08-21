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

/**
 * Whether a released handle may be shown publicly as an alias.
 *
 * Some archive-era profiles were registered under an email address, so the "handle" being released
 * is somebody's private contact detail. Aliases are public — they are searched, exported in the
 * Rankings CSV and rendered on profiles — so an address must never be promoted into one. The
 * merge still releases the handle; it just does not advertise it.
 *
 * The site has had an email leak through a public entrant field before. This is the same rule.
 */
function isPubliclyShowableHandle(handle: string): boolean {
  return !handle.includes('@')
}

export interface MergeSnapshot {
  /**
   * Entrant rows moved from the secondary onto the canonical profile, with the display identity
   * each carried beforehand.
   *
   * Undo has to put these back on the exact rows it took them from, and restore the names they
   * were entered under. Recomputing "which entrants belonged to the secondary" at undo time would
   * be wrong the moment anything else touched them in between.
   */
  movedEntrants?: { id: number; username: string; displayName: string | null }[]
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
  /**
   * The CueVerse ID the secondary held, released by the merge so the handle can be used again.
   *
   * A merged profile is not a person any more — it is one half of somebody who now has a single
   * identity — so continuing to hold a handle nobody can reach is only a way of making that handle
   * unusable forever. `Player.cueverseIdNormalized` is UNIQUE at the database level, so freeing it
   * means actually clearing the column rather than teaching a validator to look the other way.
   *
   * Kept here because undo has to be able to give it back, and by then the live column is null.
   */
  secondaryCueverseId?: string | null
  /**
   * The retired account's login username, parked so the handle is free on BOTH sides.
   *
   * A CueVerse ID lives in two stores: `Player.cueverseIdNormalized` and the Payload login
   * `users.username`, which `changeCueverseId` keeps in step. Releasing only the Player half left
   * the login half holding the name, so claiming it failed at the second write with "Could not
   * update the login identity" — the handle looked free and was not.
   */
  secondaryUsername?: string | null
  /** Whether the merge added the released handle to the canonical profile as an alias. */
  aliasAddedToCanonical?: boolean
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
      // A management-only account is not a competitor, so it is never a merge candidate either.
      managementOnly: false,
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

  /*
   * A Season holds each player once.
   *
   * If both profiles entered the same Season, moving one onto the other would either violate that
   * or silently drop an entry — and which of two entries is the real one is a judgement about what
   * happened in a pool hall, not something this can infer. It refuses and says where.
   */
  const secondaryEntrants = await prisma.seasonEntrant.findMany({
    where: { playerId: secondaryPlayerId },
    select: { id: true, seasonId: true, username: true, displayName: true },
  })
  if (secondaryEntrants.length > 0) {
    const primarySeasons = new Set(
      (await prisma.seasonEntrant.findMany({
        where: { playerId: primaryPlayerId }, select: { seasonId: true },
      })).map((e) => e.seasonId),
    )
    const clash = [...new Set(secondaryEntrants.filter((e) => primarySeasons.has(e.seasonId)).map((e) => e.seasonId))]
    if (clash.length > 0) {
      return {
        ok: false,
        error: `Both profiles are entrants in Season ${clash.join(', ')}. Remove one of the duplicate entries first — which of the two is the real one is not something a merge can decide.`,
      }
    }
  }

  const snapshot: MergeSnapshot = {
    movedEntrants: secondaryEntrants.map((e) => ({ id: e.id, username: e.username, displayName: e.displayName })),
    secondaryWasActive: secondary.active,
    secondaryWasBlocked: wasBlocked,
    secondaryUserId,
    secondaryLinkStatus: secondary.linkStatus ?? null,
    secondaryCueverseId: secondary.cueverseId ?? null,
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
    /*
     * Deactivate the secondary AND release its CueVerse ID.
     *
     * The handle used to stay on the merged profile, which made it permanently unusable: the column
     * is UNIQUE, so the person it was merged INTO could not take it, and neither could anyone else.
     * That is the wrong answer for the commonest reason a merge happens at all — somebody typed
     * their handle two ways, and the one they actually want is sitting on the row being retired.
     *
     * The handle is not lost. It moves to the canonical profile as an alias first, so search, the
     * archive matcher and every historical lookup still find the person by it; only then is the
     * column cleared. Undo restores it, if it is still free by then.
     */
    const released = secondary.cueverseId?.trim() || null
    let aliasAdded = false
    if (released && isPubliclyShowableHandle(released)) {
      const existing = await tx.playerAlias.findFirst({
        where: { playerId: primaryPlayerId, alias: { equals: released, mode: 'insensitive' }, aliasType: 'HANDLE' },
        select: { id: true },
      })
      if (!existing) {
        await tx.playerAlias.create({
          data: { playerId: primaryPlayerId, alias: released, aliasType: 'HANDLE' },
        })
        aliasAdded = true
      }
    }

    await tx.player.update({
      where: { id: secondaryPlayerId },
      data: { active: false, ...(released ? { cueverseId: null, cueverseIdNormalized: null } : {}) },
    })

    /*
     * Park the login username, which is the OTHER place the handle lives.
     *
     * `changeCueverseId` writes both stores and rolls the whole rename back if the second write
     * fails, so leaving the retired account's username alone meant the handle was still spoken for:
     * the Player column was free, the claim passed its uniqueness check, and then the login sync
     * collided and reported "Could not update the login identity — no change was made."
     *
     * The account keeps working exactly as before: the merge already blocks its login through the
     * moderation soft-delete, which is what actually retires it. This only gives up a name it can no
     * longer use. Written as SQL because the merge is one Prisma transaction, and because the
     * moderation path that retires the account is Prisma-only for the same reason.
     */
    let parkedUsername: string | null = null
    if (released && secondaryUserId) {
      const rows = await tx.$queryRaw<{ username: string | null }[]>`
        SELECT username FROM payload.users WHERE id = ${secondaryUserId}`
      const current = rows[0]?.username ?? null
      if (current && current.trim().toLowerCase() === released.trim().toLowerCase()) {
        parkedUsername = current
        await tx.$executeRaw`
          UPDATE payload.users SET username = ${`merged-${secondaryUserId}`} WHERE id = ${secondaryUserId}`
      }
    }

    if (aliasAdded || parkedUsername) {
      // The snapshot is already written; amend it with what undo needs to put back.
      await tx.playerMerge.update({
        where: { id: created.id },
        data: {
          note: JSON.stringify({
            ...snapshot,
            ...(aliasAdded ? { aliasAddedToCanonical: true } : {}),
            ...(parkedUsername ? { secondaryUsername: parkedUsername } : {}),
          }),
        },
      })
    }

    /*
     * Move the competition records, or the merge is only half of one.
     *
     * Recording the link and deactivating the profile leaves the person's results split across two
     * identities, which no read path unions — so the Rankings shows them twice and the official
     * ladder disagrees with the table about who is who. That is not a merge; it is a note saying a
     * merge ought to happen.
     */
    if (secondaryEntrants.length > 0) {
      const canon = await tx.player.findUniqueOrThrow({
        where: { id: primaryPlayerId }, select: { cueverseId: true, primaryName: true },
      })
      for (const e of secondaryEntrants) {
        await tx.seasonEntrant.update({
          where: { id: e.id },
          data: {
            playerId: primaryPlayerId,
            username: canon.cueverseId ?? canon.primaryName,
            displayName: canon.primaryName,
          },
        })
      }
    }

    /*
     * The ledger is REBUILT, never repointed — and only when something actually moved.
     *
     * It is derived: a full replay of every completed competition in order. Rewriting its playerId
     * in place would move the rows while leaving each pre/post rating computed against the old split
     * history, so the figures would look right and mean nothing.
     *
     * Scoped to merges that moved entrants, because a merge that moved no competition records has
     * nothing derived to change. Rebuilding regardless would also delete any ledger row with no
     * competition behind it, which is a legitimate state in test fixtures and not this operation's
     * business to tidy up.
     */
    if (secondaryEntrants.length > 0) {
      await tx.ratingLedger.deleteMany({ where: { playerId: secondaryPlayerId } })
      const { rebuildRatingLedger } = await import('@/lib/stats/ledger')
      await rebuildRatingLedger(tx)
    }

    return created.id
  }, { timeout: 120_000 }).catch((e: unknown) => {
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
        // The entrants moved inside the committed transaction above, so backing out the merge has
        // to move them back — otherwise a failed merge leaves the results on the wrong profile.
        const moved = snapshot.movedEntrants ?? []
        for (const e of moved) {
          await tx.seasonEntrant.update({
            where: { id: e.id },
            data: { playerId: secondaryPlayerId, username: e.username, displayName: e.displayName },
          })
        }
        if (moved.length > 0) {
          const { rebuildRatingLedger } = await import('@/lib/stats/ledger')
          await rebuildRatingLedger(tx)
        }
      }, { timeout: 120_000 })
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

  /*
   * The CueVerse ID the merge released, if it is still going spare.
   *
   * Freeing the handle is the point of releasing it, so somebody may well have taken it since —
   * quite possibly the very profile this was merged into, which is the ordinary case. The column is
   * UNIQUE, so undo cannot simply write it back; it checks first and, when the handle has gone,
   * restores the profile without one and says so rather than failing the whole undo over a name.
   */
  const releasedId = merge.mergedPlayer.cueverseId == null ? (snapshot?.secondaryCueverseId ?? null) : null
  let handleTakenBy: string | null = null
  if (releasedId) {
    const holder = await prisma.player.findFirst({
      where: { cueverseIdNormalized: releasedId.trim().toLowerCase() },
      select: { id: true, primaryName: true, cueverseId: true },
    })
    if (holder && holder.id !== merge.mergedPlayerId) handleTakenBy = holder.cueverseId ?? holder.primaryName
  }
  const restoreHandle = releasedId != null && handleTakenBy == null

  await prisma.$transaction(async (tx) => {
    await tx.playerMerge.delete({ where: { id: mergeId } })

    // Put back exactly the rows the merge took, under the names they were entered with. A merge
    // recorded before this was tracked has no list, and its entrants stay where they are — undoing
    // it cannot invent a split that was never written down.
    const movedBack = snapshot?.movedEntrants ?? []
    for (const e of movedBack) {
      await tx.seasonEntrant.update({
        where: { id: e.id },
        data: { playerId: merge.mergedPlayerId, username: e.username, displayName: e.displayName },
      }).catch(() => {})
    }

    await tx.player.update({
      where: { id: merge.mergedPlayerId },
      data: {
        active: restoreActive,
        ...(restoreHandle
          ? { cueverseId: releasedId, cueverseIdNormalized: releasedId!.trim().toLowerCase() }
          : {}),
        ...(needsRelink && !relinkBlockedBy
          ? {
              linkedUserId: String(secondaryUserId),
              linkStatus: (snapshot?.secondaryLinkStatus as 'VERIFIED' | null) ?? 'VERIFIED',
              linkedAt: new Date(),
            }
          : {}),
      },
    })

    /*
     * Take back only an alias this merge created.
     *
     * A handle the canonical profile already carried before the merge is that profile's own history
     * and stays. `aliasAddedToCanonical` is written at merge time precisely so undo does not have to
     * guess which of the two it is.
     */
    if (snapshot?.aliasAddedToCanonical && releasedId) {
      await tx.playerAlias.deleteMany({
        where: { playerId: merge.canonicalPlayerId, alias: releasedId, aliasType: 'HANDLE' },
      })
    }

    // The login name comes back with the handle, and on the same condition: only if still free.
    if (restoreHandle && snapshot?.secondaryUsername && secondaryUserId) {
      const taken = await tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM payload.users
         WHERE lower(username) = ${snapshot.secondaryUsername.trim().toLowerCase()} AND id <> ${secondaryUserId}`
      if (taken.length === 0) {
        await tx.$executeRaw`
          UPDATE payload.users SET username = ${snapshot.secondaryUsername} WHERE id = ${secondaryUserId}`
      }
    }

    // Same scoping as the merge: nothing moved, nothing derived to rebuild.
    if (movedBack.length > 0) {
      const { rebuildRatingLedger } = await import('@/lib/stats/ledger')
      await rebuildRatingLedger(tx)
    }
  }, { timeout: 120_000 })

  // Only lift the login block if WE applied it.
  if (secondaryUserId && !wasBlocked) {
    await restoreMember(actor, secondaryUserId, { reason: 'Merge undone' }).catch(() => null)
  }

  await recordAudit(actor, {
    action: 'player.merge.undo',
    entity: 'Player',
    entityId: merge.canonicalPlayerId,
    oldValue: { mergeId, secondaryPlayerId: merge.mergedPlayerId, snapshot, relinkBlockedBy, handleTakenBy },
    reason,
  })
  // Both warnings can apply at once, and each says exactly what did not come back.
  const notes = [
    relinkBlockedBy
      ? `The account is now linked to another profile, so ${merge.mergedPlayer.primaryName} was reactivated without its login.`
      : null,
    handleTakenBy
      ? `The CueVerse ID "${releasedId}" has since been taken by ${handleTakenBy}, so ${merge.mergedPlayer.primaryName} was reactivated without it.`
      : null,
  ].filter(Boolean)
  return notes.length ? { ok: true, warning: notes.join(' ') } : { ok: true }
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
