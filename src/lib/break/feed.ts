import 'server-only'
import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import {
  type FeedSort, type TopWindow, type SearchSort,
  DEFAULT_FEED_SORT, topWindowStart, risingRank, RISING_WINDOW_HOURS,
} from './ranking'

/**
 * The Break's feed.
 *
 * ── Cursor pagination, not offset ────────────────────────────────────────────────────────────────
 * `skip: 400` makes the database walk four hundred rows it then discards, so page 20 costs twenty
 * times page 1 — and if somebody posts while you are reading, every subsequent page silently shifts
 * by one and you see a duplicate. A cursor is a position in an ordering: it costs the same at any
 * depth and it cannot skip or repeat a row when the list changes underneath it. The whole feed is
 * never loaded into the browser; each request fetches one page.
 *
 * ── Every sort has a total order ─────────────────────────────────────────────────────────────────
 * Every ORDER BY ends in `id`. Without a unique tiebreak, two posts with the same score have no
 * defined order between them, and the cursor cannot say which one it has already shown — so the same
 * post appears twice, or one goes missing entirely. The id makes each ordering total, which is what
 * makes the cursor sound.
 */

export const PAGE_SIZE = 20

export interface FeedQuery {
  sort?: FeedSort
  window?: TopWindow
  category?: string | null
  /** Opaque; produced by this module and passed back verbatim. */
  cursor?: string | null
  limit?: number
  /** Personalises hidden posts and the viewer's own vote. Never widens what is visible. */
  viewerPlayerId?: string | null
}

export interface FeedCard {
  id: number
  type: string
  title: string
  slug: string
  category: { slug: string; name: string; color: string } | null
  authorName: string
  authorHandle: string | null
  authorPlayerId: string | null
  publishedAt: Date | null
  editedAt: Date | null
  score: number
  commentCount: number
  pinned: boolean
  locked: boolean
  official: boolean
  spoiler: boolean
  sensitive: boolean
  removedAt: Date | null
  removalReason: string | null
  deletedAt: Date | null
  linkUrl: string | null
  linkDomain: string | null
  linkImageUrl: string | null
  repostOfId: number | null
  media: {
    kind: string
    url: string
    posterUrl: string | null
    alt: string | null
    width: number | null
    height: number | null
    duration: number | null
  }[]
  mediaCount: number
  pollOptionCount: number
  /** The viewer's own vote: 1, -1, or 0. Null when signed out. */
  viewerVote: number | null
  viewerSaved: boolean
}

export interface FeedPage {
  cards: FeedCard[]
  nextCursor: string | null
  /** Pinned posts, returned once with the first page and never repeated below. */
  pinned: FeedCard[]
}

/**
 * The visibility rule, in one place.
 *
 * A post is publicly visible when it is PUBLISHED, not removed, not author-deleted, and its
 * publication time has arrived. Every feed, search and count uses this same predicate — if it were
 * written out at each call site, one of them would eventually forget `removedAt` and leak removed
 * content into a listing.
 */
export function publicPostWhere(now: Date = new Date()): Prisma.BreakPostWhereInput {
  return {
    state: 'PUBLISHED',
    removedAt: null,
    deletedAt: null,
    publishedAt: { lte: now },
  }
}

const CARD_SELECT = {
  id: true, type: true, title: true, slug: true,
  authorNameSnapshot: true, authorHandleSnapshot: true, authorPlayerId: true,
  publishedAt: true, editedAt: true,
  score: true, commentCount: true,
  pinned: true, pinOrder: true, locked: true, official: true, spoiler: true, sensitive: true,
  removedAt: true, removalReason: true, deletedAt: true,
  linkUrl: true, linkDomain: true, linkImageUrl: true, linkPreviewRemoved: true,
  repostOfId: true, hotRank: true,
  category: { select: { slug: true, name: true, color: true } },
  media: {
    orderBy: { position: 'asc' as const },
    select: {
      kind: true, url: true, posterUrl: true, alt: true,
      width: true, height: true, duration: true, status: true,
    },
  },
  _count: { select: { media: true } },
  poll: { select: { _count: { select: { options: true } } } },
} satisfies Prisma.BreakPostSelect

type RawCard = Prisma.BreakPostGetPayload<{ select: typeof CARD_SELECT }>

function toCard(p: RawCard, viewerVote: number | null, viewerSaved: boolean): FeedCard {
  return {
    id: p.id,
    type: p.type,
    title: p.title,
    slug: p.slug,
    category: p.category,
    authorName: p.authorNameSnapshot,
    authorHandle: p.authorHandleSnapshot,
    authorPlayerId: p.authorPlayerId,
    publishedAt: p.publishedAt,
    editedAt: p.editedAt,
    score: p.score,
    commentCount: p.commentCount,
    pinned: p.pinned,
    locked: p.locked,
    official: p.official,
    spoiler: p.spoiler,
    sensitive: p.sensitive,
    removedAt: p.removedAt,
    removalReason: p.removalReason,
    deletedAt: p.deletedAt,
    linkUrl: p.linkUrl,
    linkDomain: p.linkDomain,
    // An author who removed the generated preview meant it; the card must not put it back.
    linkImageUrl: p.linkPreviewRemoved ? null : p.linkImageUrl,
    repostOfId: p.repostOfId,
    // Only READY media is shown. A video still being processed would render as a broken frame.
    media: p.media.filter((m) => m.status === 'READY').map((m) => ({
      kind: m.kind, url: m.url, posterUrl: m.posterUrl, alt: m.alt,
      width: m.width, height: m.height, duration: m.duration,
    })),
    mediaCount: p._count.media,
    pollOptionCount: p.poll?._count.options ?? 0,
    viewerVote,
    viewerSaved,
  }
}

// ───────────────────────────────────────────────────────────────────────────────── the cursor
//
// A cursor is the sort key of the last row shown plus its id, so the next page is "everything
// strictly after this position in this ordering". It is base64 only to discourage hand-editing —
// there is nothing secret in it, and it is validated on the way back in rather than trusted.

interface Cursor { k: number | string; id: number }

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url')
}

function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    const c = parsed as Record<string, unknown>
    const id = Number(c.id)
    if (!Number.isInteger(id) || id < 0) return null
    if (typeof c.k !== 'number' && typeof c.k !== 'string') return null
    return { k: c.k, id }
  } catch {
    // A malformed cursor means the first page, never an error page.
    return null
  }
}

/** The viewer's votes and saves for one page of posts — two queries, not two per card. */
async function viewerState(viewerPlayerId: string | null | undefined, postIds: number[]) {
  if (!viewerPlayerId || postIds.length === 0) {
    return { votes: new Map<number, number>(), saves: new Set<number>() }
  }
  const [votes, saves] = await Promise.all([
    prisma.breakPostVote.findMany({
      where: { playerId: viewerPlayerId, postId: { in: postIds } },
      select: { postId: true, value: true },
    }),
    prisma.breakSavedPost.findMany({
      where: { playerId: viewerPlayerId, postId: { in: postIds } },
      select: { postId: true },
    }),
  ])
  return {
    votes: new Map(votes.map((v) => [v.postId, v.value])),
    saves: new Set(saves.map((s) => s.postId)),
  }
}

/** Posts this viewer has hidden. Personal and private — it changes their feed and nobody else's. */
async function hiddenIds(viewerPlayerId: string | null | undefined): Promise<number[]> {
  if (!viewerPlayerId) return []
  const rows = await prisma.breakHiddenPost.findMany({
    where: { playerId: viewerPlayerId }, select: { postId: true },
  })
  return rows.map((r) => r.postId)
}

export async function getFeed(query: FeedQuery = {}): Promise<FeedPage> {
  const sort = query.sort ?? DEFAULT_FEED_SORT
  const limit = Math.min(Math.max(query.limit ?? PAGE_SIZE, 1), 50)
  const cursor = decodeCursor(query.cursor)
  const now = new Date()

  const hidden = await hiddenIds(query.viewerPlayerId)
  const base: Prisma.BreakPostWhereInput = {
    ...publicPostWhere(now),
    ...(query.category ? { category: { slug: query.category } } : {}),
    ...(hidden.length > 0 ? { id: { notIn: hidden } } : {}),
  }

  /*
   * Pinned posts ride above the sort, and only on the first page.
   *
   * Returning them separately keeps two things true at once: they stay on top wherever the reader is
   * in the ordering, and they are not repeated further down when the normal sort reaches them. The
   * exclusion below is what stops the second.
   */
  let pinnedCards: FeedCard[] = []
  let pinnedIds: number[] = []
  if (!cursor) {
    const rows = await prisma.breakPost.findMany({
      where: { ...base, pinned: true },
      orderBy: [{ pinOrder: 'asc' }, { publishedAt: 'desc' }, { id: 'desc' }],
      take: 5,
      select: CARD_SELECT,
    })
    pinnedIds = rows.map((r) => r.id)
    const st = await viewerState(query.viewerPlayerId, pinnedIds)
    pinnedCards = rows.map((r) => toCard(r, query.viewerPlayerId ? st.votes.get(r.id) ?? 0 : null, st.saves.has(r.id)))
  }

  const where: Prisma.BreakPostWhereInput = {
    ...base,
    ...(pinnedIds.length > 0 ? { id: { notIn: [...hidden, ...pinnedIds] } } : {}),
    // Rising only ever considers the recent window; an old post cannot qualify at all.
    ...(sort === 'rising'
      ? { publishedAt: { lte: now, gte: new Date(now.getTime() - RISING_WINDOW_HOURS * 3_600_000) } }
      : {}),
    ...(sort === 'top' && query.window && query.window !== 'all'
      ? { publishedAt: { lte: now, gte: topWindowStart(query.window, now) ?? undefined } }
      : {}),
  }

  const rows = await fetchSorted(sort, where, cursor, limit + 1)

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const st = await viewerState(query.viewerPlayerId, page.map((p) => p.id))
  const cards = page.map((p) => toCard(p, query.viewerPlayerId ? st.votes.get(p.id) ?? 0 : null, st.saves.has(p.id)))

  const last = page.at(-1)
  const nextCursor = hasMore && last ? encodeCursor({ k: sortKey(sort, last), id: last.id }) : null

  return { cards, pinned: pinnedCards, nextCursor }
}

/** The value the cursor remembers, matching the ORDER BY of each sort. */
function sortKey(sort: FeedSort, row: RawCard): number | string {
  switch (sort) {
    case 'new': return (row.publishedAt ?? new Date(0)).toISOString()
    case 'top': return row.score
    case 'rising': return risingRank(row.score, row.commentCount, row.publishedAt ?? new Date(0))
    case 'hot':
    default: return row.hotRank
  }
}

async function fetchSorted(
  sort: FeedSort,
  where: Prisma.BreakPostWhereInput,
  cursor: Cursor | null,
  take: number,
): Promise<RawCard[]> {
  /*
   * Rising is computed, not stored.
   *
   * Its value changes continuously with the clock even when nothing about the post changes, so a
   * stored column would be wrong the moment after it was written. The window keeps the candidate set
   * small — a day of posts — so ranking them in the service is cheap, and the alternative (a
   * background job rewriting every recent row every few minutes) buys nothing.
   */
  if (sort === 'rising') {
    const candidates = await prisma.breakPost.findMany({
      where, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], take: 500, select: CARD_SELECT,
    })
    const now = Date.now()
    const ranked = candidates
      .map((c) => ({ c, r: risingRank(c.score, c.commentCount, c.publishedAt ?? new Date(0), now) }))
      .sort((a, b) => b.r - a.r || b.c.id - a.c.id)

    const start = cursor
      ? ranked.findIndex((x) => x.c.id === cursor.id) + 1
      : 0
    return ranked.slice(Math.max(start, 0), Math.max(start, 0) + take).map((x) => x.c)
  }

  const after = cursorPredicate(sort, cursor)
  const merged: Prisma.BreakPostWhereInput = after ? { AND: [where, after] } : where

  const orderBy: Prisma.BreakPostOrderByWithRelationInput[] =
    sort === 'new' ? [{ publishedAt: 'desc' }, { id: 'desc' }]
    : sort === 'top' ? [{ score: 'desc' }, { commentCount: 'desc' }, { publishedAt: 'desc' }, { id: 'desc' }]
    : [{ hotRank: 'desc' }, { id: 'desc' }]

  return prisma.breakPost.findMany({ where: merged, orderBy, take, select: CARD_SELECT })
}

/**
 * "Strictly after this position", expressed as a filter.
 *
 * Every sort is descending, so "after" means a smaller key — or an equal key and a smaller id, which
 * is the tiebreak the ORDER BY uses. Getting this wrong in the equal case is what produces the
 * duplicate row at a page boundary that only shows up with real data.
 */
function cursorPredicate(sort: FeedSort, cursor: Cursor | null): Prisma.BreakPostWhereInput | null {
  if (!cursor) return null

  if (sort === 'new') {
    const at = new Date(String(cursor.k))
    if (Number.isNaN(at.getTime())) return null
    return { OR: [{ publishedAt: { lt: at } }, { publishedAt: at, id: { lt: cursor.id } }] }
  }
  if (sort === 'top') {
    const k = Number(cursor.k)
    if (!Number.isFinite(k)) return null
    return { OR: [{ score: { lt: k } }, { score: k, id: { lt: cursor.id } }] }
  }
  const k = Number(cursor.k)
  if (!Number.isFinite(k)) return null
  return { OR: [{ hotRank: { lt: k } }, { hotRank: k, id: { lt: cursor.id } }] }
}

// ───────────────────────────────────────────────────────────────────────────────────── search

export interface SearchQuery {
  q: string
  sort?: SearchSort
  category?: string | null
  cursor?: string | null
  limit?: number
  viewerPlayerId?: string | null
}

/**
 * Search, in the database.
 *
 * The generated `searchVector` column and its GIN index do the matching, with the title weighted
 * above the body and the author fields included so a CueVerse ID finds its author's posts. A
 * trigram match runs alongside it so a partial handle — "adnan" inside "x0_adnan_0x" — still hits,
 * which a word-based vector alone will not do.
 *
 * The alternative, loading posts and filtering them in the application, gets slower with every post
 * ever written and cannot rank by relevance at all.
 */
export async function searchPosts(query: SearchQuery): Promise<FeedPage> {
  const term = query.q.trim()
  const limit = Math.min(Math.max(query.limit ?? PAGE_SIZE, 1), 50)
  if (term.length === 0) return { cards: [], pinned: [], nextCursor: null }

  const offset = Number(query.cursor ?? 0) || 0
  const sort = query.sort ?? 'relevance'

  const order = sort === 'new' ? Prisma.sql`p."publishedAt" DESC, p."id" DESC`
    : sort === 'top' ? Prisma.sql`p."score" DESC, p."id" DESC`
    : sort === 'hot' ? Prisma.sql`p."hotRank" DESC, p."id" DESC`
    : sort === 'comments' ? Prisma.sql`p."commentCount" DESC, p."id" DESC`
    : Prisma.sql`rank DESC, p."publishedAt" DESC, p."id" DESC`

  const categoryFilter = query.category
    ? Prisma.sql`AND c."slug" = ${query.category}`
    : Prisma.empty

  const rows = await prisma.$queryRaw<{ id: number }[]>`
    SELECT p."id",
           ts_rank(p."searchVector", websearch_to_tsquery('english', ${term}))
             + similarity(p."title", ${term}) * 0.5
             + similarity(coalesce(p."authorHandleSnapshot", ''), ${term}) * 0.5 AS rank
    FROM "break_post" p
    LEFT JOIN "break_category" c ON c."id" = p."categoryId"
    WHERE p."state" = 'PUBLISHED'
      AND p."removedAt" IS NULL
      AND p."deletedAt" IS NULL
      AND p."publishedAt" <= NOW()
      ${categoryFilter}
      AND (
        p."searchVector" @@ websearch_to_tsquery('english', ${term})
        OR p."title" % ${term}
        OR coalesce(p."authorHandleSnapshot", '') % ${term}
        OR coalesce(p."authorNameSnapshot", '') % ${term}
      )
    ORDER BY ${order}
    LIMIT ${limit + 1} OFFSET ${offset}
  `

  const hasMore = rows.length > limit
  const ids = (hasMore ? rows.slice(0, limit) : rows).map((r) => r.id)
  if (ids.length === 0) return { cards: [], pinned: [], nextCursor: null }

  const found = await prisma.breakPost.findMany({ where: { id: { in: ids } }, select: CARD_SELECT })
  // Restore the ranked order the SQL produced; `IN` gives no ordering of its own.
  const byId = new Map(found.map((p) => [p.id, p]))
  const ordered = ids.map((id) => byId.get(id)).filter((p): p is RawCard => !!p)

  const st = await viewerState(query.viewerPlayerId, ids)
  return {
    cards: ordered.map((p) => toCard(p, query.viewerPlayerId ? st.votes.get(p.id) ?? 0 : null, st.saves.has(p.id))),
    pinned: [],
    nextCursor: hasMore ? String(offset + limit) : null,
  }
}
