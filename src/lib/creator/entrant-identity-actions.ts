'use server'

import { creatorActor } from './access'
import { applyIdentityPatch } from '@/lib/players/identity-edit'

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

  /*
    The sequence itself lives in `applyIdentityPatch`, shared with the Players directory. Creator
    brings its own gate — permission to run competitions — and nothing else about the edit differs.
  */
  return applyIdentityPatch(
    { userId: gate.actor.userId, username: gate.actor.username },
    playerId,
    patch,
    'Creator correction',
  )
}
