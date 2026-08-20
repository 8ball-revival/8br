import 'server-only'
import { cache } from 'react'

import { currentEditorialActor, type EditorialActor } from '@/lib/editorial/permissions'

/**
 * Who may do what in The Break.
 *
 * ── Built on the existing resolver, not beside it ────────────────────────────────────────────────
 * `currentEditorialActor` already does the hard parts and does them once: it resolves the canonical
 * Player through the merge service, rejects banned, timed-out, soft-deleted, inactive and
 * management-only accounts, and reads staff roles from the site's own role system. Duplicating that
 * here would mean two places to be wrong about who is suspended, and they would drift.
 *
 * So The Break's actor IS that actor, with one difference in what it means.
 *
 * ── The one difference ───────────────────────────────────────────────────────────────────────────
 * Trusted Author no longer decides whether somebody may post. Under the editorial system it gated
 * publishing, because articles were a small number of long pieces. The Break is a community feed:
 * any signed-in member in good standing posts, and the flag survives only as a label for official
 * contributors and for the migration. `isTrustedAuthor` is carried through for that labelling and is
 * never consulted for permission.
 */
export interface BreakActor {
  playerId: string
  /** Preferred Name — shown in site gold. */
  name: string
  /** CueVerse ID — shown in white. */
  handle: string | null
  isAdmin: boolean
  isOwner: boolean
  /** Label only. Never a gate — see above. */
  isTrustedAuthor: boolean
}

/** Moderator powers and administrator powers are the same set here; the site has one staff tier. */
export type BreakModerator = BreakActor & { isAdmin: true }

export const currentBreakActor = cache(async function currentBreakActor(): Promise<BreakActor | null> {
  const actor: EditorialActor | null = await currentEditorialActor()
  if (!actor) return null
  return {
    playerId: actor.playerId,
    name: actor.name,
    handle: actor.handle,
    isAdmin: actor.isAdmin,
    isOwner: actor.isOwner,
    isTrustedAuthor: actor.isTrustedAuthor,
  }
})

// ─────────────────────────────────────────────────────────────────────── what a member may do
//
// Each of these is a single expression on purpose. A permission that needs a paragraph of logic is a
// permission somebody will eventually implement slightly differently at a second call site.

/** Any signed-in member in good standing. Being an actor at all is the check. */
export const canPost = (a: BreakActor | null): boolean => a != null
export const canComment = (a: BreakActor | null): boolean => a != null
export const canVote = (a: BreakActor | null): boolean => a != null
export const canSave = (a: BreakActor | null): boolean => a != null
export const canHide = (a: BreakActor | null): boolean => a != null
export const canReport = (a: BreakActor | null): boolean => a != null
export const canUploadMedia = (a: BreakActor | null): boolean => a != null

export const canModerate = (a: BreakActor | null): boolean => !!a?.isAdmin
export const canPin = canModerate
export const canDistinguish = canModerate
export const canLock = canModerate
export const canRemove = canModerate
export const canConfigureCategories = canModerate
export const canSeeAllInsights = canModerate

/** Only staff may file under a category marked admin-only, such as Announcement. */
export const canUseAdminCategory = (a: BreakActor | null): boolean => !!a?.isAdmin

/** Only staff may publish something that speaks for the site. */
export const canMarkOfficial = (a: BreakActor | null): boolean => !!a?.isAdmin

/**
 * Ownership, for editing and soft-deleting.
 *
 * A moderator can remove content, which is a different act with a different record — removal is
 * public and attributed, editing is not. So this is ownership alone; moderator powers are separate
 * predicates and produce separate audit entries.
 */
export function ownsContent(a: BreakActor | null, authorPlayerId: string | null): boolean {
  return a != null && authorPlayerId != null && a.playerId === authorPlayerId
}

export const canEditOwn = ownsContent
export const canDeleteOwn = ownsContent

/**
 * Whether this actor may see something that is not publicly visible.
 *
 * Drafts are the case that matters: a draft is visible to its author and to nobody else, staff
 * included. Guessing an id must not reveal one, so this is consulted by the loaders rather than only
 * by the pages.
 */
export function canViewDraft(a: BreakActor | null, authorPlayerId: string | null): boolean {
  return ownsContent(a, authorPlayerId)
}

/**
 * Whether a removed post's body may be read.
 *
 * Everyone sees that something was removed and why — that is the public removal reason. The body
 * itself goes back only to its author and to staff, so a removal is not a way to hide a discussion
 * from the person who wrote it.
 */
export function canViewRemovedBody(a: BreakActor | null, authorPlayerId: string | null): boolean {
  return canModerate(a) || ownsContent(a, authorPlayerId)
}

/** Locked means no NEW comments from non-staff. Reading and voting continue. */
export function canReplyTo(a: BreakActor | null, opts: { postLocked: boolean; branchLocked: boolean; commentsEnabled: boolean }): boolean {
  if (!canComment(a)) return false
  if (canModerate(a)) return true
  if (!opts.commentsEnabled) return false
  return !opts.postLocked && !opts.branchLocked
}

export async function requireBreakActor(): Promise<BreakActor> {
  const a = await currentBreakActor()
  if (!a) throw new Error('You need to be signed in to do that.')
  return a
}

export async function requireBreakModerator(): Promise<BreakActor> {
  const a = await currentBreakActor()
  if (!a?.isAdmin) throw new Error('That action is for moderators.')
  return a
}
