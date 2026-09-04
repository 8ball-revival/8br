import type { MetadataRoute } from 'next'

import { absoluteUrl, SITE_URL } from '@/lib/site'
import { isSitePrivate } from '@/lib/auth/site-visibility'

/**
 * /robots.txt — the ordinary rules when the site is public, a blanket refusal when it is not.
 *
 * Reachable without a session in both cases, deliberately: a crawler has none, and a robots.txt
 * behind a login is a robots.txt nobody reads.
 *
 * It is worth being clear about what the private form does and does not do. It stops well-behaved
 * crawlers FETCHING; it removes nothing already indexed from an earlier public crawl, and it stops
 * nothing that ignores it. The wall is what actually protects the site — a crawler that fetches
 * anyway gets the private-access page, and every response carries `X-Robots-Tag: noindex`.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  if (await isSitePrivate()) {
    return { rules: { userAgent: '*', disallow: '/' } }
  }
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/account', '/login', '/admin', '/archive-review', '/api/', '/search', '/recovery'],
    },
    sitemap: absoluteUrl('/sitemap.xml'),
    host: SITE_URL,
  }
}
