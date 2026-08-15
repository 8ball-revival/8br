/**
 * Pure authorization for admin-initiated password resets (no I/O, no server-only imports — so it is
 * unit-testable and safe to import anywhere). Admins reset Members; the Head Admin also resets Admins;
 * the Head Admin is never reset through the portal.
 */
export type TargetTier = 'member' | 'admin' | 'headAdmin'

export function canResetTarget(actor: { isAdmin: boolean; isOwner: boolean; isHeadAdmin: boolean }, tier: TargetTier): { ok: boolean; error?: string } {
  if (!actor.isAdmin && !actor.isOwner) return { ok: false, error: 'Only staff may reset passwords.' }
  if (tier === 'headAdmin') return { ok: false, error: 'The Head Admin password cannot be reset here — use secure self-service recovery.' }
  if (tier === 'admin' && !actor.isHeadAdmin) return { ok: false, error: 'Only the Head Admin may reset an Admin password.' }
  return { ok: true }
}
