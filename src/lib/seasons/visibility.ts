import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'

/**
 * Who may open a Season's public page.
 *
 * ── One rule, one place ──────────────────────────────────────────────────────────────────────────
 * `publiclyVisible = false` means the Season is not public. Not "not listed" — not public. It has to
 * hold on the detail route, in the metadata, and anywhere else a Season can be reached, and the only
 * way to be sure of that is for every one of them to ask the same function. Written out separately
 * at each call site, one of them eventually forgets, and the one that forgets is the leak.
 *
 * The rule does not care WHY a Season is private. A generated archive shell, a reconstruction the
 * owner started by hand, or something private for a reason nobody has thought of yet are all the
 * same case, so none of them can be the exception that was missed.
 *
 * ── Staff are not an exception to the rule, they are part of it ──────────────────────────────────
 * An administrator managing a private Season is the entire point of it being private rather than
 * deleted. They see it; nobody else does.
 */

export interface SeasonAccess {
  /** The Season exists and this viewer may see it. */
  allowed: boolean
  /** True when the Season exists but is private and this viewer is not staff. */
  hidden: boolean
}

/**
 * Decide access for one Season.
 *
 * Returns the same shape for "does not exist" and "exists but is private", so a caller that does the
 * obvious thing — call notFound() when `allowed` is false — cannot accidentally tell the two apart
 * for the visitor. A different status or a different message for a private Season would confirm it
 * exists, which is most of what somebody guessing ids wants to learn.
 */
export async function seasonAccess(seasonId: number): Promise<SeasonAccess> {
  if (!Number.isInteger(seasonId) || seasonId <= 0) return { allowed: false, hidden: false }

  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    select: { publiclyVisible: true },
  })
  if (!season) return { allowed: false, hidden: false }
  if (season.publiclyVisible) return { allowed: true, hidden: false }

  const access = await resolveStaffAccess()
  const canManage = access.status === 'ok' && access.actor.can('manage_competitions')
  return { allowed: canManage, hidden: !canManage }
}

/** Convenience for the common case: may this viewer see it at all? */
export async function canViewSeason(seasonId: number): Promise<boolean> {
  return (await seasonAccess(seasonId)).allowed
}

/**
 * The title a private Season is allowed to reveal: none.
 *
 * `generateMetadata` runs even when the page itself calls notFound(), so a page that guards its body
 * and not its metadata still puts the real title in the browser tab and in the document head of the
 * not-found response. That is the private name of a private thing, leaked through the one part of
 * the page nobody thinks to check.
 */
export const HIDDEN_SEASON_METADATA = { title: 'Season' } as const
