import 'server-only'
import { notFound } from 'next/navigation'

import { resolveStaffAccess, type StaffUser } from '@/lib/competition/staff-auth'

/**
 * The Creator gate.
 *
 * Creator creates, reconstructs and manages competitions, so it is administrative in full. This
 * wraps the EXISTING staff authorisation rather than introducing a second one — the role model,
 * the moderation boundary and the `can()` capabilities are all unchanged, and a gap here would be
 * a gap in the console too.
 *
 * ── Why every page calls this, and not just the layout ───────────────────────────────────────────
 * A layout gate is a rendering gate. It does not run for a server action, a route handler, or a
 * fetch of the page's own data, and Next may serve a nested route without re-running an ancestor
 * layout's data. So each Creator page calls this for itself, and every mutation calls the server
 * action guard below for itself. The navigation hiding Creator is presentation only.
 *
 * ── Why notFound() rather than a 403 ─────────────────────────────────────────────────────────────
 * A 403 confirms the route exists. For an administrative area that nobody is invited to, "there is
 * nothing here" is the more useful answer and leaks nothing about the shape of the application.
 */
export const CREATOR_CAPABILITY = 'manage_competitions' as const

/** Resolve the Creator actor, or render 404. Use at the top of every Creator page. */
export async function requireCreator(): Promise<StaffUser> {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok' || !access.actor.can(CREATOR_CAPABILITY)) notFound()
  return access.actor
}

/**
 * The same check for a server action, which must never rely on the page having run.
 *
 * Returns a discriminated result rather than throwing, so an action can answer with a message the
 * form can show instead of a stack trace the reader cannot act on.
 */
export async function creatorActor(): Promise<
  { ok: true; actor: StaffUser } | { ok: false; error: string }
> {
  const access = await resolveStaffAccess()
  if (access.status === 'anon') return { ok: false, error: 'Sign in to manage competitions.' }
  if (access.status === 'forbidden' || !access.actor.can(CREATOR_CAPABILITY)) {
    return { ok: false, error: 'You do not have permission to manage competitions.' }
  }
  return { ok: true, actor: access.actor }
}

/** Whether the navigation should offer Creator at all. Presentation only — never a security check. */
export async function canSeeCreator(): Promise<boolean> {
  const access = await resolveStaffAccess()
  return access.status === 'ok' && access.actor.can(CREATOR_CAPABILITY)
}
