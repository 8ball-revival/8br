import type { HomeArticle } from './news'

/**
 * The picture that goes beside an article on the homepage.
 *
 * ── Why this is homepage configuration and not a column on the article ──────────────────────────
 * `Article` already has `coverMediaId`, and it looked like the obvious home for these. It is not:
 * that field is a filename inside the Payload media store, rendered as `/api/media/file/<id>`, and
 * the store is a Blob bucket in production. Putting a repository asset there would mean either
 * uploading the same seven files into a second storage system or teaching four existing components
 * a new URL convention — a lot of blast radius for a decision that is really about art direction.
 *
 * And art direction is what this is. These crops are 16:9, chosen for one composition, at one place
 * on one page. An article that appears here today appears in a feed, a category listing and a search
 * result tomorrow, where a different picture — or none — is the right answer. So the mapping lives
 * with the module that draws the cards, is edited in Edit Mode like every other homepage decision,
 * and no author's article is modified to make a homepage look right.
 *
 * If site-wide article covers are wanted later, `coverMediaId` is the field and the images need to
 * be in the media store; nothing here stands in the way of that.
 *
 * ── Keyed by slug, never by title ───────────────────────────────────────────────────────────────
 * A title is edited. A slug is the article's identity and is unique, so a mapping keyed by it keeps
 * pointing at the same article after somebody fixes a typo in the headline.
 */
export interface ArticleArt {
  /** Article slug this picture belongs to. */
  slug: string
  /** Rooted path under /public, or empty to fall back. */
  src: string
  /** Empty when the picture carries no information the headline does not already give. */
  alt: string
  /** `object-position`, so a face or a subject survives a hard crop. */
  focal: string
}

/** What the factory seeds, and what an Owner sees pre-filled in Edit Mode. */
export const DEFAULT_ARTICLE_ART: ArticleArt[] = [
  {
    slug: 'a-tribute-to-major-league-pool',
    src: '/assets/homepage/article-mlp-tribute.webp',
    alt: '',
    focal: '35% 50%',
  },
  {
    slug: 'top-10-active-cueverse-players-3-new-players',
    src: '/assets/homepage/article-cueverse-top-10.webp',
    alt: '',
    focal: '42% 58%',
  },
  {
    slug: '6o2-invitational-semifinals-kevin-vs-travis',
    src: '/assets/homepage/article-kevin-vs-travis.webp',
    alt: '',
    focal: '50% 55%',
  },
]

/**
 * Slugs are compared case-insensitively and without a leading slash.
 *
 * `Article.slug` keeps the author's casing while `slugKey` is the lower-cased unique one, so a
 * mapping typed by hand — or seeded from a slug that was later re-cased — has to match the way the
 * database's own uniqueness rule matches, or it silently stops finding the article.
 */
const key = (slug: string) => slug.trim().replace(/^\/+/, '').toLowerCase()

export function artFor(article: Pick<HomeArticle, 'slug'>, art: ArticleArt[]): ArticleArt | null {
  const want = key(article.slug)
  const hit = art.find((a) => key(a.slug) === want)
  return hit && hit.src.trim() ? hit : null
}
