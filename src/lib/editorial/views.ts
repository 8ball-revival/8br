import 'server-only'
import { prisma } from '@/lib/prisma'

/**
 * View counting.
 *
 * Two numbers are kept: a running total on the article, and a per-article-per-day tally. Nothing
 * else. No IP addresses, no visitor identifiers, no per-view rows — there is deliberately no table
 * that could answer "who read this", because the only question the site needs answered is "how many
 * people read this", and the second question does not require the first.
 *
 * Repeat views are suppressed with a cookie held in the reader's own browser rather than a record on
 * the server. It is imperfect by design: clearing cookies resets it, and that is the correct trade
 * when the alternative is keeping a log of who looked at what.
 */

/** How long a reader is remembered as having seen an article. */
export const VIEW_COOLDOWN_HOURS = 12

/** The cookie holding recently-viewed article ids. */
export const VIEW_COOKIE = 'br_seen'
const MAX_REMEMBERED = 60

/** Midnight UTC for the day a view belongs to. A single time zone keeps the daily buckets stable. */
function dayOf(when: Date): Date {
  return new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate()))
}

/**
 * Record one view.
 *
 * Written as an upsert on (articleId, day) so concurrent readers cannot lose counts to a read-then-
 * write race, and wrapped so a counting failure can never take down the article it was counting.
 */
export async function recordView(articleId: number, when: Date = new Date()): Promise<void> {
  const day = dayOf(when)
  try {
    await prisma.$transaction([
      prisma.articleDailyMetric.upsert({
        where: { articleId_day: { articleId, day } },
        create: { articleId, day, views: 1 },
        update: { views: { increment: 1 } },
      }),
      prisma.article.update({ where: { id: articleId }, data: { viewCount: { increment: 1 } } }),
    ])
  } catch {
    // A view count is not worth an error page.
  }
}

/** Parse the seen-cookie into a set of article ids. Anything malformed is treated as empty. */
export function parseSeen(raw: string | undefined): Set<number> {
  if (!raw) return new Set()
  const ids = raw
    .split('.')
    .map((part) => Number.parseInt(part, 36))
    .filter((n) => Number.isInteger(n) && n > 0)
  return new Set(ids.slice(-MAX_REMEMBERED))
}

/** Serialise a seen-set back to a compact cookie value, keeping only the most recent entries. */
export function serialiseSeen(seen: Set<number>, add: number): string {
  const list = [...seen].filter((id) => id !== add)
  list.push(add)
  return list.slice(-MAX_REMEMBERED).map((n) => n.toString(36)).join('.')
}

/** Daily view totals for an article, oldest first — the shape a sparkline needs. */
export async function dailyViews(articleId: number, days = 30) {
  const from = dayOf(new Date(Date.now() - days * 24 * 3600 * 1000))
  return prisma.articleDailyMetric.findMany({
    where: { articleId, day: { gte: from } },
    orderBy: { day: 'asc' },
    select: { day: true, views: true },
  })
}
