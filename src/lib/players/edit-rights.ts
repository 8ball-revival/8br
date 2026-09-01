/**
 * Who may edit a player profile.
 *
 * ── Why this is its own file ────────────────────────────────────────────────────────────────────
 * It lives outside the actions module because a `'use server'` file may only export async server
 * actions, and this rule needs to be callable directly — by the action, and by a test that wants to
 * try every combination of link status, viewer and permission without a session or a database.
 *
 * It is the decision that protects every profile on the site. Buried inside two awaited lookups it
 * could only be checked by reading it; here it can be proven.
 */

/** The rule. Pure: no session, no database, no framework. */
export function decideEditRights(input: {
  /** The signed-in account's id, or null when nobody is signed in. */
  viewerUserId: string | null
  /** The profile being edited, or null when it does not exist. */
  player: { linkedUserId: string | null; linkStatus: string } | null
  /** Whether the viewer holds the existing player-management permission. */
  staff: boolean
}): { ok: true; via: 'owner' | 'staff' } | { ok: false; error: string } {
  if (!input.viewerUserId) return { ok: false, error: 'Sign in to edit this profile.' }
  if (!input.player) return { ok: false, error: 'That profile no longer exists.' }

  /*
    Ownership is a VERIFIED link and nothing weaker.

    PENDING is somebody asserting the profile is theirs, which is exactly the state a claim is in
    before anyone has checked it — treating it as ownership would let the claim grant itself. The
    same goes for REJECTED and REVOKED, which are the site having already said no.
  */
  const owns = input.player.linkStatus === 'VERIFIED'
    && input.player.linkedUserId != null
    && input.player.linkedUserId === input.viewerUserId
  if (owns) return { ok: true, via: 'owner' }

  if (input.staff) return { ok: true, via: 'staff' }
  return { ok: false, error: 'You do not have permission to edit this profile.' }
}
