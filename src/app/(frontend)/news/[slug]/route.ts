import { NextResponse, type NextRequest } from 'next/server'

import { prisma } from '@/lib/prisma'
import { slugKeyOf } from '@/lib/editorial/slug-format'

/**
 * An old article URL resolves to the post it became.
 *
 * Not a blanket redirect to the feed: somebody following a link to a specific article should land on
 * that article, and dropping them at the top of a feed to find it themselves is a broken link with
 * extra steps. The migration recorded `legacyArticleId` on every post, so the mapping is a lookup
 * rather than a guess.
 *
 * The article's slug carried across unchanged, so the direct match usually wins. The legacy-id path
 * is the fallback for an article whose slug had to be altered to avoid a collision.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const key = slugKeyOf(slug)

  // There is no relation from post back to article — the link is a recorded id — so the article is
  // resolved first and its id used as the fallback match.
  const article = await prisma.article.findUnique({ where: { slugKey: key }, select: { id: true } })
    .catch(() => null)

  const post = await prisma.breakPost.findFirst({
    where: {
      OR: [
        { slugKey: key },
        { slugHistory: { some: { slugKey: key } } },
        ...(article ? [{ legacyArticleId: article.id }] : []),
      ],
    },
    select: { slug: true },
  }).catch(() => null)

  const url = request.nextUrl.clone()
  // No matching post means the feed rather than a 404 — the section still exists even if that one
  // piece does not.
  url.pathname = post ? `/the-break/${post.slug}` : '/the-break'
  return NextResponse.redirect(url, 308)
}
