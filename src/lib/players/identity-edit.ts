import 'server-only'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/lib/prisma'
import { updateProfile, changeCueverseId } from '@/lib/players/service'
import { propagateIdentityChange, identityChanged } from '@/lib/players/identity-propagation'
import { validatePreferredName, validateCueverseId } from '@/lib/account/validation'
import { recordAudit } from '@/lib/competition/audit'
import { invalidateRankings } from '@/lib/stats/invalidate-rankings'

/**
 * Correcting a player's canonical identity — one implementation, two doors.
 *
 * ── Why this is not written twice ───────────────────────────────────────────────────────────────
 * Creator corrects an entrant's spelling from inside a competition; the Players directory corrects
 * it from a list of everybody. They are the same edit, and the sequence it has to perform is not
 * short: validate, write the Player, keep the login username in step, propagate the new spelling to
 * every Season, Tournament and ranking row that copied the old one, audit it, and drop the cached
 * ladder that still carries the old name.
 *
 * A second copy of that sequence is how the identity drift this system already had to be repaired
 * once got started — two paths that agree today and diverge the first time only one of them is
 * changed. So the sequence lives here and the callers bring only their own authorisation, which is
 * the part that genuinely differs: Creator gates on running competitions, the directory on
 * `manage_players`.
 *
 * ── Canonical, not local ────────────────────────────────────────────────────────────────────────
 * This writes the Player row and then propagates. Editing the competition entry instead would fix
 * one screen and leave the same person under two names everywhere else.
 */
export interface IdentityEditResult {
  ok?: boolean
  error?: string
  /** Competition records re-labelled by the change, so the operator sees it actually travelled. */
  propagated?: number
}

/** Cache invalidation that tolerates having no cache — see the note at its only call site. */
function invalidate(fn: () => void): void {
  try {
    fn()
  } catch {
    // No request context, so nothing is cached and nothing needs clearing.
  }
}

export async function applyIdentityPatch(
  actorRef: { userId: number; username: string },
  playerId: string,
  patch: { preferredName?: string; cueverseId?: string },
  reason: string,
): Promise<IdentityEditResult> {
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

  const before = { preferredName: player.primaryName, cueverseId: player.cueverseId }

  /*
    The handle first, deliberately — it is the change that can be refused.

    `changeCueverseId` spans two stores (the Player row and the Payload login) and is atomic about
    it: if the login sync fails it reverts its own write and reports that nothing changed. It can
    also be refused outright, most commonly because the handle is already taken.

    The preferred name is a single update that all but cannot fail. Doing the name FIRST meant a
    refused handle returned an error with the name already committed: the operator is told the edit
    failed while half of it has landed, and the only clue is that the list now disagrees with what
    they typed. Attempting the fallible half first makes a refusal leave the record untouched.
  */
  if (handle && handle !== player.cueverseId) {
    /*
      Override, because this is staff correcting a record rather than a member renaming themselves.
      The cooldown exists to stop somebody churning their own handle; it is not a rule about what an
      administrator may fix.
    */
    const r = await changeCueverseId(actorRef, player.id, handle, { override: true, reason })
    if (!r.ok) return { error: r.error }
  }
  if (name && name !== player.primaryName) {
    await updateProfile(actorRef, player.id, { primaryName: name })
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
      reason,
    })
    /*
      The ladder carries names too; leaving it cached shows the old spelling next to the new one.

      Guarded, because `revalidatePath` throws outside a request context — and this function is
      deliberately callable from a script and from the verification suite, where there is no cache
      to clear. Unguarded it threw AFTER the rename had already been written and propagated, which
      is the worst shape a failure can take: the work is done and the caller is told it failed.
    */
    invalidate(() => {
      invalidateRankings()
      revalidatePath('/rankings')
      revalidatePath('/creator')
      revalidatePath('/players')
    })
  }

  return { ok: true, propagated }
}
