import 'server-only'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { cleanText } from './richtext'
import { EditorialError, isPubliclyVisible } from './service'
import type { EditorialActor } from './permissions'

/**
 * Comments on articles.
 *
 * Plain text, one level of replies, and no markup at all — not even the Markdown subset the article
 * body allows. A comment box is the most-attacked input on any site, and the useful things people
 * write in one do not need formatting. Links are detected at render time from the stored text rather
 * than being authored, so a comment cannot contain a link whose visible text disagrees with its
 * destination.
 *
 * "One level of replies" means a reply cannot itself be replied to. Deeper nesting turns into an
 * unreadable staircase on a phone, and every thread that needs it is really a conversation that
 * belongs in the article's own thread.
 */

export { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH, linkifyComment } from './comment-format'
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from './comment-format'

/** How long an author may still edit their own comment. */
export const EDIT_WINDOW_MS = 15 * 60 * 1000

/** Rate limits, counted against the database rather than memory so they survive a restart. */
export const RATE_LIMITS = {
  perMinute: 3,
  perHour: 20,
  /** A duplicate of the author's own last comment on the same article. */
  duplicateWindowMs: 10 * 60 * 1000,
}

export interface CommentView {
  id: number
  body: string
  createdAt: Date
  editedAt: Date | null
  deleted: boolean
  hidden: boolean
  author: { playerId: string | null; name: string; handle: string | null; isAdmin: boolean }
  /** Whether the viewer may edit or delete this comment. */
  canEdit: boolean
  canDelete: boolean
  canReport: boolean
  replies: CommentView[]
}

// --------------------------------------------------------------------------- reading

/**
 * The thread for one article.
 *
 * A removed comment is not deleted from the tree — the row stays, tombstoned, so replies underneath
 * it keep their context and the conversation does not appear to have people answering nothing. What
 * changes is that the text is not sent to the client at all, rather than being sent and hidden.
 */
export async function getCommentThread(
  articleId: number,
  viewer: EditorialActor | null,
): Promise<CommentView[]> {
  const rows = await prisma.articleComment.findMany({
    where: { articleId },
    orderBy: [{ createdAt: 'asc' }],
    select: {
      id: true, parentId: true, body: true, createdAt: true, editedAt: true,
      deletedAt: true, hiddenAt: true, authorPlayerId: true, authorNameSnapshot: true,
      authorPlayer: { select: { primaryName: true, cueverseId: true, linkedUserId: true } },
    },
  })

  const now = Date.now()
  const adminIds = await staffPlayerIds(rows.map((r) => r.authorPlayer?.linkedUserId).filter((x): x is string => !!x))

  const toView = (r: (typeof rows)[number]): CommentView => {
    const removed = r.deletedAt != null || r.hiddenAt != null
    const mine = viewer != null && r.authorPlayerId != null && r.authorPlayerId === viewer.playerId
    return {
      id: r.id,
      // Never ship the text of a removed comment, even to be hidden with CSS.
      body: removed ? '' : r.body,
      createdAt: r.createdAt,
      editedAt: r.editedAt,
      deleted: r.deletedAt != null,
      hidden: r.hiddenAt != null,
      author: {
        playerId: r.authorPlayerId,
        name: r.authorPlayer?.primaryName ?? r.authorNameSnapshot,
        handle: r.authorPlayer?.cueverseId ?? null,
        isAdmin: r.authorPlayer?.linkedUserId ? adminIds.has(r.authorPlayer.linkedUserId) : false,
      },
      canEdit: !removed && mine && now - r.createdAt.getTime() < EDIT_WINDOW_MS,
      canDelete: !removed && (mine || !!viewer?.isAdmin),
      canReport: !removed && viewer != null && !mine,
      replies: [],
    }
  }

  const views = new Map<number, CommentView>()
  const roots: CommentView[] = []
  for (const r of rows) views.set(r.id, toView(r))
  for (const r of rows) {
    const view = views.get(r.id)!
    const parent = r.parentId != null ? views.get(r.parentId) : null
    if (parent) parent.replies.push(view)
    else roots.push(view)
  }

  // A removed comment with no replies has nothing to anchor, so it leaves the thread entirely rather
  // than littering it with tombstones nobody needs.
  const prune = (list: CommentView[]): CommentView[] =>
    list.filter((c) => !((c.deleted || c.hidden) && c.replies.length === 0))
  for (const root of roots) root.replies = prune(root.replies)
  return prune(roots)
}

/** Which of these Payload user ids belong to staff — used to badge official replies in a thread. */
async function staffPlayerIds(linkedUserIds: string[]): Promise<Set<string>> {
  if (!linkedUserIds.length) return new Set()
  const { getPayload } = await import('payload')
  const config = (await import('@payload-config')).default
  try {
    const p = await getPayload({ config: await config })
    const res = await p.find({
      collection: 'users',
      where: { id: { in: linkedUserIds } },
      limit: 200, depth: 0, overrideAccess: true,
    })
    const { isAdmin } = await import('@/lib/auth/roles')
    return new Set(
      (res.docs as { id: string | number; roles?: string[] }[])
        .filter((u) => isAdmin(u.roles))
        .map((u) => String(u.id)),
    )
  } catch {
    // A badge is decoration; failing to resolve it must never take the thread down with it.
    return new Set()
  }
}

// --------------------------------------------------------------------------- rate limiting

/**
 * How many comments this account has posted recently.
 *
 * Counted in the database rather than a memory cache: a rate limit that resets when the process
 * restarts is not a rate limit, and this site runs more than one instance in production.
 */
async function assertWithinRateLimit(actor: EditorialActor, articleId: number, body: string): Promise<void> {
  const now = Date.now()
  const [lastMinute, lastHour, duplicate] = await Promise.all([
    prisma.articleComment.count({
      where: { authorPlayerId: actor.playerId, createdAt: { gte: new Date(now - 60_000) } },
    }),
    prisma.articleComment.count({
      where: { authorPlayerId: actor.playerId, createdAt: { gte: new Date(now - 3_600_000) } },
    }),
    prisma.articleComment.findFirst({
      where: {
        authorPlayerId: actor.playerId,
        articleId,
        body,
        createdAt: { gte: new Date(now - RATE_LIMITS.duplicateWindowMs) },
      },
      select: { id: true },
    }),
  ])

  if (lastMinute >= RATE_LIMITS.perMinute) throw new EditorialError('You are commenting very quickly. Wait a moment and try again.')
  if (lastHour >= RATE_LIMITS.perHour) throw new EditorialError('You have posted a lot of comments in the last hour. Try again later.')
  if (duplicate) throw new EditorialError('You have already posted that comment.')
}

/** Clean and check a comment body. */
function normaliseBody(input: string): string {
  const body = cleanText(input)
    .replace(/[ \t]+/g, ' ')
    // Collapse runs of blank lines; three paragraph breaks in a row is somebody shouting.
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_COMMENT_LENGTH)
  if (body.length < MIN_COMMENT_LENGTH) throw new EditorialError('Write something first.')
  return body
}

// --------------------------------------------------------------------------- writing

/** Post a comment, or a reply to one. */
export async function addComment(
  actor: EditorialActor,
  articleId: number,
  bodyInput: string,
  parentId?: number | null,
): Promise<number> {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { id: true, state: true, publishAt: true, commentsEnabled: true, commentsLocked: true },
  })
  if (!article) throw new EditorialError('That article no longer exists.')
  // Commenting on something the public cannot see would let a thread exist before the article does.
  if (!isPubliclyVisible(article)) throw new EditorialError('That article is not open for comments.')
  if (!article.commentsEnabled) throw new EditorialError('Comments are turned off for this article.')
  if (article.commentsLocked) throw new EditorialError('This discussion has been closed.')

  const body = normaliseBody(bodyInput)
  await assertWithinRateLimit(actor, articleId, body)

  let parent: number | null = null
  if (parentId != null) {
    const p = await prisma.articleComment.findUnique({
      where: { id: Number(parentId) },
      select: { id: true, articleId: true, parentId: true, deletedAt: true, hiddenAt: true },
    })
    if (!p || p.articleId !== articleId) throw new EditorialError('That comment is not on this article.')
    if (p.deletedAt || p.hiddenAt) throw new EditorialError('That comment has been removed.')
    // One level only: replying to a reply attaches to the same top-level comment instead of nesting
    // deeper, which is what the person meant anyway.
    parent = p.parentId ?? p.id
  }

  return prisma.$transaction(async (db) => {
    const comment = await db.articleComment.create({
      data: {
        articleId,
        parentId: parent,
        authorPlayerId: actor.playerId,
        authorNameSnapshot: actor.handle ?? actor.name,
        body,
      },
      select: { id: true },
    })
    await db.article.update({ where: { id: articleId }, data: { commentCount: { increment: 1 } } })
    return comment.id
  })
}

/** Edit your own comment, within the edit window. */
export async function editComment(actor: EditorialActor, commentId: number, bodyInput: string): Promise<void> {
  const comment = await prisma.articleComment.findUnique({
    where: { id: commentId },
    select: { authorPlayerId: true, createdAt: true, deletedAt: true, hiddenAt: true },
  })
  if (!comment) throw new EditorialError('That comment no longer exists.')
  if (comment.deletedAt || comment.hiddenAt) throw new EditorialError('That comment has been removed.')
  if (comment.authorPlayerId !== actor.playerId) throw new EditorialError('You can only edit your own comments.')
  if (Date.now() - comment.createdAt.getTime() > EDIT_WINDOW_MS) {
    throw new EditorialError('The time to edit that comment has passed.')
  }

  await prisma.articleComment.update({
    where: { id: commentId },
    data: { body: normaliseBody(bodyInput), editedAt: new Date() },
  })
}

/**
 * Withdraw your own comment.
 *
 * The row survives as a tombstone so replies underneath it keep their place; the text is cleared, so
 * "deleted" means the words are gone rather than merely hidden behind a flag.
 */
export async function deleteOwnComment(actor: EditorialActor, commentId: number): Promise<void> {
  const comment = await prisma.articleComment.findUnique({
    where: { id: commentId },
    select: { authorPlayerId: true, articleId: true, deletedAt: true },
  })
  if (!comment) throw new EditorialError('That comment no longer exists.')
  if (comment.authorPlayerId !== actor.playerId && !actor.isAdmin) {
    throw new EditorialError('You can only delete your own comments.')
  }
  if (comment.deletedAt) return

  await prisma.$transaction(async (db) => {
    await db.articleComment.update({
      where: { id: commentId },
      data: { deletedAt: new Date(), body: '' },
    })
    await db.article.update({
      where: { id: comment.articleId },
      data: { commentCount: { decrement: 1 } },
    })
  })
}

// --------------------------------------------------------------------------- moderation

/** Hide a comment as a moderator. Distinct from the author deleting it, and recorded separately. */
export async function hideComment(actor: EditorialActor, commentId: number, reason?: string): Promise<void> {
  if (!actor.isAdmin) throw new EditorialError('Only an administrator can remove a comment.')
  const comment = await prisma.articleComment.findUnique({
    where: { id: commentId },
    select: { articleId: true, hiddenAt: true, body: true },
  })
  if (!comment) throw new EditorialError('That comment no longer exists.')
  if (comment.hiddenAt) return

  await prisma.$transaction(async (db) => {
    await db.articleComment.update({
      where: { id: commentId },
      data: { hiddenAt: new Date(), hiddenByPlayerId: actor.playerId },
    })
    await db.article.update({ where: { id: comment.articleId }, data: { commentCount: { decrement: 1 } } })
    await db.editorialModerationRecord.create({
      data: {
        action: 'comment.hidden',
        commentId,
        articleId: comment.articleId,
        actorPlayerId: actor.playerId,
        actorName: actor.handle ?? actor.name,
        // The original text is kept here and nowhere else, so the removal can be undone.
        detail: { reason: reason ? cleanText(reason).slice(0, 500) : null, body: comment.body },
      },
    })
  })
}

/** Put a hidden comment back, restoring the text from the moderation record. */
export async function unhideComment(actor: EditorialActor, commentId: number): Promise<void> {
  if (!actor.isAdmin) throw new EditorialError('Only an administrator can restore a comment.')
  const comment = await prisma.articleComment.findUnique({
    where: { id: commentId },
    select: { articleId: true, hiddenAt: true, body: true },
  })
  if (!comment) throw new EditorialError('That comment no longer exists.')
  if (!comment.hiddenAt) return

  const record = await prisma.editorialModerationRecord.findFirst({
    where: { commentId, action: 'comment.hidden' },
    orderBy: { createdAt: 'desc' },
    select: { detail: true },
  })
  const saved = (record?.detail as { body?: string } | null)?.body

  await prisma.$transaction(async (db) => {
    await db.articleComment.update({
      where: { id: commentId },
      data: {
        hiddenAt: null,
        hiddenByPlayerId: null,
        ...(comment.body === '' && saved ? { body: saved } : {}),
      },
    })
    await db.article.update({ where: { id: comment.articleId }, data: { commentCount: { increment: 1 } } })
    await db.editorialModerationRecord.create({
      data: {
        action: 'comment.restored',
        commentId,
        articleId: comment.articleId,
        actorPlayerId: actor.playerId,
        actorName: actor.handle ?? actor.name,
      },
    })
  })
}

/**
 * Report a comment.
 *
 * One open report per person per comment — the unique constraint does the work, so a second report
 * from the same account is a no-op rather than a way to inflate a queue.
 */
export async function reportComment(actor: EditorialActor, commentId: number, reason: string): Promise<void> {
  const text = cleanText(reason).trim().slice(0, 500)
  if (!text) throw new EditorialError('Say what is wrong with it.')

  const comment = await prisma.articleComment.findUnique({
    where: { id: commentId },
    select: { id: true, authorPlayerId: true, deletedAt: true, hiddenAt: true },
  })
  if (!comment) throw new EditorialError('That comment no longer exists.')
  if (comment.deletedAt || comment.hiddenAt) throw new EditorialError('That comment has already been removed.')
  if (comment.authorPlayerId === actor.playerId) throw new EditorialError('You cannot report your own comment.')

  await prisma.commentReport.upsert({
    where: { commentId_reporterPlayerId: { commentId, reporterPlayerId: actor.playerId } },
    create: { commentId, reporterPlayerId: actor.playerId, reason: text },
    update: { reason: text },
  })
}

/** Close a report, with or without acting on the comment. */
export async function resolveReport(
  actor: EditorialActor,
  reportId: number,
  resolution: string,
): Promise<void> {
  if (!actor.isAdmin) throw new EditorialError('Only an administrator can resolve a report.')
  await prisma.commentReport.update({
    where: { id: reportId },
    data: {
      resolvedAt: new Date(),
      resolvedByPlayerId: actor.playerId,
      resolution: cleanText(resolution).slice(0, 500) || 'Reviewed',
    },
  })
}

// --------------------------------------------------------------------------- rendering helpers

/** Recount an article's comments from the rows themselves. Used after a merge or a bulk change. */
export async function recountComments(articleId: number, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<number> {
  const count = await db.articleComment.count({
    where: { articleId, deletedAt: null, hiddenAt: null },
  })
  await db.article.update({ where: { id: articleId }, data: { commentCount: count } })
  return count
}
