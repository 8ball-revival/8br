import type { MetadataRoute } from 'next'

/**
 * /robots.txt — the site is private, so nothing is crawlable.
 *
 * This used to allow `/` and list a handful of exceptions, which was right when the site was public.
 * It is now a blanket disallow, and the sitemap reference is gone with it: advertising a sitemap for
 * a site that answers every URL with a login page only invites crawling that cannot succeed.
 *
 * ── What this does and does not do ───────────────────────────────────────────────────────────────
 * robots.txt is a request, not a control. It stops well-behaved crawlers from FETCHING; it does not
 * remove anything already held by a search engine from an earlier public crawl, and it does not stop
 * a crawler that ignores it. The wall is what actually protects the site — a crawler that fetches
 * anyway receives the private-access page, and every response carries `X-Robots-Tag: noindex`.
 *
 * Deliberately left reachable without a session: a crawler has no session, and a robots.txt behind
 * a login is a robots.txt nobody reads.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      disallow: '/',
    },
  }
}
