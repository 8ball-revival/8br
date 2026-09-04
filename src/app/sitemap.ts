import type { MetadataRoute } from 'next'

/**
 * /sitemap.xml — empty, because the site is private.
 *
 * This used to enumerate every public route AND query the database for every visible article, which
 * made it a data endpoint in its own right: an unauthenticated reader could learn the slug, the
 * publication date and the existence of every article, season and player page without opening one.
 *
 * It returns nothing now rather than being deleted, because a route that 404s and a route that
 * returns an empty list are both fine — but a deleted file is one someone restores from the old
 * version, database query and all. An empty sitemap is a statement.
 *
 * The wall also protects this path (`/sitemap.xml` is on the data list, so an unauthenticated
 * request gets 401 rather than an empty document), and `robots.txt` no longer advertises it. This
 * is the third of the three, and the one that guarantees no query runs even if the other two are
 * changed.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return []
}
