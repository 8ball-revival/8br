import 'server-only'
import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { hotRank } from './ranking'

/**
 * Voting on posts and comments.
 *
 * ── The endpoint takes a DIRECTION, never a total ────────────────────────────────────────────────
 * `castVote` accepts +1, -1 or 0 and nothing else. There is deliberately no path anywhere that
 * accepts a score: if a client could send "this post is now 4000", the score would be whatever the
 * last caller said, and no amount of validation elsewhere would fix that. The score is derived from
 * the vote rows, always.
 *
 * ── One vote per account, enforced by the database ───────────────────────────────────────────────
 * The unique index on (target, player) is the mechanism. The service upserts against it, so two
 * requests racing produce one row and one of them updates it — rather than two rows that both count.
 * Because votes hang off the canonical Player id, a member with several merged profiles still has
 * exactly one vote: the merge repoints the rows and the unique index collapses any duplicate.
 *
 * ── Counters are caches ──────────────────────────────────────────────────────────────────────────
 * `score`, `upvotes` and `downvotes` are updated in the SAME transaction as the vote row, from the
 * delta, so they cannot drift under normal operation. When they do drift — a crash mid-write, a
 * manual repair — `reconcile*` recomputes them from the rows, which are the truth.
 */

export type VoteValue = 1 | 0 | -1

export interface VoteResult {
  ok: boolean
  error?: string
  /** The authoritative values after the write. The client replaces its optimistic guess with these. */
  score?: number
  upvotes?: number
  downvotes?: number
  /** What this account's vote now is. */
  viewerVote?: VoteValue
}

/** Reject anything that is not a direction, before it reaches the database. */
export function parseVoteValue(input: unknown): VoteValue | null {
  const n = typeof input === 'number' ? input : Number(input)
  return n === 1 || n === 0 || n === -1 ? (n as VoteValue) : null
}

/**
 * The change one vote makes to the cached counters.
 *
 * Pure, so the arithmetic that keeps the counters honest can be tested on its own rather than only
 * through a database. `from` and `to` are the account's previous and new vote.
 */
export function voteDelta(from: VoteValue, to: VoteValue): { score: number; up: number; down: number } {
  const up = (to === 1 ? 1 : 0) - (from === 1 ? 1 : 0)
  const down = (to === -1 ? 1 : 0) - (from === -1 ? 1 : 0)
  return { score: to - from, up, down }
}

async function applyPostVote(
  tx: Prisma.TransactionClient,
  postId: number,
  playerId: string,
  to: VoteValue,
): Promise<VoteResult> {
  const existing = await tx.breakPostVote.findUnique({
    where: { postId_playerId: { postId, playerId } },
    select: { id: true, value: true },
  })
  const from = (existing?.value ?? 0) as VoteValue

  // Clicking the vote you already have removes it. That is what `to === from` means here, and it is
  // resolved before the write so the "switch" path never has to special-case it.
  const next: VoteValue = to === from ? 0 : to
  if (next === from) {
    const p = await tx.breakPost.findUniqueOrThrow({
      where: { id: postId }, select: { score: true, upvotes: true, downvotes: true },
    })
    return { ok: true, ...p, viewerVote: from }
  }

  if (next === 0) {
    await tx.breakPostVote.delete({ where: { postId_playerId: { postId, playerId } } })
  } else {
    await tx.breakPostVote.upsert({
      where: { postId_playerId: { postId, playerId } },
      create: { postId, playerId, value: next },
      update: { value: next },
    })
  }

  const d = voteDelta(from, next)
  const updated = await tx.breakPost.update({
    where: { id: postId },
    data: {
      score: { increment: d.score },
      upvotes: { increment: d.up },
      downvotes: { increment: d.down },
    },
    select: { id: true, score: true, upvotes: true, downvotes: true, commentCount: true, publishedAt: true, authorPlayerId: true },
  })

  // Hot depends on the score, so it is recomputed here rather than by a job that would leave the
  // ordering stale for however long its interval is.
  await tx.breakPost.update({
    where: { id: postId },
    data: { hotRank: hotRank(updated.score, updated.commentCount, updated.publishedAt ?? new Date()) },
  })

  await bumpKarma(tx, updated.authorPlayerId, playerId, 'post', d.score)

  return {
    ok: true,
    score: updated.score,
    upvotes: updated.upvotes,
    downvotes: updated.downvotes,
    viewerVote: next,
  }
}

async function applyCommentVote(
  tx: Prisma.TransactionClient,
  commentId: number,
  playerId: string,
  to: VoteValue,
): Promise<VoteResult> {
  const existing = await tx.breakCommentVote.findUnique({
    where: { commentId_playerId: { commentId, playerId } },
    select: { value: true },
  })
  const from = (existing?.value ?? 0) as VoteValue
  const next: VoteValue = to === from ? 0 : to

  if (next === from) {
    const c = await tx.breakComment.findUniqueOrThrow({
      where: { id: commentId }, select: { score: true, upvotes: true, downvotes: true },
    })
    return { ok: true, ...c, viewerVote: from }
  }

  if (next === 0) {
    await tx.breakCommentVote.delete({ where: { commentId_playerId: { commentId, playerId } } })
  } else {
    await tx.breakCommentVote.upsert({
      where: { commentId_playerId: { commentId, playerId } },
      create: { commentId, playerId, value: next },
      update: { value: next },
    })
  }

  const d = voteDelta(from, next)
  const updated = await tx.breakComment.update({
    where: { id: commentId },
    data: {
      score: { increment: d.score },
      upvotes: { increment: d.up },
      downvotes: { increment: d.down },
    },
    select: { score: true, upvotes: true, downvotes: true, authorPlayerId: true },
  })

  await bumpKarma(tx, updated.authorPlayerId, playerId, 'comment', d.score)

  return {
    ok: true,
    score: updated.score,
    upvotes: updated.upvotes,
    downvotes: updated.downvotes,
    viewerVote: next,
  }
}

/**
 * Community karma.
 *
 * Kept apart from pool Rating and Rank on purpose: one is a competition fact and the other is how
 * much the room liked a post, and mixing them would put an opinion in the Rankings table.
 *
 * A vote on your own content does not move your karma. The author's automatic +1 would otherwise
 * hand everyone a point for pressing publish, which measures nothing.
 */
async function bumpKarma(
  tx: Prisma.TransactionClient,
  authorPlayerId: string | null,
  voterPlayerId: string,
  kind: 'post' | 'comment',
  delta: number,
): Promise<void> {
  if (!authorPlayerId || delta === 0) return
  if (authorPlayerId === voterPlayerId) return

  const field = kind === 'post' ? 'postKarma' : 'commentKarma'
  await tx.breakKarma.upsert({
    where: { playerId: authorPlayerId },
    create: { playerId: authorPlayerId, [field]: delta },
    update: { [field]: { increment: delta } },
  })
}

export async function voteOnPost(postId: number, playerId: string, value: VoteValue): Promise<VoteResult> {
  const post = await prisma.breakPost.findUnique({
    where: { id: postId },
    select: { id: true, state: true, deletedAt: true },
  })
  if (!post) return { ok: false, error: 'That post no longer exists.' }
  // A draft is not public, so it cannot be voted on — including by way of a guessed id.
  if (post.state === 'DRAFT') return { ok: false, error: 'That post is not published.' }
  if (post.deletedAt) return { ok: false, error: 'That post was deleted.' }

  return prisma.$transaction((tx) => applyPostVote(tx, postId, playerId, value))
}

export async function voteOnComment(commentId: number, playerId: string, value: VoteValue): Promise<VoteResult> {
  const comment = await prisma.breakComment.findUnique({
    where: { id: commentId }, select: { id: true, deletedAt: true },
  })
  if (!comment) return { ok: false, error: 'That comment no longer exists.' }

  return prisma.$transaction((tx) => applyCommentVote(tx, commentId, playerId, value))
}

/**
 * The author's opening +1.
 *
 * A real vote row, not a number added to the score — so the author can remove it like any other
 * vote, and every score in the system is the sum of actual votes with no invented component. Called
 * inside the publish transaction.
 */
export async function seedAuthorVote(
  tx: Prisma.TransactionClient,
  postId: number,
  authorPlayerId: string | null,
): Promise<void> {
  if (!authorPlayerId) return
  const existing = await tx.breakPostVote.findUnique({
    where: { postId_playerId: { postId, playerId: authorPlayerId } }, select: { id: true },
  })
  if (existing) return

  await tx.breakPostVote.create({ data: { postId, playerId: authorPlayerId, value: 1 } })
  const p = await tx.breakPost.update({
    where: { id: postId },
    data: { score: { increment: 1 }, upvotes: { increment: 1 } },
    select: { score: true, commentCount: true, publishedAt: true },
  })
  await tx.breakPost.update({
    where: { id: postId },
    data: { hotRank: hotRank(p.score, p.commentCount, p.publishedAt ?? new Date()) },
  })
}

// ────────────────────────────────────────────────────────────────────────────────── reconciliation

export interface ReconcileReport {
  postsChecked: number
  postsFixed: number
  commentsChecked: number
  commentsFixed: number
  karmaFixed: number
  details: string[]
}

/**
 * Rebuild every cached counter from the canonical vote rows.
 *
 * The counters exist so a feed does not have to aggregate votes on every read. This is what makes
 * that safe: whenever the two disagree the rows win, and the disagreement is reported rather than
 * quietly corrected, so a recurring drift is visible instead of being papered over each night.
 */
export async function reconcileVotes(opts: { apply?: boolean } = {}): Promise<ReconcileReport> {
  const apply = opts.apply ?? false
  const report: ReconcileReport = {
    postsChecked: 0, postsFixed: 0, commentsChecked: 0, commentsFixed: 0, karmaFixed: 0, details: [],
  }

  const postTallies = await prisma.breakPostVote.groupBy({
    by: ['postId'],
    _sum: { value: true },
    _count: { _all: true },
  })
  const upByPost = new Map(
    (await prisma.breakPostVote.groupBy({ by: ['postId'], where: { value: 1 }, _count: { _all: true } }))
      .map((r) => [r.postId, r._count._all]),
  )
  const tallyByPost = new Map(postTallies.map((t) => [t.postId, t]))

  const posts = await prisma.breakPost.findMany({
    select: { id: true, score: true, upvotes: true, downvotes: true, commentCount: true, publishedAt: true },
  })
  for (const p of posts) {
    report.postsChecked++
    const t = tallyByPost.get(p.id)
    const up = upByPost.get(p.id) ?? 0
    const total = t?._count._all ?? 0
    const score = t?._sum.value ?? 0
    const down = total - up
    if (p.score === score && p.upvotes === up && p.downvotes === down) continue

    report.postsFixed++
    report.details.push(`post ${p.id}: ${p.score}/${p.upvotes}/${p.downvotes} → ${score}/${up}/${down}`)
    if (apply) {
      await prisma.breakPost.update({
        where: { id: p.id },
        data: {
          score, upvotes: up, downvotes: down,
          hotRank: hotRank(score, p.commentCount, p.publishedAt ?? new Date()),
        },
      })
    }
  }

  const upByComment = new Map(
    (await prisma.breakCommentVote.groupBy({ by: ['commentId'], where: { value: 1 }, _count: { _all: true } }))
      .map((r) => [r.commentId, r._count._all]),
  )
  const commentTallies = new Map(
    (await prisma.breakCommentVote.groupBy({ by: ['commentId'], _sum: { value: true }, _count: { _all: true } }))
      .map((r) => [r.commentId, r]),
  )
  const comments = await prisma.breakComment.findMany({
    select: { id: true, score: true, upvotes: true, downvotes: true },
  })
  for (const c of comments) {
    report.commentsChecked++
    const t = commentTallies.get(c.id)
    const up = upByComment.get(c.id) ?? 0
    const total = t?._count._all ?? 0
    const score = t?._sum.value ?? 0
    const down = total - up
    if (c.score === score && c.upvotes === up && c.downvotes === down) continue

    report.commentsFixed++
    report.details.push(`comment ${c.id}: ${c.score}/${c.upvotes}/${c.downvotes} → ${score}/${up}/${down}`)
    if (apply) {
      await prisma.breakComment.update({
        where: { id: c.id }, data: { score, upvotes: up, downvotes: down },
      })
    }
  }

  await reconcileKarma({ apply, report })
  return report
}

/**
 * Recompute karma from the votes that are actually there.
 *
 * This is what removes manipulation for good: when a moderator deletes a run of fraudulent votes,
 * the rows are gone, and karma recomputed from the rows no longer contains them. Nothing has to
 * remember to subtract anything.
 */
export async function reconcileKarma(
  opts: { apply?: boolean; report?: ReconcileReport } = {},
): Promise<Map<string, { postKarma: number; commentKarma: number }>> {
  const apply = opts.apply ?? false
  const totals = new Map<string, { postKarma: number; commentKarma: number }>()
  const add = (id: string | null, kind: 'postKarma' | 'commentKarma', v: number) => {
    if (!id) return
    const cur = totals.get(id) ?? { postKarma: 0, commentKarma: 0 }
    cur[kind] += v
    totals.set(id, cur)
  }

  const postVotes = await prisma.breakPostVote.findMany({
    select: { value: true, playerId: true, post: { select: { authorPlayerId: true } } },
  })
  for (const v of postVotes) {
    // Self-votes are excluded here for the same reason they are excluded on the way in.
    if (v.post.authorPlayerId && v.post.authorPlayerId !== v.playerId) {
      add(v.post.authorPlayerId, 'postKarma', v.value)
    }
  }

  const commentVotes = await prisma.breakCommentVote.findMany({
    select: { value: true, playerId: true, comment: { select: { authorPlayerId: true } } },
  })
  for (const v of commentVotes) {
    if (v.comment.authorPlayerId && v.comment.authorPlayerId !== v.playerId) {
      add(v.comment.authorPlayerId, 'commentKarma', v.value)
    }
  }

  const stored = await prisma.breakKarma.findMany()
  const storedById = new Map(stored.map((k) => [k.playerId, k]))
  const ids = new Set([...totals.keys(), ...storedById.keys()])

  for (const id of ids) {
    const want = totals.get(id) ?? { postKarma: 0, commentKarma: 0 }
    const have = storedById.get(id)
    if (have && have.postKarma === want.postKarma && have.commentKarma === want.commentKarma) continue

    if (opts.report) {
      opts.report.karmaFixed++
      opts.report.details.push(
        `karma ${id}: ${have?.postKarma ?? 0}/${have?.commentKarma ?? 0} → ${want.postKarma}/${want.commentKarma}`)
    }
    if (apply) {
      await prisma.breakKarma.upsert({
        where: { playerId: id },
        create: { playerId: id, ...want },
        update: want,
      })
    }
  }

  return totals
}
