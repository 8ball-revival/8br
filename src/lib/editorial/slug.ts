import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { slugKeyOf, RESERVED_SLUGS, slugify, MAX_SLUG_LENGTH } from './slug-format'

/**
 * Article URLs — the database half.
 *
 * A slug is derived from the title, but it is not owned by the title: once an article has been
 * published its URL has been shared, linked and indexed, and the site is responsible for that link
 * continuing to work. So renaming a published article records the old slug in `article_slug_history`
 * and the article page redirects rather than 404ing.
 *
 * Uniqueness is enforced case-insensitively on `slugKey` (a UNIQUE index), while `slug` keeps the
 * author's casing for display. Both the live slug and every retired one share the same namespace —
 * a new article can never claim a URL that still redirects somewhere else.
 *
 * The shaping rules live in `slug-format.ts` so the editor can apply the identical ones in the
 * browser; they are re-exported here so callers only need one import.
 */
export { slugify, slugKeyOf, isValidSlug, RESERVED_SLUGS, MAX_SLUG_LENGTH } from './slug-format'

type Db = Prisma.TransactionClient | typeof prisma

/**
 * Is this slug free?
 *
 * Free means: no article holds it, and no retired slug redirects from it. `exceptArticleId` lets an
 * article keep its own slug while being edited.
 */
export async function isSlugAvailable(slug: string, exceptArticleId?: number, db: Db = prisma): Promise<boolean> {
  const key = slugKeyOf(slug)
  if (RESERVED_SLUGS.has(key)) return false

  const live = await db.article.findUnique({ where: { slugKey: key }, select: { id: true } })
  if (live && live.id !== exceptArticleId) return false

  const historic = await db.articleSlugHistory.findUnique({ where: { slugKey: key }, select: { articleId: true } })
  if (historic && historic.articleId !== exceptArticleId) return false

  return true
}

/**
 * A unique slug for a title.
 *
 * Collisions get `-2`, `-3` and so on rather than a random suffix: two articles called "Season
 * preview" should read as /news/season-preview and /news/season-preview-2, not as one of them
 * carrying a meaningless hash. The counter is bounded so a pathological run of identical titles
 * cannot loop; past that it falls back to the article's own creation counter.
 */
export async function generateUniqueSlug(
  title: string,
  exceptArticleId?: number,
  db: Db = prisma,
): Promise<string> {
  const base = slugify(title) || 'article'
  // Reserved bases get a suffix rather than being rejected — the author titled their piece "Search"
  // and that is a perfectly good title.
  const seed = RESERVED_SLUGS.has(base) || /^\d+$/.test(base) ? `${base}-article` : base

  if (await isSlugAvailable(seed, exceptArticleId, db)) return seed

  for (let n = 2; n <= 200; n += 1) {
    const suffix = `-${n}`
    const candidate = `${seed.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/g, '')}${suffix}`
    if (await isSlugAvailable(candidate, exceptArticleId, db)) return candidate
  }

  // Effectively unreachable, but a slug must always be produced: fall back to something unique by
  // construction rather than throwing on the 201st article of the same name.
  const stamp = Date.now().toString(36)
  return `${seed.slice(0, MAX_SLUG_LENGTH - stamp.length - 1).replace(/-+$/g, '')}-${stamp}`
}

/**
 * Retire the article's current slug so the old URL keeps working.
 *
 * Only called when the article has been published under that slug — an unpublished draft's slug was
 * never public, so recording it would only clutter the redirect table and reserve a URL nobody used.
 * Re-retiring a slug already in history is a no-op rather than an error, which makes the caller
 * idempotent.
 */
export async function retireSlug(articleId: number, slug: string, db: Db = prisma): Promise<void> {
  const key = slugKeyOf(slug)
  const existing = await db.articleSlugHistory.findUnique({ where: { slugKey: key }, select: { id: true, articleId: true } })
  if (existing) {
    // Another article's history claiming this key would be a bug upstream in availability checking;
    // leave it alone rather than stealing the redirect.
    return
  }
  await db.articleSlugHistory.create({ data: { articleId, slug, slugKey: key } })
}

/**
 * Resolve a URL slug to an article id, saying whether the caller arrived at the canonical URL.
 *
 * Returns `moved` when the slug is historic, so the page can issue a permanent redirect to the
 * article's current address instead of serving the same content at two URLs.
 */
export async function resolveSlug(
  slug: string,
  db: Db = prisma,
): Promise<{ articleId: number; canonicalSlug: string; moved: boolean } | null> {
  const key = slugKeyOf(slug)

  const live = await db.article.findUnique({ where: { slugKey: key }, select: { id: true, slug: true } })
  if (live) return { articleId: live.id, canonicalSlug: live.slug, moved: false }

  const historic = await db.articleSlugHistory.findUnique({
    where: { slugKey: key },
    select: { article: { select: { id: true, slug: true } } },
  })
  if (historic?.article) {
    return { articleId: historic.article.id, canonicalSlug: historic.article.slug, moved: true }
  }
  return null
}
