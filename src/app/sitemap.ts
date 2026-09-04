import type { MetadataRoute } from 'next'

import { absoluteUrl } from '@/lib/site'
import { prisma } from '@/lib/prisma'
import { publishedWhere } from '@/lib/editorial/service'
import { listArchiveMonths } from '@/lib/editorial/queries'
import { isSitePrivate } from '@/lib/auth/site-visibility'

/**
 * /sitemap.xml — the public, indexable routes.
 *
 * Private (account/login) and internal (admin) routes are excluded on purpose. The editorial
 * entries are read from the database rather than listed by hand, so an article appears in the
 * sitemap when it becomes visible and a scheduled one stays out until it is due — the same
 * `publishedWhere()` rule the pages themselves use.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  /*
    Nothing at all while the site is private.

    This route is a data endpoint in its own right: it queries for every visible article, category,
    tag and page, so left running behind the wall it would hand an unauthenticated reader the slug,
    the date and the existence of everything on the site without opening one page. Returning early
    also means none of those queries run.
  */
  if (await isSitePrivate()) return []

  const routes = [
    { path: '/', priority: 1 },
    { path: '/register', priority: 0.9 },
    { path: '/groups', priority: 0.7 },
    { path: '/playoffs', priority: 0.7 },
    { path: '/seasons', priority: 0.7 },
    { path: '/seasons/ego-tournament-1', priority: 0.6 },
    { path: '/competitions', priority: 0.4 },
    { path: '/players', priority: 0.4 },
    { path: '/rankings', priority: 0.4 },
    { path: '/hall-of-fame', priority: 0.4 },
    { path: '/news', priority: 0.8 },
    { path: '/news/archive', priority: 0.3 },
    { path: '/news/authors', priority: 0.3 },
  ]

  const base: MetadataRoute.Sitemap = routes.map((r) => ({
    url: absoluteUrl(r.path),
    changeFrequency: 'weekly' as const,
    priority: r.priority,
  }))

  // A sitemap must never be the reason a page fails to build, so a database that is unreachable at
  // build time yields the static routes rather than an error.
  try {
    const [articles, categories, tags, months, pages] = await Promise.all([
      prisma.article.findMany({
        where: publishedWhere(),
        orderBy: [{ publishAt: 'desc' }],
        take: 2000,
        select: { slug: true, updatedAt: true },
      }),
      prisma.articleCategory.findMany({ where: { active: true }, select: { slug: true } }),
      prisma.articleTag.findMany({
        where: { articles: { some: { article: publishedWhere() } } },
        select: { slug: true },
      }),
      listArchiveMonths(),
      // Pages carry the same (state, publishAt) visibility rule as articles, but a different model,
      // so the predicate is spelled out rather than shared.
      prisma.editorialPage.findMany({
        where: { state: 'PUBLISHED', publishAt: { not: null, lte: new Date() } },
        select: { slug: true, updatedAt: true },
      }),
    ])

    return [
      ...base,
      ...articles.map((a) => ({
        url: absoluteUrl(`/news/${a.slug}`),
        lastModified: a.updatedAt,
        changeFrequency: 'monthly' as const,
        priority: 0.6,
      })),
      ...categories.map((c) => ({
        url: absoluteUrl(`/news/category/${c.slug}`),
        changeFrequency: 'weekly' as const,
        priority: 0.4,
      })),
      ...tags.map((t) => ({
        url: absoluteUrl(`/news/tag/${t.slug}`),
        changeFrequency: 'monthly' as const,
        priority: 0.3,
      })),
      ...months.map((m) => ({
        url: absoluteUrl(`/news/archive/${m.year}/${String(m.month).padStart(2, '0')}`),
        changeFrequency: 'monthly' as const,
        priority: 0.2,
      })),
      ...pages.map((p) => ({
        url: absoluteUrl(`/pages/${p.slug}`),
        lastModified: p.updatedAt,
        changeFrequency: 'monthly' as const,
        priority: 0.4,
      })),
    ]
  } catch {
    return base
  }
}
