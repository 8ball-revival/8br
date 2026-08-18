import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { currentEditorialActor } from '@/lib/editorial/permissions'
import { sanitizeDocument, serializeArticleBody } from '@/lib/editorial/richtext'

/**
 * Administrator-only export of everything The Break holds.
 *
 * Content, not internals: articles with their bodies in the authoring format, categories, tags,
 * comments and standalone pages. Bodies are re-validated and serialised back to the format an author
 * types, so the export is readable and could be re-imported without carrying node-tree details that
 * only mean something to this codebase.
 *
 * Deliberately excluded: moderation records, comment reports, view metrics and revision history.
 * Those hold moderator reasoning and reporter identities — internal working material rather than
 * published content — and an export is a file that leaves the building.
 */
export async function GET() {
  const actor = await currentEditorialActor()
  // Not 403 for a signed-out visitor either: an endpoint like this should not confirm it exists.
  if (!actor?.isAdmin) return new NextResponse('Not found', { status: 404 })

  const [articles, categories, tags, comments, pages] = await Promise.all([
    prisma.article.findMany({
      orderBy: [{ id: 'asc' }],
      select: {
        id: true, slug: true, title: true, excerpt: true, body: true, state: true,
        publishAt: true, publishedAt: true, createdAt: true, updatedAt: true,
        official: true, featured: true, pinned: true, commentsEnabled: true, commentsLocked: true,
        seoTitle: true, seoDescription: true, canonicalUrl: true, coverMediaId: true, coverAlt: true,
        viewCount: true, commentCount: true,
        authorNameSnapshot: true, authorHandleSnapshot: true,
        authorPlayer: { select: { id: true, primaryName: true, cueverseId: true } },
        category: { select: { slug: true, name: true } },
        tags: { select: { tag: { select: { slug: true, name: true } } } },
        slugHistory: { select: { slug: true, createdAt: true } },
      },
    }),
    prisma.articleCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }],
      select: { slug: true, name: true, description: true, adminOnly: true, active: true, sortOrder: true },
    }),
    prisma.articleTag.findMany({ orderBy: [{ slug: 'asc' }], select: { slug: true, name: true } }),
    prisma.articleComment.findMany({
      orderBy: [{ id: 'asc' }],
      select: {
        id: true, articleId: true, parentId: true, body: true, createdAt: true, editedAt: true,
        deletedAt: true, hiddenAt: true, authorNameSnapshot: true,
        authorPlayer: { select: { id: true, cueverseId: true } },
      },
    }),
    prisma.editorialPage.findMany({
      orderBy: [{ slug: 'asc' }],
      select: {
        slug: true, title: true, body: true, excerpt: true, state: true, publishAt: true,
        showInNav: true, navOrder: true, createdAt: true, updatedAt: true,
      },
    }),
  ])

  const payload = {
    exportedAt: new Date().toISOString(),
    format: 'the-break/v1',
    counts: {
      articles: articles.length,
      categories: categories.length,
      tags: tags.length,
      comments: comments.length,
      pages: pages.length,
    },
    categories,
    tags: tags.map((t) => ({ slug: t.slug, name: t.name })),
    articles: articles.map((a) => ({
      ...a,
      body: serializeArticleBody(sanitizeDocument(a.body)),
      author: a.authorPlayer
        ? { playerId: a.authorPlayer.id, name: a.authorPlayer.primaryName, handle: a.authorPlayer.cueverseId }
        : { playerId: null, name: a.authorNameSnapshot, handle: a.authorHandleSnapshot },
      authorPlayer: undefined,
      tags: a.tags.map((t) => t.tag.slug),
      previousSlugs: a.slugHistory.map((h) => h.slug),
      slugHistory: undefined,
    })),
    comments: comments.map((c) => ({
      ...c,
      // Removed comments export as tombstones: the thread's shape is content, the deleted words are not.
      body: c.deletedAt || c.hiddenAt ? '' : c.body,
      author: c.authorPlayer
        ? { playerId: c.authorPlayer.id, handle: c.authorPlayer.cueverseId }
        : { playerId: null, handle: c.authorNameSnapshot },
      authorPlayer: undefined,
    })),
    pages: pages.map((p) => ({ ...p, body: serializeArticleBody(sanitizeDocument(p.body)) })),
  }

  const stamp = new Date().toISOString().slice(0, 10)
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="the-break-${stamp}.json"`,
      'cache-control': 'no-store',
    },
  })
}
