import 'server-only'
import { cache } from 'react'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/account/auth'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { resolveMemberStatus } from '@/lib/moderation/service'
import { resolveCanonicalPlayerId, expandCanonicalPlayerIds } from '@/lib/players/merge'

/**
 * Who may do what in The Break.
 *
 * Every answer here is derived on the server from the database. Nothing is inferred from a hidden
 * button, a form field, or an id the client sent: the caller says what it wants to do, and this
 * module decides using the account actually attached to the request.
 *
 * Four kinds of actor:
 *
 *  - Owner          — everything an administrator can do, plus attributing an article to somebody
 *                     else. That last one is the ability to publish words under another member's
 *                     name, which is why it sits above Administrator rather than beside it.
 *  - Administrator  — admin. May do anything else, including marking content official.
 *  - Trusted Author — publishes their OWN work without review. Never official, never pinned.
 *  - Member         — drafts and submissions only. Their edits to published work go back to review.
 *  - Visitor        — reads published content and nothing else.
 */

export interface EditorialActor {
  /** Canonical Player id — how authorship is recorded, so it survives an account merge. */
  playerId: string
  /** Preferred name, frozen onto anything they write. */
  name: string
  /** CueVerse ID: the site-wide default display identity. */
  handle: string | null
  isAdmin: boolean
  /** Owner only. Separate from isAdmin because attribution is an Owner-only power. */
  isOwner: boolean
  isTrustedAuthor: boolean
  /**
   * The Break: posting removed for abuse. Resolved here because this is where the canonical Player
   * is already being read, and reading it in a second place is how two answers to one question
   * appear.
   */
  breakPostingBlocked: boolean
  /** Shown to the member on the compose page, so a removed permission is never unexplained. */
  breakPostingBlockedReason: string | null
}

/**
 * The signed-in editorial actor, or null.
 *
 * An account that is inactive, management-only, banned, timed out or soft-deleted is deliberately
 * NOT an actor: it can neither write nor comment. That check lives here rather than at each call
 * site so there is exactly one place to be wrong.
 *
 * Wrapped in React `cache()` so a page that asks several times in one request pays once.
 */
export const currentEditorialActor = cache(async function currentEditorialActor(): Promise<EditorialActor | null> {
  const user = await getCurrentUser()
  if (!user) return null

  // A banned or soft-deleted account loses editorial access immediately, even on a still-valid
  // session. A timed-out account keeps reading but stops writing — writing is participation, and
  // that is precisely what a timeout withdraws.
  const status = await resolveMemberStatus(Number(user.id))
  if (!status.canLogin || status.status === 'TIMED_OUT') return null

  const linked = await prisma.player.findUnique({
    where: { linkedUserId: String(user.id) },
    select: { id: true, active: true, managementOnly: true },
  })
  if (!linked) return null
  if (!linked.active) return null

  const staff = await resolveStaffAccess()
  const isAdmin = staff.status === 'ok' && staff.actor.can('manage_competitions')
  const isOwner = staff.status === 'ok' && staff.actor.isOwner

  // A management-only profile exists to run the site, not to compete. It may still act as an
  // administrator — that is the whole point of it — but it is not a member author.
  if (linked.managementOnly && !isAdmin) return null

  // A merged-away secondary must never become the author of anything, or the byline would point at
  // a profile the site no longer shows. This is the site's own merge resolver, not a second copy of
  // the same walk.
  const playerId = await resolveCanonicalPlayerId(linked.id)
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: {
      id: true, primaryName: true, cueverseId: true, active: true, blogTrustedAuthor: true,
      breakPostingBlocked: true, breakPostingBlockedReason: true,
    },
  })
  if (!player || !player.active) return null

  return {
    playerId: player.id,
    name: player.primaryName,
    handle: player.cueverseId,
    isAdmin,
    isOwner,
    // An administrator can always publish; the flag is what matters for everyone else.
    isTrustedAuthor: isAdmin || player.blogTrustedAuthor,
    /*
     * Staff are exempt, and deliberately so: the people who lift a block must not be able to lock
     * themselves out of the tool they lift it with.
     *
     * Nothing else about it is special-cased. It is read fresh here on every request rather than
     * carried in a session, so removing somebody's posting takes effect on their next action instead
     * of whenever their session happens to expire.
     */
    breakPostingBlocked: !isAdmin && player.breakPostingBlocked,
    breakPostingBlockedReason: player.breakPostingBlockedReason,
  }
})

/** Anyone signed in with a usable account may start a draft. */
export const canCreateArticle = (a: EditorialActor | null): boolean => a != null

/**
 * Only the author may edit their own work; administrators may edit anything.
 *
 * Synchronous, so it can be used while rendering. It compares against the actor's canonical id,
 * which is correct for anything written since a merge; for older work written under a secondary
 * profile, `authoredPlayerIds` widens the comparison — see `canEditArticleAsync`.
 */
export function canEditArticle(a: EditorialActor | null, authorPlayerId: string | null): boolean {
  if (!a) return false
  if (a.isAdmin) return true
  return authorPlayerId != null && authorPlayerId === a.playerId
}

/**
 * Every player id whose editorial history belongs to this actor — their canonical profile plus any
 * profile merged into it.
 *
 * Merges do not repoint rows (that is what makes undo possible), so an article written before a
 * merge still carries the secondary's id. Reads expand through this so a member's back catalogue
 * stays under one byline instead of splitting at the merge.
 */
export async function authoredPlayerIds(a: EditorialActor): Promise<string[]> {
  return expandCanonicalPlayerIds(a.playerId)
}

/** The merge-aware form of `canEditArticle`, for a server action that is about to write. */
export async function canEditArticleAsync(
  a: EditorialActor | null,
  authorPlayerId: string | null,
): Promise<boolean> {
  if (!a) return false
  if (a.isAdmin) return true
  if (authorPlayerId == null) return false
  if (authorPlayerId === a.playerId) return true
  return (await authoredPlayerIds(a)).includes(authorPlayerId)
}

/**
 * May this actor publish this article outright, right now?
 *
 * Deliberately re-read from the database instead of trusting the resolved actor: revoking Trusted
 * Author has to take effect immediately, including for somebody who loaded the editor a minute ago
 * and is about to press Publish.
 */
export async function canPublishNow(
  a: EditorialActor | null,
  authorPlayerId: string | null,
): Promise<boolean> {
  if (!a) return false
  if (a.isAdmin) return true
  if (authorPlayerId == null) return false
  // Their own work includes anything written under a profile since merged into theirs.
  if (authorPlayerId !== a.playerId && !(await authoredPlayerIds(a)).includes(authorPlayerId)) return false
  const fresh = await prisma.player.findUnique({
    where: { id: a.playerId },
    select: { blogTrustedAuthor: true, active: true },
  })
  return !!fresh?.blogTrustedAuthor && fresh.active
}

/**
 * May this actor publish an article under somebody else's name?
 *
 * Owner only, and deliberately not granted to administrators. Attribution means putting words in a
 * member's mouth: the byline, the author page and the feed all say they wrote it, and nothing on the
 * public page distinguishes it from something they typed themselves. That is a reasonable thing for
 * the person who runs the site to do when relaying a post from Discord, and it is not a power to
 * hand out more widely. Who actually created the article is recorded either way.
 */
export const canAttributeAuthor = (a: EditorialActor | null): boolean => !!a?.isOwner

/**
 * May this actor set a publication date in the past?
 *
 * Owner only, for the same reason attribution is. Forward scheduling is available to anybody who can
 * publish — choosing when your own work goes out is unremarkable. Backdating is different: it makes
 * the site assert that something was said before it was, which would let a prediction be written
 * after the result and filed before it. That is a thing the person running the site may legitimately
 * need when importing years-old writing, and not a thing to hand out more widely.
 */
export const canBackdate = (a: EditorialActor | null): boolean => !!a?.isOwner

/** Only administrators mark content as speaking for 8 Ball Registry. */
export const canMarkOfficial = (a: EditorialActor | null): boolean => !!a?.isAdmin
/** Featuring and pinning are site-wide editorial decisions. */
export const canFeature = (a: EditorialActor | null): boolean => !!a?.isAdmin
/** Approving, rejecting, hiding, restoring. */
export const canModerate = (a: EditorialActor | null): boolean => !!a?.isAdmin
/** Standalone pages are administrator-only, end to end. */
export const canManagePages = (a: EditorialActor | null): boolean => !!a?.isAdmin
/** Exporting editorial content is administrator-only. */
export const canExport = (a: EditorialActor | null): boolean => !!a?.isAdmin
/** Any usable account may comment on an article that allows it. */
export const canComment = (a: EditorialActor | null): boolean => a != null

/** May this actor see an article that is not publicly visible? */
export function canViewUnpublished(a: EditorialActor | null, authorPlayerId: string | null): boolean {
  if (!a) return false
  return a.isAdmin || (authorPlayerId != null && authorPlayerId === a.playerId)
}

/** Throw-style guards for server actions, which must never rely on hidden UI. */
export async function requireEditorialActor(): Promise<EditorialActor> {
  const actor = await currentEditorialActor()
  if (!actor) throw new Error('Forbidden: sign in with an active account to do that.')
  return actor
}

export async function requireEditorialAdmin(): Promise<EditorialActor> {
  const actor = await requireEditorialActor()
  if (!actor.isAdmin) throw new Error('Forbidden: this action requires an administrator.')
  return actor
}
