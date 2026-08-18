import 'server-only'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { buildDocument, sanitizeDocument, cleanText, isEmptyDocument, type RichDocument } from './richtext'
import { slugify, isValidSlug } from './slug-format'
import { EditorialError } from './service'
import type { EditorialActor } from './permissions'

/**
 * Standalone pages — About, FAQ, and anything else that is a page rather than news.
 *
 * The same editor, the same body format and the same media as an article, but never listed as news,
 * never in a feed, and never commentable by default. Administrator-only end to end: there is no
 * submission workflow, because there is nobody to submit to.
 *
 * Visibility follows the same `(state, publishAt)` rule as an article, so an unpublished page is
 * invisible for exactly the same reason and by exactly the same test.
 */

/** Slugs that would collide with a real route. */
const RESERVED_PAGE_SLUGS = new Set([
  'news', 'seasons', 'tournaments', 'rankings', 'players', 'account', 'login', 'register',
  'staff', 'api', 'admin', 'setup', 'recovery', 'terms', 'privacy', 'contact', 'reset-password',
  'predictions', 'competitions', 'sitemap', 'robots',
])

export interface PageInput {
  slug: string
  title: string
  bodySource: string
  excerpt?: string | null
  seoTitle?: string | null
  seoDescription?: string | null
  showInNav?: boolean
  navOrder?: number
  commentsEnabled?: boolean
}

export function isValidPageSlug(slug: string): boolean {
  return isValidSlug(slug) && !RESERVED_PAGE_SLUGS.has(slug.toLowerCase())
}

/** A published page, by slug. Returns null for anything the public may not see. */
export async function getPublicPage(slug: string): Promise<{
  slug: string
  title: string
  excerpt: string | null
  body: RichDocument
  seoTitle: string | null
  seoDescription: string | null
  canonicalUrl: string | null
  updatedAt: Date
} | null> {
  const page = await prisma.editorialPage.findUnique({
    where: { slug: slugify(slug) },
    select: {
      slug: true, title: true, excerpt: true, body: true, state: true, publishAt: true,
      seoTitle: true, seoDescription: true, canonicalUrl: true, updatedAt: true,
    },
  })
  if (!page) return null
  if (page.state !== 'PUBLISHED' || !page.publishAt || page.publishAt > new Date()) return null

  return { ...page, body: sanitizeDocument(page.body) }
}

/** Pages an administrator has opted into the navigation. */
export async function navPages() {
  return prisma.editorialPage.findMany({
    where: { showInNav: true, state: 'PUBLISHED', publishAt: { not: null, lte: new Date() } },
    orderBy: [{ navOrder: 'asc' }, { title: 'asc' }],
    select: { slug: true, title: true },
  })
}

/** Every page, for the admin listing. */
export async function listPages() {
  return prisma.editorialPage.findMany({
    orderBy: [{ navOrder: 'asc' }, { title: 'asc' }],
    select: {
      id: true, slug: true, title: true, state: true, publishAt: true,
      showInNav: true, navOrder: true, updatedAt: true,
    },
  })
}

function normalise(input: PageInput) {
  const title = cleanText(input.title).trim().replace(/\s+/g, ' ').slice(0, 180)
  if (!title) throw new EditorialError('Give the page a title.')

  const slug = slugify(input.slug || title)
  if (!isValidPageSlug(slug)) throw new EditorialError('That web address is not usable — it clashes with an existing part of the site.')

  const body = buildDocument(String(input.bodySource ?? ''))
  if (isEmptyDocument(body)) throw new EditorialError('The page needs some content.')

  return {
    slug,
    title,
    body: body as unknown as Prisma.InputJsonValue,
    excerpt: input.excerpt ? cleanText(input.excerpt).slice(0, 400) : null,
    seoTitle: input.seoTitle ? cleanText(input.seoTitle).slice(0, 180) : null,
    seoDescription: input.seoDescription ? cleanText(input.seoDescription).slice(0, 320) : null,
    showInNav: !!input.showInNav,
    navOrder: Math.max(0, Math.trunc(input.navOrder ?? 0)),
    commentsEnabled: !!input.commentsEnabled,
  }
}

export async function createPage(actor: EditorialActor, input: PageInput): Promise<number> {
  if (!actor.isAdmin) throw new EditorialError('Only an administrator can create a page.')
  const data = normalise(input)

  const clash = await prisma.editorialPage.findUnique({ where: { slug: data.slug }, select: { id: true } })
  if (clash) throw new EditorialError('A page already uses that web address.')

  const page = await prisma.editorialPage.create({ data, select: { id: true } })
  return page.id
}

export async function updatePage(actor: EditorialActor, id: number, input: PageInput): Promise<void> {
  if (!actor.isAdmin) throw new EditorialError('Only an administrator can edit a page.')
  const data = normalise(input)

  const clash = await prisma.editorialPage.findUnique({ where: { slug: data.slug }, select: { id: true } })
  if (clash && clash.id !== id) throw new EditorialError('A page already uses that web address.')

  await prisma.editorialPage.update({
    where: { id },
    data: { ...data, revision: { increment: 1 } },
  })
}

/** Publish a page, now or at a chosen time — the same rule articles use. */
export async function publishPage(actor: EditorialActor, id: number, publishAt?: Date | null): Promise<void> {
  if (!actor.isAdmin) throw new EditorialError('Only an administrator can publish a page.')
  const existing = await prisma.editorialPage.findUnique({ where: { id }, select: { publishedAt: true } })
  if (!existing) throw new EditorialError('That page no longer exists.')

  const when = publishAt ?? new Date()
  await prisma.editorialPage.update({
    where: { id },
    data: { state: 'PUBLISHED', publishAt: when, publishedAt: existing.publishedAt ?? when },
  })
}

export async function unpublishPage(actor: EditorialActor, id: number): Promise<void> {
  if (!actor.isAdmin) throw new EditorialError('Only an administrator can unpublish a page.')
  await prisma.editorialPage.update({ where: { id }, data: { state: 'DRAFT' } })
}

export async function deletePage(actor: EditorialActor, id: number): Promise<void> {
  if (!actor.isAdmin) throw new EditorialError('Only an administrator can delete a page.')
  await prisma.editorialPage.update({
    where: { id },
    data: { state: 'SOFT_DELETED', deletedAt: new Date(), showInNav: false },
  })
}
