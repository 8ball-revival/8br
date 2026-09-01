import 'server-only'
import { prisma } from '@/lib/prisma'
import { publicPostWhere } from '@/lib/break/feed'
import type { HomeArticle } from './news'

/**
 * The newest posts from The Break, for the homepage.
 *
 * ── Why this exists at all ──────────────────────────────────────────────────────────────────────
 * The homepage read `getHomeNews`, which queries the legacy `Article` table. That table holds three
 * rows and has held three rows since The Break replaced it: every post written since lives in
 * `BreakPost`. So the panel was not stale in the sense of caching — it was reading a different,
 * frozen table, and no amount of publishing could ever change what it showed.
 *
 * The symptom was reported as "there are newer posts and it isn't working", which is exactly right:
 * five published posts were invisible to it.
 *
 * ── Visibility is not re-derived here ───────────────────────────────────────────────────────────
 * `publicPostWhere` is the one predicate every feed, search and count already uses — PUBLISHED, not
 * removed, not deleted, and past its publication time. Writing those four conditions out again is
 * how one surface eventually forgets `removedAt` and leaks removed content onto the front page.
 */

/** A post as the homepage needs it: the article shape, plus whatever picture the post itself has. */
export type HomePost = HomeArticle & {
  /** The post's own first ready image, or null when it has none. */
  imageUrl: string | null
  imageAlt: string | null
}

export async function latestBreakPosts(limit = 3): Promise<HomePost[]> {
  const rows = await prisma.breakPost.findMany({
    where: publicPostWhere(),
    // `id` breaks a tie so two posts published in the same second cannot swap places between renders.
    orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    take: Math.max(1, Math.min(12, limit)),
    select: {
      id: true, slug: true, title: true, bodyText: true, publishedAt: true, commentCount: true,
      authorNameSnapshot: true,
      category: { select: { name: true, slug: true } },
      media: {
        where: { kind: 'IMAGE', status: 'READY' },
        orderBy: { position: 'asc' },
        take: 1,
        select: { url: true, alt: true },
      },
    },
  })

  return rows.map((p) => {
    const text = (p.bodyText ?? '').replace(/\s+/g, ' ').trim()
    const image = p.media[0] ?? null
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      excerpt: text.length > 200 ? `${text.slice(0, 200).replace(/\s+\S*$/, '')}…` : text,
      // A published post always has a date; the fallback keeps the type honest rather than asserting.
      publishAt: p.publishedAt ?? new Date(),
      categoryName: p.category?.name ?? null,
      categorySlug: p.category?.slug ?? null,
      author: p.authorNameSnapshot,
      readingMinutes: Math.max(1, Math.round(text.split(' ').filter(Boolean).length / 200)),
      commentCount: p.commentCount,
      // Legacy article fields. The Break stores its picture as a servable URL, not a media id, so
      // these stay null and `imageUrl` carries the picture instead.
      coverMediaId: null,
      coverAlt: null,
      imageUrl: image?.url ?? null,
      imageAlt: image?.alt ?? null,
    }
  })
}
