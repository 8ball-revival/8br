'use server'

import { requireCapability } from '@/lib/competition/staff-auth'
import { applyIdentityPatch, type IdentityEditResult } from '@/lib/players/identity-edit'

/**
 * Correct a player's CueVerse ID or Preferred Name from the Players directory.
 *
 * ── The gate is the only thing this adds ────────────────────────────────────────────────────────
 * The edit itself is `applyIdentityPatch`, shared with Creator: validate, write the Player, keep the
 * login username in step, propagate the new spelling everywhere it was copied, audit, and drop the
 * cached ladder. Writing that a second time is how two paths start disagreeing.
 *
 * What differs is who may do it. Creator asks for permission to run competitions, because that is
 * the context an entrant is being corrected in. Here it is `manage_players` — a decision about a
 * person rather than about a competition — which is ADMIN and above.
 *
 * The check runs in the action rather than in the page. A server action is a public endpoint: a
 * form that is not drawn stops nobody from calling it.
 */
export async function updatePlayerIdentityAction(
  playerId: string,
  patch: { preferredName?: string; cueverseId?: string },
): Promise<IdentityEditResult> {
  let actor
  try {
    actor = await requireCapability('manage_players')
  } catch {
    return { error: 'You do not have permission to edit player identities.' }
  }

  return applyIdentityPatch(
    { userId: actor.userId, username: actor.username },
    playerId,
    patch,
    'Players directory correction',
  )
}
