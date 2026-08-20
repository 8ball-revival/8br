/**
 * How The Break orders things.
 *
 * These are OUR formulas, written for this site and documented here so anyone can see exactly what
 * they do. They are not a reproduction of any proprietary ranking system, and nothing here claims to
 * be one — the shapes are the well-known public ones (a logarithmic score with time decay for Hot,
 * a Wilson lower bound for Best) because those shapes are the right tools, not because of where
 * anyone else uses them.
 *
 * Every function is pure. That is deliberate: ordering is the part of a community site that is
 * hardest to reason about and easiest to get subtly wrong, so it is arithmetic that can be tested
 * directly rather than behaviour that can only be observed through a database.
 */

/** The Break's origin. Ages are measured from here so `hotRank` fits comfortably in a float. */
export const EPOCH_MS = Date.UTC(2026, 0, 1)

/**
 * Hot: score, weighted by how recently the post arrived.
 *
 * ── The shape ────────────────────────────────────────────────────────────────────────────────────
 *   log10(max(|score|, 1)) * sign(score)  +  age_seconds / HOT_DECAY_SECONDS
 *
 * The logarithm is what stops a runaway post from owning the feed: the first ten votes move it as
 * much as the next ninety, so a post at +200 sits near one at +100 rather than a hundred places
 * above it. The linear age term is what guarantees decay — every post gains the same amount per hour
 * simply by existing, so a newer post always catches an older one of equal score. With a 12-hour
 * constant, a day-old post needs roughly a hundred times the score of a fresh one to hold its place.
 * That is the "an old high-scorer cannot dominate forever" requirement, made arithmetic.
 *
 * ── Why comments count, but less ─────────────────────────────────────────────────────────────────
 * A post with a hundred replies and few votes is doing the thing this community is for. Comments are
 * folded in through the same logarithm at a fraction of the weight, so discussion lifts a post
 * without letting a long argument outrank everything.
 */
export const HOT_DECAY_SECONDS = 43_200 // 12 hours
export const HOT_COMMENT_WEIGHT = 0.4

export function hotRank(score: number, commentCount: number, publishedAt: Date | number): number {
  const ms = typeof publishedAt === 'number' ? publishedAt : publishedAt.getTime()
  const ageSeconds = (ms - EPOCH_MS) / 1000

  const magnitude = Math.max(Math.abs(score), 1)
  const sign = score > 0 ? 1 : score < 0 ? -1 : 0
  const voteTerm = Math.log10(magnitude) * sign

  const commentTerm = Math.log10(Math.max(commentCount, 0) + 1) * HOT_COMMENT_WEIGHT

  return round7(voteTerm + commentTerm + ageSeconds / HOT_DECAY_SECONDS)
}

/**
 * Rising: velocity inside a short window.
 *
 * Hot rewards a post that has already done well. Rising is meant to surface one that is doing well
 * RIGHT NOW — so it divides engagement by age rather than adding a time term, and refuses to
 * consider anything outside the window at all. A day-old post cannot qualify no matter how good it
 * is, which is the whole point: it has had its chance in Hot.
 *
 * The +2 on the denominator is a deliberate cold start. Without it a post two minutes old with one
 * vote divides by almost nothing and rockets to the top; with it, a post has to be a few hours old
 * or genuinely busy before it can lead.
 */
export const RISING_WINDOW_HOURS = 24

export function risingRank(
  score: number,
  commentCount: number,
  publishedAt: Date | number,
  now: Date | number = Date.now(),
): number {
  const nowMs = typeof now === 'number' ? now : now.getTime()
  const ms = typeof publishedAt === 'number' ? publishedAt : publishedAt.getTime()
  const ageHours = Math.max((nowMs - ms) / 3_600_000, 0)
  if (ageHours > RISING_WINDOW_HOURS) return 0

  const engagement = Math.max(score, 0) + Math.max(commentCount, 0) * HOT_COMMENT_WEIGHT
  return round7(engagement / (ageHours + 2))
}

/**
 * Best: the lower bound of a Wilson score interval at 95% confidence.
 *
 * ── Why not just the score ───────────────────────────────────────────────────────────────────────
 * Raw score rewards volume: a comment at +40/−30 outranks one at +9/−0, though the second is the one
 * people actually agreed with. A raw ratio has the opposite problem — 1/1 is a perfect 100% and beats
 * 99/100. Wilson asks a better question: given these votes, what is the lowest approval rate we can
 * be confident about? A single upvote answers "we cannot be confident at all", and confidence grows
 * as votes accumulate. That is why it is the default for comments.
 */
export function wilsonLowerBound(upvotes: number, downvotes: number): number {
  const n = upvotes + downvotes
  if (n === 0) return 0

  const z = 1.959964 // 95%
  const phat = upvotes / n
  const z2 = z * z

  const numerator = phat + z2 / (2 * n) - z * Math.sqrt((phat * (1 - phat) + z2 / (4 * n)) / n)
  const denominator = 1 + z2 / n
  return round7(numerator / denominator)
}

/**
 * Controversial: heavily voted AND close to evenly split.
 *
 * A merely unpopular comment is not controversial — it is unpopular, and it belongs at the bottom of
 * Top where it already is. Controversy is disagreement, so this needs both sides present: the
 * magnitude term rewards total votes, and the balance term collapses towards zero as the split moves
 * away from even. A comment at +50/−48 scores far above one at +2/−40.
 */
export function controversyRank(upvotes: number, downvotes: number): number {
  const n = upvotes + downvotes
  if (n === 0 || upvotes === 0 || downvotes === 0) return 0

  const balance = upvotes > downvotes ? downvotes / upvotes : upvotes / downvotes
  return round7(Math.pow(n, balance))
}

/**
 * Seven decimal places.
 *
 * These values are stored in a float column and used as a sort key. Rounding them to a fixed
 * precision keeps the ordering stable across recomputations, so a post does not silently swap places
 * with its neighbour because of a difference in the fifteenth digit.
 */
function round7(v: number): number {
  return Math.round(v * 1e7) / 1e7
}

/** The Top windows, as documented in the toolbar. */
export type TopWindow = 'today' | 'week' | 'month' | 'year' | 'all'

export const TOP_WINDOWS: { key: TopWindow; label: string; hours: number | null }[] = [
  { key: 'today', label: 'Today', hours: 24 },
  { key: 'week', label: 'This Week', hours: 24 * 7 },
  { key: 'month', label: 'This Month', hours: 24 * 30 },
  { key: 'year', label: 'This Year', hours: 24 * 365 },
  { key: 'all', label: 'All Time', hours: null },
]

/** The earliest publication date a Top window includes, or null for all time. */
export function topWindowStart(window: TopWindow, now: Date = new Date()): Date | null {
  const entry = TOP_WINDOWS.find((w) => w.key === window)
  if (!entry || entry.hours == null) return null
  return new Date(now.getTime() - entry.hours * 3_600_000)
}

export type FeedSort = 'hot' | 'new' | 'top' | 'rising'
export const FEED_SORTS: FeedSort[] = ['hot', 'new', 'top', 'rising']
export const DEFAULT_FEED_SORT: FeedSort = 'hot'

export type CommentSort = 'best' | 'top' | 'new' | 'old' | 'controversial'
export const COMMENT_SORTS: CommentSort[] = ['best', 'top', 'new', 'old', 'controversial']
export const DEFAULT_COMMENT_SORT: CommentSort = 'best'

export type SearchSort = 'relevance' | 'hot' | 'top' | 'new' | 'comments'
export const SEARCH_SORTS: SearchSort[] = ['relevance', 'hot', 'top', 'new', 'comments']
