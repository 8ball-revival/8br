import type { MetadataRoute } from 'next'

import { absoluteUrl, SITE_URL } from '@/lib/site'

/** /robots.txt — allow public pages; keep private/account/admin/internal routes out. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/account', '/login', '/admin', '/archive-review', '/api/', '/search'],
    },
    sitemap: absoluteUrl('/sitemap.xml'),
    host: SITE_URL,
  }
}
