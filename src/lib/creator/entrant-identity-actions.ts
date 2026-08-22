'use server'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/lib/prisma'
import { creatorActor } from './access'
import { updateProfile, changeCueverseId } from '@/lib/players/service'
import { propagateIdentityChange, identityChanged } from '@/lib/players/identity-propagation'
import { validatePreferredName, validateCueverseId } from '@/lib/account/validation'
import { recordAudit } from '@/lib/competition/audit'
import { invalidateRankings } from '@/lib/stats/invalidate-rankings'

export interface EntrantIdentityResult {
  ok?: boolean
  error?: string
  /** Competition records re-labelled by the change, so the operator sees it actually travelled. */
  propagated?: number
}

/**
 * Correct an entrant's canonical identity from inside Creator.
 *
 * ── Keyed on the PLAYER, not the account ─────────────────────────────────────────────────────────
 * The staff member editor takes a Payload user id, which is right for a member being administered
 * but wrong here: most entrants in a reconstructed Season are archive Players with no account at
 * all, and those are exactly the ones whose spelling needs fixing. Keying on the Player id covers
 * both — `changeCueverseId` syncs the login only when there is one to sync.
 *
 * ── Canonical, not local ─────────────────────────────────────────────────────────────────────────
 * This writes the Player and then propagates, so the correction reaches every Season, Tournament and
 * ranking row that copied the old spelling. The alternative — editing the entrant row — would fix
 * the name on this one screen and leave the same person under two names everywhere else, which is
 * how the identity drift this system already had to be repaired once got started.
 */
export async function updateEntrantIdentityAction(
  playerId: string,
  patch: { preferredName?: string; cueverseId?: string },
): Promise<EntrantIdentityResult> {
  const gate = await creatorActor()
  if (!gate.ok) return { error: gate.error }

  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { id: true, primaryName: true, cueverseId: true },
  })
  if (!player) return { error: 'That player no longer exists.' }

  const name = patch.preferredName?.trim()
  const handle = patch.cueverseId?.trim()
  if (name != null && name !== '') {
    const err = validatePreferredName(name)
    if (err) return { error: err }
  }
  if (handle != null && handle !== '') {
    const err = validateCueverseId(handle)
    if (err) return { error: err }
  }

  const actorRef = { userId: gate.actor.userId, username: gate.actor.username }
  const before = { preferredName: player.primaryName, cueverseId: player.cueverseId }

  if (name && name !== player.primaryName) {
    await updateProfile(actorRef, player.id, { primaryName: name })
  }
  if (handle && handle !== player.cueverseId) {
    const r = await changeCueverseId(actorRef, player.id, handle, { override: true, reason: 'Creator correction' })
    if (!r.ok) return { error: r.error }
  }

  const after = await prisma.player.findUnique({
    where: { id: player.id },
    select: { primaryName: true, cueverseId: true },
  })
  const change = {
    playerId: player.id,
    oldCueverseId: before.cueverseId,
    newCueverseId: after?.cueverseId ?? before.cueverseId,
    oldPreferredName: before.preferredName,
    newPreferredName: after?.primaryName ?? before.preferredName,
  }

  let propagated = 0
  if (identityChanged(change)) {
    propagated = (await propagateIdentityChange(change)).total
    await recordAudit(actorRef, {
      action: 'player.identity.update',
      entity: 'Player',
      entityId: 0,
      oldValue: before,
      newValue: { preferredName: change.newPreferredName, cueverseId: change.newCueverseId },
    })
    // The ladder carries names too; leaving it cached shows the old spelling next to the new one.
    invalidateRankings()
    revalidatePath('/rankings')
    revalidatePath('/creator')
  }

  return { ok: true, propagated }
}
