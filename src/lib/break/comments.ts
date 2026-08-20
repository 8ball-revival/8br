import 'server-only'
import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { sanitizeDocument, documentToPlainText, isEmptyDocument } from '@/lib/editorial/richtext'
import { hotRank, wilsonLowerBound, controversyRank, type CommentSort } from './ranking'
import type { BreakActor } from './permissions'

/**
 * Threaded comments.
 *
 * ── One query for a whole thread ─────────────────────────────────────────────────────────────────
 * Each comment stores a materialised `path`: the dot-joined, zero-padded ids of its ancestors and
 * itself. Sorting by that string IS the display order, so a post's entire tree comes back in one
 * indexed range scan and is assembled in memory. The obvious alternative — follow parent pointers —
 * costs a query per level and turns a busy thread into the slowest page on the site.
 *
 * Padding to ten digits is what makes the string sort agree with the numeric one: without it "10"
 * sorts before "9" and replies appear in the wrong order once a post passes ten comments.
 *
 * ── Depth ────────────────────────────────────────────────────────────────────────────────────────
 * Nesting is displayed to a fixed depth. Past it the column is too narrow to read, so the branch
 * stops and offers "Continue this thread" — a link to a page rooted at that comment, where the depth
 * budget starts again. The data is not truncated; only the view is.
 */

export const MAX_DEPTH = 8
export const VISIBLE_DEPTH = 5
export const MAX_COMMENT_CHARS = 10_000
const PAD = 10

export interface CommentResult {
  ok: boolean
  error?: string
  commentId?: number
}

const pathSegment = (id: number) => String(id).padStart(PAD, '0')

export interface AddCommentInput {
  postId: number
  parentId?: number | null
  body: unknown
  spoiler?: boolean
}

/**
 * Add a comment or a reply.
 *
 * The lock check is done here rather than only in the UI: hiding a reply box stops the button, not a
 * request. Staff are exempt, because locking a thread must not prevent a moderator explaining why.
 */
export async function addComment(actor: BreakActor, input: AddCommentInput): Promise<CommentResult> {
  const post = await prisma.breakPost.findUnique({
    where: { id: input.postId },
    select: { id: true, state: true, locked: true, commentsEnabled: true, deletedAt: true, authorPlayerId: true, muteReplies: true },
  })
  if (!post) return { ok: false, error: 'That post no longer exists.' }
  if (post.state === 'DRAFT') return { ok: false, error: 'That post is not published.' }
  if (!actor.isAdmin) {
    if (post.deletedAt) return { ok: false, error: 'That post was deleted.' }
    if (post.locked) return { ok: false, error: 'This post is locked. Existing replies stay readable.' }
    if (!post.commentsEnabled) return { ok: false, error: 'Comments are closed on this post.' }
  }

  const body = sanitizeDocument(input.body)
  if (isEmptyDocument(body)) return { ok: false, error: 'Say something first.' }
  const text = documentToPlainText(body).slice(0, MAX_COMMENT_CHARS)

  let parent: { id: number; path: string; depth: number; locked: boolean; postId: number; authorPlayerId: string | null; muteReplies: boolean } | null = null
  if (input.parentId) {
    parent = await prisma.breakComment.findUnique({
      where: { id: input.parentId },
      select: { id: true, path: true, depth: true, locked: true, postId: true, authorPlayerId: true, muteReplies: true },
    })
    if (!parent) return { ok: false, error: 'That comment no longer exists.' }
    // A reply must belong to the post it claims to. Otherwise a crafted request grafts a branch from
    // one discussion onto another.
    if (parent.postId !== input.postId) return { ok: false, error: 'That reply does not belong to this post.' }
    if (parent.locked && !actor.isAdmin) return { ok: false, error: 'This branch is locked.' }
    if (parent.depth + 1 > MAX_DEPTH) return { ok: false, error: 'This thread is as deep as it goes. Reply higher up.' }
  }

  const created = await prisma.$transaction(async (tx) => {
    const c = await tx.breakComment.create({
      data: {
        postId: input.postId,
        parentId: parent?.id ?? null,
        // The id is not known until the row exists, so the path is written immediately after.
        path: 'pending',
        depth: parent ? parent.depth + 1 : 0,
        authorPlayerId: actor.playerId,
        authorNameSnapshot: actor.name,
        authorHandleSnapshot: actor.handle,
        body: body as unknown as Prisma.InputJsonValue,
        bodyText: text,
        spoiler: !!input.spoiler,
        // Published content starts at +1 from its author, as a real removable vote.
        score: 1,
        upvotes: 1,
      },
      select: { id: true },
    })

    const path = parent ? `${parent.path}.${pathSegment(c.id)}` : pathSegment(c.id)
    await tx.breakComment.update({ where: { id: c.id }, data: { path } })
    await tx.breakCommentVote.create({ data: { commentId: c.id, playerId: actor.playerId, value: 1 } })

    if (parent) {
      await tx.breakComment.update({ where: { id: parent.id }, data: { replyCount: { increment: 1 } } })
    }

    const p = await tx.breakPost.update({
      where: { id: input.postId },
      data: { commentCount: { increment: 1 } },
      select: { score: true, commentCount: true, publishedAt: true },
    })
    // Comments feed Hot, so the ordering follows discussion as well as votes.
    await tx.breakPost.update({
      where: { id: input.postId },
      data: { hotRank: hotRank(p.score, p.commentCount, p.publishedAt ?? new Date()) },
    })

    return c
  })

  return { ok: true, commentId: created.id }
}

export async function editComment(actor: BreakActor, commentId: number, body: unknown): Promise<CommentResult> {
  const c = await prisma.breakComment.findUnique({
    where: { id: commentId }, select: { id: true, authorPlayerId: true, deletedAt: true },
  })
  if (!c) return { ok: false, error: 'That comment no longer exists.' }
  if (c.authorPlayerId !== actor.playerId) return { ok: false, error: 'That is not yours to edit.' }
  if (c.deletedAt) return { ok: false, error: 'That comment was deleted.' }

  const doc = sanitizeDocument(body)
  if (isEmptyDocument(doc)) return { ok: false, error: 'A comment cannot be emptied — delete it instead.' }

  await prisma.breakComment.update({
    where: { id: commentId },
    data: {
      body: doc as unknown as Prisma.InputJsonValue,
      bodyText: documentToPlainText(doc).slice(0, MAX_COMMENT_CHARS),
      editedAt: new Date(),
    },
  })
  return { ok: true, commentId }
}

/**
 * The author withdrawing a comment.
 *
 * With replies it becomes `[deleted]` in place: the thread keeps its shape and other people's
 * replies keep their context. With none it can go entirely, since nothing hangs off it.
 */
export async function softDeleteComment(actor: BreakActor, commentId: number): Promise<CommentResult> {
  const c = await prisma.breakComment.findUnique({
    where: { id: commentId }, select: { id: true, authorPlayerId: true, postId: true, replyCount: true, parentId: true, deletedAt: true },
  })
  if (!c) return { ok: false, error: 'That comment no longer exists.' }
  if (c.authorPlayerId !== actor.playerId && !actor.isAdmin) {
    return { ok: false, error: 'That is not yours to delete.' }
  }
  if (c.deletedAt) return { ok: true, commentId }

  await prisma.$transaction(async (tx) => {
    if (c.replyCount > 0) {
      await tx.breakComment.update({
        where: { id: commentId },
        data: { deletedAt: new Date() },
      })
    } else {
      await tx.breakComment.delete({ where: { id: commentId } })
      if (c.parentId) {
        await tx.breakComment.update({ where: { id: c.parentId }, data: { replyCount: { decrement: 1 } } })
      }
    }
    await tx.breakPost.update({
      where: { id: c.postId }, data: { commentCount: { decrement: 1 } },
    })
  })
  return { ok: true, commentId }
}

// ────────────────────────────────────────────────────────────────────────────────────── reading

export interface CommentNode {
  id: number
  parentId: number | null
  depth: number
  path: string
  authorName: string
  authorHandle: string | null
  authorPlayerId: string | null
  body: unknown
  bodyText: string
  createdAt: Date
  editedAt: Date | null
  deletedAt: Date | null
  removedAt: Date | null
  removalReason: string | null
  score: number
  upvotes: number
  downvotes: number
  replyCount: number
  distinguished: boolean
  sticky: boolean
  locked: boolean
  spoiler: boolean
  sensitive: boolean
  media: {
    kind: string
    url: string
    posterUrl: string | null
    alt: string | null
    width: number | null
    height: number | null
    duration: number | null
  } | null
  viewerVote: number | null
  viewerSaved: boolean
  children: CommentNode[]
  /** True when this node has replies the view is not rendering, so it can offer to continue. */
  hasMoreBelow: boolean
}

const COMMENT_SELECT = {
  id: true, parentId: true, depth: true, path: true,
  authorNameSnapshot: true, authorHandleSnapshot: true, authorPlayerId: true,
  body: true, bodyText: true, createdAt: true, editedAt: true, deletedAt: true,
  removedAt: true, removalReason: true,
  score: true, upvotes: true, downvotes: true, replyCount: true,
  distinguished: true, sticky: true, locked: true, spoiler: true, sensitive: true,
  media: {
    select: { kind: true, url: true, posterUrl: true, alt: true, width: true, height: true, duration: true, status: true },
  },
} satisfies Prisma.BreakCommentSelect

type RawComment = Prisma.BreakCommentGetPayload<{ select: typeof COMMENT_SELECT }>

/**
 * A post's comment tree.
 *
 * `rootId` roots the fetch at one comment — that is the "Continue this thread" page, and it is a
 * prefix match on the path rather than a different query.
 */
export async function getCommentTree(opts: {
  postId: number
  viewer: BreakActor | null
  sort?: CommentSort
  rootId?: number | null
  visibleDepth?: number
}): Promise<CommentNode[]> {
  const sort = opts.sort ?? 'best'
  const visibleDepth = opts.visibleDepth ?? VISIBLE_DEPTH

  let pathPrefix: string | null = null
  let baseDepth = 0
  if (opts.rootId) {
    const root = await prisma.breakComment.findUnique({
      where: { id: opts.rootId }, select: { path: true, depth: true, postId: true },
    })
    if (!root || root.postId !== opts.postId) return []
    pathPrefix = root.path
    baseDepth = root.depth
  }

  // One range scan for the whole thread.
  const rows = await prisma.breakComment.findMany({
    where: {
      postId: opts.postId,
      ...(pathPrefix ? { OR: [{ path: pathPrefix }, { path: { startsWith: `${pathPrefix}.` } }] } : {}),
      ...(pathPrefix ? {} : { depth: { lte: baseDepth + visibleDepth } }),
    },
    orderBy: { path: 'asc' },
    select: COMMENT_SELECT,
  })
  if (rows.length === 0) return []

  const ids = rows.map((r) => r.id)
  const [votes, saves] = await Promise.all([
    opts.viewer
      ? prisma.breakCommentVote.findMany({
          where: { playerId: opts.viewer.playerId, commentId: { in: ids } },
          select: { commentId: true, value: true },
        })
      : Promise.resolve([]),
    opts.viewer
      ? prisma.breakSavedComment.findMany({
          where: { playerId: opts.viewer.playerId, commentId: { in: ids } },
          select: { commentId: true },
        })
      : Promise.resolve([]),
  ])
  const voteBy = new Map(votes.map((v) => [v.commentId, v.value]))
  const savedSet = new Set(saves.map((s) => s.commentId))

  const nodes = new Map<number, CommentNode>()
  for (const r of rows) {
    nodes.set(r.id, {
      id: r.id,
      parentId: r.parentId,
      depth: r.depth - baseDepth,
      path: r.path,
      // A withdrawn comment gives up its byline along with its body.
      authorName: r.deletedAt ? '[deleted]' : r.authorNameSnapshot,
      authorHandle: r.deletedAt ? null : r.authorHandleSnapshot,
      authorPlayerId: r.deletedAt ? null : r.authorPlayerId,
      /*
       * A withdrawn or removed comment gives up its body and its byline, and keeps its place.
       *
       * Withheld HERE rather than in the component: a page is not the only thing that reads this, and
       * a body filtered only at render is a body one careless caller away from being published.
       */
      body: r.deletedAt || r.removedAt ? null : r.body,
      bodyText: r.deletedAt ? '[deleted]' : r.removedAt ? '[removed]' : r.bodyText,
      createdAt: r.createdAt,
      editedAt: r.editedAt,
      deletedAt: r.deletedAt,
      removedAt: r.removedAt,
      removalReason: r.removalReason,
      score: r.score,
      upvotes: r.upvotes,
      downvotes: r.downvotes,
      replyCount: r.replyCount,
      distinguished: r.distinguished,
      sticky: r.sticky,
      locked: r.locked,
      spoiler: r.spoiler,
      sensitive: r.sensitive,
      media: r.deletedAt || r.removedAt || !r.media || r.media.status !== 'READY'
        ? null
        : {
            kind: r.media.kind, url: r.media.url, posterUrl: r.media.posterUrl,
            alt: r.media.alt, width: r.media.width, height: r.media.height, duration: r.media.duration,
          },
      viewerVote: opts.viewer ? voteBy.get(r.id) ?? 0 : null,
      viewerSaved: savedSet.has(r.id),
      children: [],
      hasMoreBelow: false,
    })
  }

  // Assemble. Every parent is already present because the path ordering is depth-first.
  const roots: CommentNode[] = []
  for (const r of rows) {
    const node = nodes.get(r.id)!
    const parent = r.parentId ? nodes.get(r.parentId) : null
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  // A node whose replies were not fetched says so, rather than looking like a leaf.
  for (const node of nodes.values()) {
    if (node.replyCount > node.children.length) node.hasMoreBelow = true
  }

  sortNodes(roots, sort)
  return roots
}

/** Sort siblings at every level. Stickied staff comments sit above the ordering, not inside it. */
function sortNodes(nodes: CommentNode[], sort: CommentSort): void {
  const cmp = comparator(sort)
  nodes.sort((a, b) => {
    if (a.sticky !== b.sticky) return a.sticky ? -1 : 1
    return cmp(a, b)
  })
  for (const n of nodes) sortNodes(n.children, sort)
}

function comparator(sort: CommentSort): (a: CommentNode, b: CommentNode) => number {
  switch (sort) {
    case 'new': return (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id
    case 'old': return (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id
    case 'top': return (a, b) => b.score - a.score || b.id - a.id
    case 'controversial':
      return (a, b) => controversyRank(b.upvotes, b.downvotes) - controversyRank(a.upvotes, a.downvotes) || b.id - a.id
    case 'best':
    default:
      return (a, b) => wilsonLowerBound(b.upvotes, b.downvotes) - wilsonLowerBound(a.upvotes, a.downvotes) || b.id - a.id
  }
}

/** Rebuild `commentCount` and `replyCount` from the rows. Same contract as the vote reconciler. */
export async function reconcileCommentCounts(opts: { apply?: boolean } = {}): Promise<string[]> {
  const apply = opts.apply ?? false
  const details: string[] = []

  const grouped = await prisma.breakComment.groupBy({
    by: ['postId'], where: { deletedAt: null, removedAt: null }, _count: { _all: true },
  })
  const byPost = new Map(grouped.map((g) => [g.postId, g._count._all]))
  const posts = await prisma.breakPost.findMany({ select: { id: true, commentCount: true, score: true, publishedAt: true } })
  for (const p of posts) {
    const want = byPost.get(p.id) ?? 0
    if (p.commentCount === want) continue
    details.push(`post ${p.id}: commentCount ${p.commentCount} → ${want}`)
    if (apply) {
      await prisma.breakPost.update({
        where: { id: p.id },
        data: { commentCount: want, hotRank: hotRank(p.score, want, p.publishedAt ?? new Date()) },
      })
    }
  }

  const replies = await prisma.breakComment.groupBy({
    by: ['parentId'], where: { parentId: { not: null } }, _count: { _all: true },
  })
  const byParent = new Map(replies.map((r) => [r.parentId!, r._count._all]))
  const comments = await prisma.breakComment.findMany({ select: { id: true, replyCount: true } })
  for (const c of comments) {
    const want = byParent.get(c.id) ?? 0
    if (c.replyCount === want) continue
    details.push(`comment ${c.id}: replyCount ${c.replyCount} → ${want}`)
    if (apply) await prisma.breakComment.update({ where: { id: c.id }, data: { replyCount: want } })
  }

  return details
}
