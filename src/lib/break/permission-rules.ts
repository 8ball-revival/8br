/**
 * The permission RULES, as pure functions.
 *
 * Deliberately separate from the resolver in `permissions.ts`. That module has to reach Payload and
 * the database to work out who is asking; these predicates only decide what a given actor may do.
 * Splitting them means the rules can be tested directly — every combination of member, staff, owner,
 * locked, removed and draft — without standing up an authentication stack to ask each question.
 *
 * Nothing here imports anything. That is the point.
 */

export interface BreakActorShape {
  playerId: string
  name: string
  handle: string | null
  isAdmin: boolean
  isOwner: boolean
  /** Label only. Never a gate — The Break lets any member in good standing post. */
  isTrustedAuthor: boolean
}

/** Any signed-in member in good standing. Being an actor at all is the check. */
export const canPost = (a: BreakActorShape | null): boolean => a != null
export const canComment = (a: BreakActorShape | null): boolean => a != null
export const canVote = (a: BreakActorShape | null): boolean => a != null
export const canSave = (a: BreakActorShape | null): boolean => a != null
export const canHide = (a: BreakActorShape | null): boolean => a != null
export const canReport = (a: BreakActorShape | null): boolean => a != null
export const canUploadMedia = (a: BreakActorShape | null): boolean => a != null

export const canModerate = (a: BreakActorShape | null): boolean => !!a?.isAdmin
export const canPin = canModerate
export const canDistinguish = canModerate
export const canLock = canModerate
export const canRemove = canModerate
export const canConfigureCategories = canModerate
export const canSeeAllInsights = canModerate

/** Only staff may file under a category marked admin-only, such as Announcement. */
export const canUseAdminCategory = (a: BreakActorShape | null): boolean => !!a?.isAdmin

/** Only staff may publish something that speaks for the site. */
export const canMarkOfficial = (a: BreakActorShape | null): boolean => !!a?.isAdmin

/**
 * Ownership, for editing and soft-deleting.
 *
 * A moderator removing content is a different act with a different record — removal is public and
 * attributed, editing is not. So this is ownership alone, and the moderator powers above are
 * separate predicates producing separate audit entries.
 */
export function ownsContent(a: BreakActorShape | null, authorPlayerId: string | null): boolean {
  return a != null && authorPlayerId != null && a.playerId === authorPlayerId
}

export const canEditOwn = ownsContent
export const canDeleteOwn = ownsContent

/**
 * A draft is visible to its author and to nobody else — staff included.
 *
 * Consulted by the loaders rather than only by the pages, so guessing an id does not reveal one.
 */
export function canViewDraft(a: BreakActorShape | null, authorPlayerId: string | null): boolean {
  return ownsContent(a, authorPlayerId)
}

/**
 * Whether a removed post's body may be read.
 *
 * Everyone sees that something was removed and why. The body goes back only to its author and to
 * staff, so a removal is not a way to hide a discussion from the person who wrote it.
 */
export function canViewRemovedBody(a: BreakActorShape | null, authorPlayerId: string | null): boolean {
  return canModerate(a) || ownsContent(a, authorPlayerId)
}

/** Locked means no NEW comments from non-staff. Reading and voting continue. */
export function canReplyTo(
  a: BreakActorShape | null,
  opts: { postLocked: boolean; branchLocked: boolean; commentsEnabled: boolean },
): boolean {
  if (!canComment(a)) return false
  // Locking a thread must not stop a moderator explaining why it was locked.
  if (canModerate(a)) return true
  if (!opts.commentsEnabled) return false
  return !opts.postLocked && !opts.branchLocked
}
