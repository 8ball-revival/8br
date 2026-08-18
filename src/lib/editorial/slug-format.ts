/**
 * Article URLs — the pure half.
 *
 * Slug shaping, validation and the reserved list, with no database access, so the editor can use
 * exactly the same rules in the browser that the server will apply. Availability lives in `slug.ts`
 * next door, because only the server can answer that.
 */

/** Longest slug we will generate. Long enough to stay readable, short enough for a tidy URL. */
export const MAX_SLUG_LENGTH = 80

/**
 * Words that would collide with a route under /news, plus a few that would be confusing.
 *
 * Checked against the whole slug rather than its first segment, because article slugs have no
 * segments — /news/<slug> is the entire shape.
 */
export const RESERVED_SLUGS = new Set([
  'new', 'edit', 'mine', 'drafts', 'draft', 'preview', 'search', 'page', 'feed', 'rss', 'atom',
  'sitemap', 'category', 'categories', 'tag', 'tags', 'author', 'authors', 'archive', 'archives',
  'moderation', 'settings', 'export', 'admin', 'api', 'comment', 'comments', 'report', 'reports',
  'about', 'index', 'all', 'official', 'featured',
])

/**
 * Turn arbitrary text into a URL fragment.
 *
 * Accented Latin is folded to ASCII so "Peña" becomes "pena" rather than being deleted. Text with no
 * Latin characters at all — a title written entirely in another script — folds to nothing, which the
 * caller handles by falling back to a generic slug rather than producing an empty URL.
 */
export function slugify(input: string): string {
  return String(input ?? '')
    .normalize('NFKD')
    // Drop combining marks left behind by the decomposition above.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['\u2018\u2019\u02bc`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '')
}

/** The case-insensitive uniqueness key for a slug. */
export const slugKeyOf = (slug: string): string => slug.trim().toLowerCase()

/** A slug is well-formed if it survives its own slugify unchanged and is not reserved. */
export function isValidSlug(slug: string): boolean {
  if (!slug || slug.length > MAX_SLUG_LENGTH) return false
  if (RESERVED_SLUGS.has(slugKeyOf(slug))) return false
  // A purely numeric slug would be indistinguishable from an id in a URL.
  if (/^\d+$/.test(slug)) return false
  return slugify(slug) === slugKeyOf(slug)
}

