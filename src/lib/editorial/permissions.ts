import 'server-only'
import { cache } from 'react'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/account/auth'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { resolveMemberStatus } from '@/lib/moderation/service'

/**
 * Who may do what in The Break.
 *
 * Every answer here is derived on the server from the database. Nothing is inferred from a hidden
 * button, a form field, or an id the client sent: the caller says what it wants to do, and this
 * module decides using the account actually attached to the request.
 *
 * Four kinds of actor:
 *
 *  - Administrator  — owner/admin. May do anything, including marking content official.
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
  isTrustedAuthor: boolean
}

/**
 * Follow an approved account merge to the surviving profile.
 *
 * A merged-away secondary must never become the author of anything, or the byline would point at a
 * profile the site no longer shows. The chain is walked (not just one hop) because merges can be
 * applied one after another, and bounded so a cycle introduced by bad data cannot hang a request.
 */
async function canonicalPlayerId(startId: string): Promise<string> {
  let id = startId
  for (let hop = 0; hop < 8; hop += 1) {
    const merge = await prisma.playerMerge.findFirst({
      where: { mergedPlayerId: id, status: 'APPROVED' },
      select: { canonicalPlayerId: true },
    })
    if (!merge || merge.canonicalPlayerId === id) return id
    id = merge.canonicalPlayerId
  }
  return id
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

  // A management-only profile exists to run the site, not to compete. It may still act as an
  // administrator — that is the whole point of it — but it is not a member author.
  if (linked.managementOnly && !isAdmin) return null

  const playerId = await canonicalPlayerId(linked.id)
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { id: true, primaryName: true, cueverseId: true, active: true, blogTrustedAuthor: true },
  })
  if (!player || !player.active) return null

  return {
    playerId: player.id,
    name: player.primaryName,
    handle: player.cueverseId,
    isAdmin,
    // An administrator can always publish; the flag is what matters for everyone else.
    isTrustedAuthor: isAdmin || player.blogTrustedAuthor,
  }
})

/** Anyone signed in with a usable account may start a draft. */
export const canCreateArticle = (a: EditorialActor | null): boolean => a != null

/** Only the author may edit their own work; administrators may edit anything. */
export function canEditArticle(a: EditorialActor | null, authorPlayerId: string | null): boolean {
  if (!a) return false
  if (a.isAdmin) return true
  return authorPlayerId != null && authorPlayerId === a.playerId
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
  if (authorPlayerId == null || authorPlayerId !== a.playerId) return false
  const fresh = await prisma.player.findUnique({
    where: { id: a.playerId },
    select: { blogTrustedAuthor: true, active: true },
  })
  return !!fresh?.blogTrustedAuthor && fresh.active
}

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
