import 'server-only'
import { prisma } from '@/lib/prisma'
import { publishedWhere } from '@/lib/editorial/service'
import { sanitizeDocument, readingTimeMinutes, deriveExcerpt } from '@/lib/editorial/richtext'

/**
 * The three article positions on the homepage.
 *
 * Position 1 is a featured article that rotates once an hour. Positions 2 and 3 are simply the two
 * newest published articles.
 *
 * The rotation is deterministic, not random. Every visitor in the same clock hour sees the same
 * article, on every server instance, on every render — because the choice is a pure function of the
 * UTC hour and the sorted list of eligible article ids. Nothing is stored, nothing is scheduled, and
 * there is no per-request randomness that could differ between a server render and a client one.
 */

export interface HomeArticle {
  id: number
  slug: string
  title: string
  excerpt: string
  publishAt: Date
  categoryName: string | null
  categorySlug: string | null
  author: string
  readingMinutes: number
  commentCount: number
  coverMediaId: string | null
  coverAlt: string | null
}

/** How many hours make a rotation step. One, by definition, but named so the intent is not a guess. */
const HOUR_MS = 3_600_000

// --------------------------------------------------------------------------- selection

/**
 * The UTC hour a moment falls in.
 *
 * UTC rather than local time so every server instance and every visitor agrees on when the hour
 * turns over, wherever they are.
 */
export function hourBucket(now: Date | number = new Date()): number {
  const ms = typeof now === 'number' ? now : now.getTime()
  return Math.floor(ms / HOUR_MS)
}

/** Spread consecutive hour buckets across the candidate list rather than walking it in order. */
function hashBucket(bucket: number): number {
  // A 32-bit integer mix. Deterministic, cheap, and no dependency: this only needs to scatter
  // consecutive integers, not resist an attacker.
  let h = bucket | 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h = (h ^ (h >>> 16)) >>> 0
  return h
}

/**
 * Which candidate is featured this hour.
 *
 * `ids` must already be sorted — the caller sorts, so two instances holding the same set in a
 * different query order cannot disagree.
 *
 * The selection walks the list by a hashed STEP rather than jumping to a hashed position. Because
 * the step is always between 1 and n-1, consecutive hours can never land on the same article: the
 * index moves by a non-zero amount every hour, by construction.
 *
 * That construction replaced a "hash the hour, and nudge if it matches last hour's hash" approach,
 * which looked equivalent and was not. Nudging changes the article actually shown, so the next hour
 * compared itself against a raw hash that was never displayed, and a repeat could still slip
 * through — as one did, twice in eight hours, the first time this was exercised.
 *
 * The step is re-drawn daily so the order is not a fixed cycle a reader could predict, while staying
 * completely deterministic: same hour, same list, same answer, on every instance.
 */
export function pickFeaturedId(ids: number[], bucket: number): number | null {
  if (ids.length === 0) return null
  if (ids.length === 1) return ids[0]

  const n = ids.length
  const day = Math.floor(bucket / 24)
  const seed = hashBucket(day)
  const step = strideFor(n, seed)
  const index = (seed + bucket * step) % n
  return ids[index]
}

/** Greatest common divisor, for choosing a stride that reaches every candidate. */
function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b]
  return a
}

/**
 * How far to walk the candidate list each hour.
 *
 * Two properties are needed, and only strides COPRIME with the list length have both. Non-zero means
 * consecutive hours can never show the same article. Coprime means repeatedly adding the stride
 * visits every position before returning to the start, so each eligible article gets its turn.
 *
 * Picking any old value in 1..n-1 satisfies only the first. With four candidates and a stride of 2
 * the rotation alternates between two of them forever and the other two are never featured at all —
 * which is exactly what happened when this was first exercised.
 */
function strideFor(n: number, seed: number): number {
  const coprime: number[] = []
  for (let k = 1; k < n; k += 1) if (gcd(k, n) === 1) coprime.push(k)
  // n >= 2 always leaves at least k = 1, so this is never empty.
  return coprime[seed % coprime.length]
}

// --------------------------------------------------------------------------- queries

const ARTICLE_SELECT = {
  id: true, slug: true, title: true, excerpt: true, publishAt: true, body: true,
  commentCount: true, coverMediaId: true, coverAlt: true,
  authorNameSnapshot: true, authorHandleSnapshot: true,
  authorPlayer: { select: { primaryName: true, cueverseId: true } },
  category: { select: { name: true, slug: true } },
} as const

type Row = {
  id: number; slug: string; title: string; excerpt: string | null; publishAt: Date | null
  body: unknown; commentCount: number; coverMediaId: string | null; coverAlt: string | null
  authorNameSnapshot: string; authorHandleSnapshot: string | null
  authorPlayer: { primaryName: string; cueverseId: string | null } | null
  category: { name: string; slug: string } | null
}

function toArticle(row: Row): HomeArticle {
  const doc = sanitizeDocument(row.body)
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt?.trim() || deriveExcerpt(doc, 180),
    publishAt: row.publishAt!,
    categoryName: row.category?.name ?? null,
    categorySlug: row.category?.slug ?? null,
    // The live profile wins, the snapshot is the fallback — an archived author still has a byline.
    author: row.authorPlayer?.cueverseId ?? row.authorHandleSnapshot ?? row.authorPlayer?.primaryName ?? row.authorNameSnapshot,
    readingMinutes: readingTimeMinutes(doc),
    commentCount: row.commentCount,
    coverMediaId: row.coverMediaId,
    coverAlt: row.coverAlt,
  }
}

export interface HomeNews {
  featured: HomeArticle | null
  latest: HomeArticle | null
  second: HomeArticle | null
  /** How many published articles were eligible for rotation, for tests and diagnostics. */
  eligibleCount: number
  /** True when the featured slot had to reuse an article already in position 2 or 3. */
  reusedForFeatured: boolean
}

/**
 * Everything the News area needs, in one pass.
 *
 * Eligibility for the rotating slot uses the article system's existing "Feature on the homepage"
 * flag rather than a new field. When nothing has been flagged — a site that has not started
 * curating yet — every publicly visible article is eligible, because an empty hero is a worse
 * answer than an uncurated one. Flag a single article and the rotation narrows to what was chosen.
 */
export async function getHomeNews(now: Date = new Date()): Promise<HomeNews> {
  const visible = publishedWhere(now)

  // Positions 2 and 3: strictly the two most recent by actual publication time. `publishAt` is the
  // publication timestamp and never moves on a later edit, so editing an old article does not
  // bounce it back to the top of the homepage.
  const newest = await prisma.article.findMany({
    where: visible,
    orderBy: [{ publishAt: 'desc' }, { id: 'desc' }],
    take: 2,
    select: ARTICLE_SELECT,
  })

  const latest = newest[0] ? toArticle(newest[0] as Row) : null
  const second = newest[1] ? toArticle(newest[1] as Row) : null
  const shown = [latest?.id, second?.id].filter((id): id is number => id != null)

  // Candidates for the rotating slot. Ordered by id so the list is identical everywhere.
  const flagged = await prisma.article.findMany({
    where: { ...visible, featured: true },
    orderBy: { id: 'asc' },
    select: { id: true },
  })
  const anyVisible = await prisma.article.findMany({
    where: visible,
    orderBy: { id: 'asc' },
    select: { id: true },
  })
  const eligible = flagged.length > 0 ? flagged : anyVisible
  const eligibleIds = eligible.map((a) => a.id)

  // Prefer a featured article that is not already on screen. Fall back to the full eligible set only
  // when excluding positions 2 and 3 would leave nothing — better one repeat than an empty slot.
  const preferred = eligibleIds.filter((id) => !shown.includes(id))
  const pool = preferred.length > 0 ? preferred : eligibleIds
  const featuredId = pickFeaturedId(pool, hourBucket(now))

  let featured: HomeArticle | null = null
  if (featuredId != null) {
    if (featuredId === latest?.id) featured = latest
    else if (featuredId === second?.id) featured = second
    else {
      const row = await prisma.article.findUnique({ where: { id: featuredId }, select: ARTICLE_SELECT })
      featured = row ? toArticle(row as Row) : null
    }
  }

  return {
    featured,
    latest,
    second,
    eligibleCount: eligibleIds.length,
    reusedForFeatured: featuredId != null && shown.includes(featuredId),
  }
}
