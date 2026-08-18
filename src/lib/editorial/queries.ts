import 'server-only'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { publishedWhere } from './service'
import { sanitizeDocument, readingTimeMinutes, type RichDocument } from './richtext'
import { slugKeyOf } from './slug'
import { resolveCanonicalPlayerIds, mergedSecondaryPlayerIds } from '@/lib/players/merge'
import { authoredPlayerIds, type EditorialActor } from './permissions'

/**
 * Reads for The Break.
 *
 * Every public query starts from `publishedWhere()` rather than testing state itself, so there is
 * one definition of visibility and a scheduled article cannot leak through a listing that forgot to
 * check the clock. The read model is deliberately flat — a card is the shape the listings need, an
 * article page loads a little more — because these queries run on nearly every page of the site.
 */

export const PAGE_SIZE = 12

export interface ArticleCard {
  id: number
  slug: string
  title: string
  excerpt: string | null
  publishAt: Date | null
  official: boolean
  featured: boolean
  pinned: boolean
  commentCount: number
  viewCount: number
  readingMinutes: number
  coverMediaId: string | null
  coverAlt: string | null
  author: { playerId: string | null; name: string; handle: string | null }
  category: { id: number; slug: string; name: string; adminOnly: boolean } | null
  tags: { slug: string; name: string }[]
}

const CARD_SELECT = {
  id: true, slug: true, title: true, excerpt: true, publishAt: true, official: true,
  featured: true, pinned: true, commentCount: true, viewCount: true, body: true,
  coverMediaId: true, coverAlt: true,
  authorPlayerId: true, authorNameSnapshot: true, authorHandleSnapshot: true,
  authorPlayer: { select: { primaryName: true, cueverseId: true } },
  category: { select: { id: true, slug: true, name: true, adminOnly: true } },
  tags: { select: { tag: { select: { slug: true, name: true } } } },
} satisfies Prisma.ArticleSelect

type CardRow = Prisma.ArticleGetPayload<{ select: typeof CARD_SELECT }>

/**
 * Turn a row into a card.
 *
 * The byline prefers the live profile and falls back to the snapshot taken at publication. That
 * ordering is deliberate: a member who changes their CueVerse ID should see the new one on their
 * back catalogue, while an archived author still has a name rather than a blank.
 */
function toCard(row: CardRow): ArticleCard {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    publishAt: row.publishAt,
    official: row.official,
    featured: row.featured,
    pinned: row.pinned,
    commentCount: row.commentCount,
    viewCount: row.viewCount,
    readingMinutes: readingTimeMinutes(sanitizeDocument(row.body)),
    coverMediaId: row.coverMediaId,
    coverAlt: row.coverAlt,
    author: {
      playerId: row.authorPlayerId,
      name: row.authorPlayer?.primaryName ?? row.authorNameSnapshot,
      handle: row.authorPlayer?.cueverseId ?? row.authorHandleSnapshot,
    },
    category: row.category,
    tags: row.tags.map((t) => t.tag),
  }
}

// --------------------------------------------------------------------------- listings

export interface ListFilters {
  page?: number
  categorySlug?: string
  tagSlug?: string
  /**
   * One or more player ids. More than one because an account merge does not repoint rows: a
   * member's back catalogue is their canonical id plus every profile merged into it.
   */
  authorPlayerIds?: string[]
  /** Free text across title, excerpt and author. */
  search?: string
  year?: number
  month?: number
  /** Official News only. */
  officialOnly?: boolean
  /** Put pinned articles first. The index does; a filtered view does not. */
  honourPins?: boolean
  /** Reading order. Newest first when unset. */
  sort?: ArticleSort
}

/**
 * The orders the News index can be read in.
 *
 * Author sorting uses the SNAPSHOT columns on the article rather than a join to the player. Two
 * reasons: it sorts on the byline actually printed on the card, so the order matches what a reader
 * sees; and a historical article keeps the name it was published under even if that member later
 * changes their CueVerse ID.
 */
export type ArticleSort = 'newest' | 'oldest' | 'author' | 'author-desc'

export const ARTICLE_SORTS: { id: ArticleSort; label: string }[] = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'author', label: 'Author A–Z' },
  { id: 'author-desc', label: 'Author Z–A' },
]

export function parseArticleSort(value: string | null | undefined): ArticleSort {
  return ARTICLE_SORTS.some((s) => s.id === value) ? value as ArticleSort : 'newest'
}

export interface ArticlePage {
  items: ArticleCard[]
  total: number
  page: number
  pageCount: number
}

/** Build the WHERE for a public listing from user-supplied filters. */
function listWhere(filters: ListFilters, now: Date): Prisma.ArticleWhereInput {
  const where: Prisma.ArticleWhereInput = { ...publishedWhere(now) }
  const and: Prisma.ArticleWhereInput[] = []

  if (filters.categorySlug) and.push({ category: { slug: slugKeyOf(filters.categorySlug) } })
  if (filters.tagSlug) and.push({ tags: { some: { tag: { slug: slugKeyOf(filters.tagSlug) } } } })
  if (filters.authorPlayerIds?.length) and.push({ authorPlayerId: { in: filters.authorPlayerIds } })
  if (filters.officialOnly) and.push({ official: true })

  if (filters.year) {
    // A month window, or the whole year when no month is given. Built from explicit UTC boundaries
    // rather than string matching so the index on publishAt is still usable.
    const from = new Date(Date.UTC(filters.year, (filters.month ?? 1) - 1, 1))
    const to = filters.month
      ? new Date(Date.UTC(filters.year, filters.month, 1))
      : new Date(Date.UTC(filters.year + 1, 0, 1))
    and.push({ publishAt: { gte: from, lt: to } })
  }

  const term = (filters.search ?? '').trim().slice(0, 120)
  if (term) {
    and.push({
      OR: [
        { title: { contains: term, mode: 'insensitive' } },
        { excerpt: { contains: term, mode: 'insensitive' } },
        { authorNameSnapshot: { contains: term, mode: 'insensitive' } },
        { authorHandleSnapshot: { contains: term, mode: 'insensitive' } },
        { tags: { some: { tag: { name: { contains: term, mode: 'insensitive' } } } } },
      ],
    })
  }

  if (and.length) where.AND = and
  return where
}

/**
 * A page of articles ordered by author name.
 *
 * Sorted in JavaScript rather than by the database, because this database was created with the `C`
 * collation — plain byte order, in which every capitalised name sorts before every lowercase one.
 * Under it "Author A-Z" would list Starkiller before sixohtwo, which reads as broken. Postgres would
 * need `ORDER BY lower(...)` and Prisma cannot express an expression in `orderBy`, so the comparison
 * happens here with `localeCompare`, which is case-insensitive and handles accents properly too.
 *
 * That means reading the id and byline of every matching article to order them before slicing out a
 * page. It is four small columns and no joins, which is comfortably affordable at this scale, and it
 * is the only way to page correctly: sorting just the rows of one page would order that page
 * internally while leaving the wrong articles ON it.
 */
async function listByAuthor(
  where: Prisma.ArticleWhereInput,
  sort: 'author' | 'author-desc',
  page: number,
): Promise<ArticlePage> {
  const direction = sort === 'author' ? 1 : -1

  const all = await prisma.article.findMany({
    where,
    select: { id: true, authorHandleSnapshot: true, authorNameSnapshot: true, publishAt: true },
  })

  const nameOf = (a: typeof all[number]) =>
    (a.authorHandleSnapshot ?? a.authorNameSnapshot ?? '').trim()

  all.sort((a, b) => {
    const an = nameOf(a)
    const bn = nameOf(b)
    // An article with no recorded byline sorts last in both directions, rather than leading the list
    // as an empty string would.
    if (!an && !bn) return 0
    if (!an) return 1
    if (!bn) return -1

    const byName = an.localeCompare(bn, undefined, { sensitivity: 'base' })
    if (byName !== 0) return byName * direction

    // Within one author, newest first, then id so paging cannot repeat or drop an article.
    const at = a.publishAt?.getTime() ?? 0
    const bt = b.publishAt?.getTime() ?? 0
    return bt - at || b.id - a.id
  })

  const pageIds = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((a) => a.id)
  const rows = pageIds.length
    ? await prisma.article.findMany({ where: { id: { in: pageIds } }, select: CARD_SELECT })
    : []

  // `IN` returns rows in whatever order it likes, so restore the order that was just computed.
  const byId = new Map(rows.map((r) => [r.id, r]))
  const items = pageIds.map((id) => byId.get(id)).filter((r) => r != null).map(toCard)

  return {
    items,
    total: all.length,
    page,
    pageCount: Math.max(1, Math.ceil(all.length / PAGE_SIZE)),
  }
}

/** One page of published articles, newest first. */
export async function listArticles(filters: ListFilters = {}): Promise<ArticlePage> {
  const now = new Date()
  const page = Math.max(1, Math.trunc(filters.page ?? 1))
  const where = listWhere(filters, now)

  const sort = filters.sort ?? 'newest'

  // Pins lead only the default reading order. Asking for "Author A–Z" and getting the pinned articles
  // first regardless would not be the order that was asked for.
  const pinsFirst: Prisma.ArticleOrderByWithRelationInput[] =
    filters.honourPins && sort === 'newest' ? [{ pinned: 'desc' }, { pinOrder: 'asc' }] : []

  // `id` is the final tie-break in every order, so paging is stable: without it two articles sharing a
  // timestamp could swap between pages and one would be shown twice while another vanished.
  const orderBy: Prisma.ArticleOrderByWithRelationInput[] = [
    ...pinsFirst,
    ...(sort === 'oldest' ? [{ publishAt: 'asc' as const }] : [{ publishAt: 'desc' as const }]),
    { id: 'desc' },
  ]

  if (sort === 'author' || sort === 'author-desc') {
    return listByAuthor(where, sort, page)
  }

  const [total, rows] = await Promise.all([
    prisma.article.count({ where }),
    prisma.article.findMany({
      where, orderBy, select: CARD_SELECT,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ])

  return {
    items: rows.map(toCard),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  }
}

// --------------------------------------------------------------------------- one article

export interface ArticleDetail extends ArticleCard {
  body: RichDocument
  commentsEnabled: boolean
  commentsLocked: boolean
  seoTitle: string | null
  seoDescription: string | null
  canonicalUrl: string | null
  publishedAt: Date | null
  updatedAt: Date
  state: string
  relations: {
    competitions: { id: number; name: string }[]
    seasons: { id: number; number: number; competitionYear: number; subtitle: string | null }[]
    tournaments: { id: number; name: string }[]
    players: { id: string; primaryName: string; cueverseId: string | null }[]
  }
}

/**
 * Load one article by id, with everything the article page needs.
 *
 * Visibility is NOT decided here — the caller knows whether it is rendering for the public, for the
 * author, or for a preview link, and passing that decision down would mean this function had to be
 * trusted to get it right in three different contexts.
 */
export async function getArticleById(id: number): Promise<ArticleDetail | null> {
  const row = await prisma.article.findUnique({
    where: { id },
    select: {
      ...CARD_SELECT,
      state: true, commentsEnabled: true, commentsLocked: true,
      seoTitle: true, seoDescription: true, canonicalUrl: true,
      publishedAt: true, updatedAt: true,
      relations: {
        select: {
          competitionSeries: { select: { id: true, name: true } },
          season: { select: { id: true, number: true, competitionYear: true, subtitle: true } },
          tournament: { select: { id: true, name: true } },
          player: { select: { id: true, primaryName: true, cueverseId: true } },
        },
      },
    },
  })
  if (!row) return null

  return {
    ...toCard(row),
    body: sanitizeDocument(row.body),
    state: row.state,
    commentsEnabled: row.commentsEnabled,
    commentsLocked: row.commentsLocked,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    canonicalUrl: row.canonicalUrl,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
    relations: {
      competitions: row.relations.map((r) => r.competitionSeries).filter((x) => x != null),
      seasons: row.relations.map((r) => r.season).filter((x) => x != null),
      tournaments: row.relations.map((r) => r.tournament).filter((x) => x != null),
      players: row.relations.map((r) => r.player).filter((x) => x != null),
    },
  }
}

/**
 * Articles a reader is likely to want next.
 *
 * Same category first, then anything else recent, and never the article they are already reading.
 * Simple on purpose: a recommendation engine would need behaviour data the site deliberately does
 * not collect.
 */
export async function relatedArticles(articleId: number, categoryId: number | null, limit = 3): Promise<ArticleCard[]> {
  const now = new Date()
  const base = { ...publishedWhere(now), id: { not: articleId } }

  const sameCategory = categoryId
    ? await prisma.article.findMany({
      where: { ...base, categoryId },
      orderBy: [{ publishAt: 'desc' }], take: limit, select: CARD_SELECT,
    })
    : []

  if (sameCategory.length >= limit) return sameCategory.map(toCard)

  const filler = await prisma.article.findMany({
    where: { ...base, id: { notIn: [articleId, ...sameCategory.map((a) => a.id)] } },
    orderBy: [{ publishAt: 'desc' }],
    take: limit - sameCategory.length,
    select: CARD_SELECT,
  })
  return [...sameCategory, ...filler].map(toCard)
}

// --------------------------------------------------------------------------- homepage

export interface HomepageEditorial {
  featured: ArticleCard | null
  latest: ArticleCard[]
  official: ArticleCard[]
  predictions: ArticleCard[]
  community: ArticleCard[]
  discussed: ArticleCard[]
  settings: {
    showFeatured: boolean
    showOfficial: boolean
    showPredictions: boolean
    showCommunity: boolean
    showDiscussed: boolean
  }
}

/**
 * Everything the homepage editorial band needs, in one pass.
 *
 * Each section is capped and every one of them is allowed to be empty: a brand-new site with no
 * articles must render a homepage that looks deliberate rather than broken, so the caller hides an
 * empty section instead of showing a placeholder.
 */
export async function getHomepageEditorial(): Promise<HomepageEditorial> {
  const now = new Date()
  const visible = publishedWhere(now)
  const settings = await getEditorialSettings()

  const pick = (where: Prisma.ArticleWhereInput, take: number, orderBy: Prisma.ArticleOrderByWithRelationInput[]) =>
    prisma.article.findMany({ where: { ...visible, ...where }, orderBy, take, select: CARD_SELECT })

  const byDate: Prisma.ArticleOrderByWithRelationInput[] = [{ publishAt: 'desc' }, { id: 'desc' }]

  const [chosen, featuredFallback, latest, official, predictions, community, discussed] = await Promise.all([
    settings.featuredArticleId
      ? prisma.article.findFirst({ where: { ...visible, id: settings.featuredArticleId }, select: CARD_SELECT })
      : Promise.resolve(null),
    pick({ featured: true }, 1, byDate),
    pick({}, 5, [{ pinned: 'desc' }, { pinOrder: 'asc' }, ...byDate]),
    pick({ official: true }, 3, byDate),
    pick({ category: { slug: 'predictions' } }, 3, byDate),
    pick({ category: { slug: 'community' } }, 3, byDate),
    // "Most discussed" is scoped to the last 30 days so an old thread does not sit there forever.
    pick(
      { commentCount: { gt: 0 }, publishAt: { gte: new Date(now.getTime() - 30 * 24 * 3600 * 1000), lte: now } },
      3,
      [{ commentCount: 'desc' }, { publishAt: 'desc' }],
    ),
  ])

  // An explicitly chosen article wins; otherwise the newest one flagged as featured.
  const featuredRow = chosen ?? featuredFallback[0] ?? null

  return {
    featured: featuredRow ? toCard(featuredRow) : null,
    // Never show the featured article twice in the same band.
    latest: latest.filter((a) => a.id !== featuredRow?.id).slice(0, 4).map(toCard),
    official: official.map(toCard),
    predictions: predictions.map(toCard),
    community: community.map(toCard),
    discussed: discussed.map(toCard),
    settings: {
      showFeatured: settings.showFeatured,
      showOfficial: settings.showOfficial,
      showPredictions: settings.showPredictions,
      showCommunity: settings.showCommunity,
      showDiscussed: settings.showDiscussed,
    },
  }
}

/** The settings singleton, created on first use so the homepage never depends on a seed having run. */
export async function getEditorialSettings() {
  return prisma.editorialSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} })
}

// --------------------------------------------------------------------------- facets

export async function listCategories(includeEmpty = true) {
  const rows = await prisma.articleCategory.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true, slug: true, name: true, description: true, adminOnly: true,
      _count: { select: { articles: { where: publishedWhere() } } },
    },
  })
  const mapped = rows.map((r) => ({ ...r, articleCount: r._count.articles }))
  return includeEmpty ? mapped : mapped.filter((r) => r.articleCount > 0)
}

export async function listTags(limit = 40) {
  const rows = await prisma.articleTag.findMany({
    select: { slug: true, name: true, _count: { select: { articles: true } } },
    orderBy: { name: 'asc' },
  })
  return rows
    .map((r) => ({ slug: r.slug, name: r.name, articleCount: r._count.articles }))
    .filter((r) => r.articleCount > 0)
    .sort((a, b) => b.articleCount - a.articleCount || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/** Authors with at least one published article, most prolific first. */
export async function listAuthors() {
  const grouped = await prisma.article.groupBy({
    by: ['authorPlayerId'],
    where: publishedWhere(),
    _count: { _all: true },
    _max: { publishAt: true },
  })
  const ids = grouped.map((g) => g.authorPlayerId).filter((id): id is string => id != null)
  if (!ids.length) return []

  // Roll each row up to the surviving profile, so a member who has been merged appears once with a
  // complete count rather than twice with half of one each.
  const canonical = await resolveCanonicalPlayerIds(ids)
  const totals = new Map<string, { count: number; last: Date | null }>()
  for (const g of grouped) {
    if (!g.authorPlayerId) continue
    const key = canonical.get(g.authorPlayerId) ?? g.authorPlayerId
    const acc = totals.get(key) ?? { count: 0, last: null }
    acc.count += g._count._all
    if (g._max.publishAt && (!acc.last || g._max.publishAt > acc.last)) acc.last = g._max.publishAt
    totals.set(key, acc)
  }

  const players = await prisma.player.findMany({
    where: { id: { in: [...totals.keys()] } },
    select: { id: true, primaryName: true, cueverseId: true, blogTrustedAuthor: true },
  })

  return players
    .map((p) => ({
      playerId: p.id,
      name: p.primaryName,
      handle: p.cueverseId,
      trusted: p.blogTrustedAuthor,
      articleCount: totals.get(p.id)!.count,
      lastPublishedAt: totals.get(p.id)!.last,
    }))
    .sort((a, b) => b.articleCount - a.articleCount || a.name.localeCompare(b.name))
}

/**
 * Months that have at least one published article, newest first — the archive index.
 *
 * Written as SQL because grouping by year and month is not something Prisma's query API can express,
 * and pulling every published row into memory to bucket it would not scale.
 *
 * `publishAt` is `timestamp without time zone` holding UTC. Comparing it against `NOW()`, which is a
 * `timestamptz`, makes Postgres read the stored value as LOCAL time — so on a database whose session
 * timezone is not UTC, recent months quietly disappear from the archive. `NOW() AT TIME ZONE 'UTC'`
 * produces a naive UTC timestamp, which is the same clock the column is on. EXTRACT then yields UTC
 * parts, matching how dates are formatted everywhere else on the site.
 */
export async function listArchiveMonths(): Promise<{ year: number; month: number; count: number }[]> {
  const rows = await prisma.$queryRaw<{ year: number; month: number; count: bigint }[]>`
    SELECT EXTRACT(YEAR FROM "publishAt")::int AS year,
           EXTRACT(MONTH FROM "publishAt")::int AS month,
           COUNT(*)::bigint AS count
      FROM "public"."article"
     WHERE "state" = 'PUBLISHED'
       AND "publishAt" IS NOT NULL
       AND "publishAt" <= (NOW() AT TIME ZONE 'UTC')
     GROUP BY 1, 2
     ORDER BY 1 DESC, 2 DESC
  `
  return rows.map((r) => ({ year: r.year, month: r.month, count: Number(r.count) }))
}

// --------------------------------------------------------------------------- author + admin views

/** Everything one author has written, in whatever state — their own workspace. */
export async function listMyArticles(actor: EditorialActor) {
  const mine = await authoredPlayerIds(actor)
  return prisma.article.findMany({
    where: { authorPlayerId: { in: mine }, state: { not: 'SOFT_DELETED' } },
    orderBy: [{ updatedAt: 'desc' }],
    select: {
      id: true, slug: true, title: true, state: true, publishAt: true, updatedAt: true,
      submittedAt: true, reviewFeedback: true, pendingSubmittedAt: true, commentCount: true,
      viewCount: true, official: true,
      category: { select: { name: true, slug: true } },
    },
  })
}

/**
 * The administrator's queue: submissions, proposed edits and open comment reports.
 *
 * Loaded together because they are one job — "what needs a decision from me" — and three separate
 * counts on three separate pages is how a queue quietly grows a backlog nobody notices.
 */
export async function getModerationQueue() {
  const [pending, proposedEdits, reports] = await Promise.all([
    prisma.article.findMany({
      where: { state: 'PENDING_REVIEW' },
      orderBy: [{ submittedAt: 'asc' }],
      select: {
        id: true, slug: true, title: true, excerpt: true, submittedAt: true,
        authorNameSnapshot: true, authorHandleSnapshot: true,
        authorPlayer: { select: { primaryName: true, cueverseId: true } },
        category: { select: { name: true } },
      },
    }),
    prisma.article.findMany({
      where: { pendingSubmittedAt: { not: null } },
      orderBy: [{ pendingSubmittedAt: 'asc' }],
      select: {
        id: true, slug: true, title: true, pendingTitle: true, pendingSubmittedAt: true,
        authorNameSnapshot: true, authorHandleSnapshot: true,
        authorPlayer: { select: { primaryName: true, cueverseId: true } },
      },
    }),
    prisma.commentReport.findMany({
      where: { resolvedAt: null },
      orderBy: [{ createdAt: 'asc' }],
      select: {
        id: true, reason: true, createdAt: true, reporterPlayerId: true,
        comment: {
          select: {
            id: true, body: true, createdAt: true, hiddenAt: true, deletedAt: true,
            authorNameSnapshot: true,
            article: { select: { id: true, slug: true, title: true } },
          },
        },
      },
    }),
  ])

  return { pending, proposedEdits, reports, total: pending.length + proposedEdits.length + reports.length }
}

/** Administrator listing: every article in every state, with a state filter. */
export async function listAllArticles(filters: { state?: string; search?: string; page?: number } = {}) {
  const page = Math.max(1, Math.trunc(filters.page ?? 1))
  const where: Prisma.ArticleWhereInput = {}
  if (filters.state && filters.state !== 'ALL') where.state = filters.state as Prisma.ArticleWhereInput['state']
  const term = (filters.search ?? '').trim().slice(0, 120)
  if (term) {
    where.OR = [
      { title: { contains: term, mode: 'insensitive' } },
      { authorNameSnapshot: { contains: term, mode: 'insensitive' } },
      { authorHandleSnapshot: { contains: term, mode: 'insensitive' } },
    ]
  }

  const [total, items] = await Promise.all([
    prisma.article.count({ where }),
    prisma.article.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      skip: (page - 1) * 25,
      take: 25,
      select: {
        id: true, slug: true, title: true, state: true, publishAt: true, updatedAt: true,
        official: true, featured: true, pinned: true, commentCount: true, viewCount: true,
        pendingSubmittedAt: true,
        authorNameSnapshot: true, authorHandleSnapshot: true,
        authorPlayer: { select: { primaryName: true, cueverseId: true } },
        category: { select: { name: true } },
      },
    }),
  ])
  return { items, total, page, pageCount: Math.max(1, Math.ceil(total / 25)) }
}

/**
 * Members who can be given a byline, for the Owner's author picker.
 *
 * Active profiles only, and merged-away secondaries are excluded — attributing an article to a
 * profile the site no longer shows would give readers a byline that leads nowhere. Ordered by
 * CueVerse ID, which is the identity this site leads with everywhere.
 *
 * A profile with no CueVerse ID is still listed under its preferred name: an archive-era member who
 * has never claimed an account is exactly the sort of person whose writing gets relayed by hand.
 */
export async function listBylineCandidates(): Promise<
  { playerId: string; name: string; handle: string | null }[]
> {
  const merged = new Set(await mergedSecondaryPlayerIds())
  const players = await prisma.player.findMany({
    where: { active: true },
    orderBy: [{ cueverseId: 'asc' }, { primaryName: 'asc' }],
    select: { id: true, primaryName: true, cueverseId: true },
  })
  return players
    .filter((p) => !merged.has(p.id))
    .map((p) => ({ playerId: p.id, name: p.primaryName, handle: p.cueverseId }))
}

/** The revision history for one article, newest first. */
export async function listRevisions(articleId: number) {
  return prisma.articleRevision.findMany({
    where: { articleId },
    orderBy: [{ createdAt: 'desc' }],
    take: 50,
    select: { id: true, revision: true, title: true, editorName: true, note: true, createdAt: true },
  })
}
