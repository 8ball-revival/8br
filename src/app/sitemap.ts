import type { MetadataRoute } from 'next'

import { absoluteUrl } from '@/lib/site'

/**
 * /sitemap.xml — the public, indexable routes. Private (account/login) and internal
 * (admin/archive-review/search) routes are intentionally excluded. Tournament 1 is the
 * only real tournament detail page currently published.
 */
export default function sitemap(): MetadataRoute.Sitemap {
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
    { path: '/news', priority: 0.4 },
  ]
  return routes.map((r) => ({
    url: absoluteUrl(r.path),
    changeFrequency: 'weekly' as const,
    priority: r.priority,
  }))
}
