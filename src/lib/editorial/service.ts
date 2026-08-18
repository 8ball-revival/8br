import 'server-only'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import type { ArticleState } from '@prisma/client'
import {
  buildDocument, sanitizeDocument, deriveExcerpt, isEmptyDocument, cleanText,
  type RichDocument,
} from './richtext'
import { generateUniqueSlug, isSlugAvailable, retireSlug, slugKeyOf, isValidSlug } from './slug'
import {
  type EditorialActor, canEditArticle, canPublishNow, canMarkOfficial, canFeature,
} from './permissions'

/**
 * The Break — the article lifecycle.
 *
 * Six states, and the rules that move an article between them:
 *
 *   DRAFT ──submit──▶ PENDING_REVIEW ──approve──▶ PUBLISHED
 *     │                     │                        │
 *     └────publish──────────┘ (Trusted Author only)   ├──archive──▶ ARCHIVED ──restore──▶ PUBLISHED
 *                           └──reject──▶ REJECTED     └──delete───▶ SOFT_DELETED
 *                                          └──resubmit──▶ PENDING_REVIEW
 *
 * Two rules do most of the work here.
 *
 * First, visibility is a pure function of `(state, publishAt)` rather than a flag somebody has to
 * remember to flip. Scheduling an article simply means publishing it with a future `publishAt`; it
 * becomes visible when the clock passes, with no worker, no cron and nothing to go wrong overnight.
 *
 * Second, a member editing an already-published article does NOT edit the live copy. Their changes
 * land in the `pending*` columns and wait for review while the approved version keeps serving. The
 * alternative — letting an approved article be silently rewritten after the fact — would make review
 * meaningless.
 *
 * Every function takes the acting `EditorialActor` and re-checks permission itself. None of them
 * trusts the caller to have checked, because a server action is a public HTTP endpoint whatever the
 * UI around it looks like.
 */

/** Thrown for a rule the user could reasonably hit; the message is safe to show them. */
export class EditorialError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EditorialError'
  }
}

const MAX_TITLE = 180
const MAX_EXCERPT = 400

// --------------------------------------------------------------------------- visibility

/**
 * The one definition of "the public can see this". Every public query composes this rather than
 * writing its own state test, so there is a single place where visibility can be got wrong.
 */
export function publishedWhere(now: Date = new Date()): Prisma.ArticleWhereInput {
  return { state: 'PUBLISHED', publishAt: { not: null, lte: now } }
}

/** True when this row, already loaded, is publicly visible. */
export function isPubliclyVisible(
  article: { state: ArticleState; publishAt: Date | null },
  now: Date = new Date(),
): boolean {
  return article.state === 'PUBLISHED' && article.publishAt != null && article.publishAt <= now
}

/** Published, but not yet due. Shown to its author and to administrators as "Scheduled". */
export function isScheduled(
  article: { state: ArticleState; publishAt: Date | null },
  now: Date = new Date(),
): boolean {
  return article.state === 'PUBLISHED' && article.publishAt != null && article.publishAt > now
}

// --------------------------------------------------------------------------- input

export interface ArticleInput {
  title: string
  /** Authoring text. Parsed and validated here — never stored as given. */
  bodySource: string
  excerpt?: string | null
  categoryId?: number | null
  tags?: string[]
  coverMediaId?: string | null
  coverAlt?: string | null
  seoTitle?: string | null
  seoDescription?: string | null
  /** Administrator-only; silently ignored for anybody else. */
  official?: boolean
  featured?: boolean
  commentsEnabled?: boolean
  /** Explicit slug. Optional — derived from the title when absent. */
  slug?: string | null
}

interface NormalisedInput {
  title: string
  body: RichDocument
  excerpt: string
  categoryId: number | null
  coverMediaId: string | null
  coverAlt: string | null
  seoTitle: string | null
  seoDescription: string | null
  commentsEnabled: boolean
}

/**
 * Validate and clean everything an author sent.
 *
 * Runs on every write, including autosave, so a draft can never contain something that would fail at
 * publish time — the author finds out while they are still typing rather than at the last step.
 */
async function normalise(input: ArticleInput, actor: EditorialActor): Promise<NormalisedInput> {
  const title = cleanText(input.title).trim().replace(/\s+/g, ' ').slice(0, MAX_TITLE)
  if (!title) throw new EditorialError('Give the article a title.')

  const body = buildDocument(String(input.bodySource ?? ''))
  if (isEmptyDocument(body)) throw new EditorialError('The article needs some content.')

  const excerptRaw = cleanText(input.excerpt ?? '').trim().replace(/\s+/g, ' ')
  const excerpt = (excerptRaw || deriveExcerpt(body)).slice(0, MAX_EXCERPT)

  let categoryId: number | null = null
  if (input.categoryId != null) {
    const category = await prisma.articleCategory.findUnique({
      where: { id: Number(input.categoryId) },
      select: { id: true, active: true, adminOnly: true, name: true },
    })
    if (!category || !category.active) throw new EditorialError('Choose a category that is still available.')
    // Official News exists so readers can tell the site speaking from a member writing. A member
    // filing themselves under it would defeat the entire distinction.
    if (category.adminOnly && !actor.isAdmin) {
      throw new EditorialError(`"${category.name}" is reserved for 8 Ball Registry staff.`)
    }
    categoryId = category.id
  }

  return {
    title,
    body,
    excerpt,
    categoryId,
    coverMediaId: input.coverMediaId ? String(input.coverMediaId).slice(0, 64) : null,
    coverAlt: input.coverAlt ? cleanText(input.coverAlt).slice(0, 300) : null,
    seoTitle: input.seoTitle ? cleanText(input.seoTitle).slice(0, 180) : null,
    seoDescription: input.seoDescription ? cleanText(input.seoDescription).slice(0, 320) : null,
    commentsEnabled: input.commentsEnabled !== false,
  }
}

// --------------------------------------------------------------------------- tags

/** Attach a tag set, creating tags that do not exist yet. Replaces whatever was there. */
async function setTags(db: Prisma.TransactionClient, articleId: number, tags: string[] | undefined): Promise<void> {
  if (!tags) return
  const { slugify } = await import('./slug')

  const wanted = new Map<string, string>()
  for (const raw of tags.slice(0, 12)) {
    const name = cleanText(raw).trim().replace(/\s+/g, ' ').slice(0, 40)
    const slug = slugify(name)
    if (slug) wanted.set(slug, name)
  }

  await db.articleTagLink.deleteMany({ where: { articleId } })
  for (const [slug, name] of wanted) {
    const tag = await db.articleTag.upsert({ where: { slug }, create: { slug, name }, update: {} })
    await db.articleTagLink.create({ data: { articleId, tagId: tag.id } })
  }
}

// --------------------------------------------------------------------------- revisions

/**
 * Record what the article looked like before a change.
 *
 * Kept so a publishing or moderation decision can be reversed, not as an audit trail — nothing is
 * written here that is not needed to put the article back the way it was.
 */
async function recordRevision(
  db: Prisma.TransactionClient,
  articleId: number,
  actor: EditorialActor,
  note: string,
): Promise<void> {
  const current = await db.article.findUnique({
    where: { id: articleId },
    select: { title: true, excerpt: true, body: true, revision: true },
  })
  if (!current) return

  await db.articleRevision.create({
    data: {
      articleId,
      revision: current.revision,
      title: current.title,
      excerpt: current.excerpt,
      body: current.body as Prisma.InputJsonValue,
      editorPlayerId: actor.playerId,
      editorName: actor.handle ?? actor.name,
      note,
    },
  })
}

/** A moderation record — the minimum needed to explain and undo an editorial action. */
async function recordAction(
  db: Prisma.TransactionClient,
  action: string,
  actor: EditorialActor,
  detail: { articleId?: number; commentId?: number; [k: string]: unknown },
): Promise<void> {
  const { articleId, commentId, ...rest } = detail
  await db.editorialModerationRecord.create({
    data: {
      action,
      articleId: articleId ?? null,
      commentId: commentId ?? null,
      actorPlayerId: actor.playerId,
      actorName: actor.handle ?? actor.name,
      detail: Object.keys(rest).length ? (rest as Prisma.InputJsonValue) : undefined,
    },
  })
}

// --------------------------------------------------------------------------- create

/** Start a new article. Always a DRAFT — publishing is a separate, separately-authorised step. */
export async function createArticle(actor: EditorialActor, input: ArticleInput): Promise<number> {
  const data = await normalise(input, actor)

  return prisma.$transaction(async (db) => {
    const slug = input.slug && isValidSlug(input.slug)
      ? await claimSlug(db, input.slug)
      : await generateUniqueSlug(data.title, undefined, db)

    const article = await db.article.create({
      data: {
        authorPlayerId: actor.playerId,
        authorNameSnapshot: actor.name,
        authorHandleSnapshot: actor.handle,
        title: data.title,
        slug,
        slugKey: slugKeyOf(slug),
        excerpt: data.excerpt,
        body: data.body as unknown as Prisma.InputJsonValue,
        categoryId: data.categoryId,
        coverMediaId: data.coverMediaId,
        coverAlt: data.coverAlt,
        seoTitle: data.seoTitle,
        seoDescription: data.seoDescription,
        commentsEnabled: data.commentsEnabled,
        // Only an administrator can set these, and only ever deliberately.
        official: canMarkOfficial(actor) ? !!input.official : false,
        featured: canFeature(actor) ? !!input.featured : false,
        state: 'DRAFT',
      },
      select: { id: true },
    })

    await setTags(db, article.id, input.tags)
    return article.id
  })
}

async function claimSlug(db: Prisma.TransactionClient, slug: string, exceptId?: number): Promise<string> {
  if (!isValidSlug(slug)) throw new EditorialError('That web address is not usable. Use letters, numbers and hyphens.')
  if (!(await isSlugAvailable(slug, exceptId, db))) throw new EditorialError('That web address is already taken.')
  return slug
}

// --------------------------------------------------------------------------- update

/**
 * Save changes to an existing article.
 *
 * Where the changes land depends on who is writing and what state the article is in. Editing a live
 * article is the interesting case: a member's changes are held as a proposal, while an administrator
 * or the article's Trusted Author edits the live copy directly, because both of them could have
 * published those words in the first place.
 */
export async function updateArticle(
  actor: EditorialActor,
  articleId: number,
  input: ArticleInput,
): Promise<{ pending: boolean }> {
  const existing = await prisma.article.findUnique({
    where: { id: articleId },
    select: { id: true, authorPlayerId: true, state: true, slug: true, title: true, publishAt: true },
  })
  if (!existing) throw new EditorialError('That article no longer exists.')
  if (!canEditArticle(actor, existing.authorPlayerId)) throw new EditorialError('You cannot edit that article.')
  if (existing.state === 'SOFT_DELETED') throw new EditorialError('That article has been deleted.')

  const data = await normalise(input, actor)
  const live = existing.state === 'PUBLISHED' || existing.state === 'ARCHIVED'
  const mayEditLive = await canPublishNow(actor, existing.authorPlayerId)

  return prisma.$transaction(async (db) => {
    if (live && !mayEditLive) {
      // Hold the changes as a proposal. The published words are untouched.
      await db.article.update({
        where: { id: articleId },
        data: {
          pendingTitle: data.title,
          pendingExcerpt: data.excerpt,
          pendingBody: data.body as unknown as Prisma.InputJsonValue,
          pendingSubmittedAt: new Date(),
        },
      })
      await recordAction(db, 'article.edit_proposed', actor, { articleId })
      return { pending: true }
    }

    await recordRevision(db, articleId, actor, 'Before edit')

    // A slug change on something that has been public retires the old URL rather than breaking it.
    let slug = existing.slug
    if (input.slug && slugKeyOf(input.slug) !== slugKeyOf(existing.slug)) {
      slug = await claimSlug(db, input.slug, articleId)
      if (existing.publishAt) await retireSlug(articleId, existing.slug, db)
    }

    await db.article.update({
      where: { id: articleId },
      data: {
        title: data.title,
        slug,
        slugKey: slugKeyOf(slug),
        excerpt: data.excerpt,
        body: data.body as unknown as Prisma.InputJsonValue,
        categoryId: data.categoryId,
        coverMediaId: data.coverMediaId,
        coverAlt: data.coverAlt,
        seoTitle: data.seoTitle,
        seoDescription: data.seoDescription,
        commentsEnabled: data.commentsEnabled,
        ...(canMarkOfficial(actor) ? { official: !!input.official } : {}),
        ...(canFeature(actor) ? { featured: !!input.featured } : {}),
        revision: { increment: 1 },
        // Editing a rejected article puts it back in the author's hands as a draft, so they are not
        // stuck looking at a rejection they have already addressed.
        ...(existing.state === 'REJECTED' ? { state: 'DRAFT' as const, reviewFeedback: null } : {}),
      },
    })

    await setTags(db, articleId, input.tags)
    return { pending: false }
  })
}

/**
 * Autosave. Body and title only, drafts only, and no revision is recorded.
 *
 * Deliberately narrow: autosave fires while somebody is typing, so it must not be able to change a
 * published article, alter permissions, or fill the revision table with keystrokes.
 */
export async function autosaveDraft(
  actor: EditorialActor,
  articleId: number,
  title: string,
  bodySource: string,
): Promise<void> {
  const existing = await prisma.article.findUnique({
    where: { id: articleId },
    select: { authorPlayerId: true, state: true },
  })
  if (!existing) throw new EditorialError('That article no longer exists.')
  if (!canEditArticle(actor, existing.authorPlayerId)) throw new EditorialError('You cannot edit that article.')
  if (existing.state !== 'DRAFT' && existing.state !== 'REJECTED') return

  const body = buildDocument(String(bodySource ?? ''))
  await prisma.article.update({
    where: { id: articleId },
    data: {
      title: cleanText(title).trim().slice(0, MAX_TITLE) || 'Untitled',
      body: body as unknown as Prisma.InputJsonValue,
    },
  })
}

// --------------------------------------------------------------------------- workflow

/** Send a draft for review. */
export async function submitForReview(actor: EditorialActor, articleId: number): Promise<void> {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { authorPlayerId: true, state: true, title: true, body: true },
  })
  if (!article) throw new EditorialError('That article no longer exists.')
  if (!canEditArticle(actor, article.authorPlayerId)) throw new EditorialError('You cannot submit that article.')
  if (article.state !== 'DRAFT' && article.state !== 'REJECTED') {
    throw new EditorialError('Only a draft can be submitted for review.')
  }
  if (isEmptyDocument(sanitizeDocument(article.body))) throw new EditorialError('The article needs some content.')

  await prisma.$transaction(async (db) => {
    await db.article.update({
      where: { id: articleId },
      data: { state: 'PENDING_REVIEW', submittedAt: new Date(), reviewFeedback: null },
    })
    await recordAction(db, 'article.submitted', actor, { articleId })
  })
}

/** Withdraw a submission back to a draft. The author's own decision, so no review is involved. */
export async function withdrawSubmission(actor: EditorialActor, articleId: number): Promise<void> {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { authorPlayerId: true, state: true },
  })
  if (!article) throw new EditorialError('That article no longer exists.')
  if (!canEditArticle(actor, article.authorPlayerId)) throw new EditorialError('You cannot withdraw that article.')
  if (article.state !== 'PENDING_REVIEW') throw new EditorialError('That article is not awaiting review.')

  await prisma.article.update({ where: { id: articleId }, data: { state: 'DRAFT', submittedAt: null } })
}

/**
 * Publish, now or at a chosen time.
 *
 * `publishAt` in the future is a schedule; the state is PUBLISHED either way, and the article simply
 * is not visible yet. That keeps "scheduled" from being a fourth kind of published that some query
 * somewhere forgets about.
 */
export async function publishArticle(
  actor: EditorialActor,
  articleId: number,
  publishAt?: Date | null,
): Promise<void> {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { authorPlayerId: true, state: true, body: true, publishedAt: true, official: true },
  })
  if (!article) throw new EditorialError('That article no longer exists.')
  if (article.state === 'SOFT_DELETED') throw new EditorialError('That article has been deleted.')
  if (!(await canPublishNow(actor, article.authorPlayerId))) {
    throw new EditorialError('Your articles are published after review. Submit it for review instead.')
  }
  if (isEmptyDocument(sanitizeDocument(article.body))) throw new EditorialError('The article needs some content.')

  const when = publishAt ?? new Date()
  if (Number.isNaN(when.getTime())) throw new EditorialError('That publication time is not valid.')

  await prisma.$transaction(async (db) => {
    await db.article.update({
      where: { id: articleId },
      data: {
        state: 'PUBLISHED',
        publishAt: when,
        // `publishedAt` is the first time it went live and never moves again; `publishAt` is the
        // scheduling knob. Keeping them separate is what lets an article be rescheduled without
        // rewriting its history.
        publishedAt: article.publishedAt ?? when,
        approvedAt: new Date(),
        reviewerPlayerId: actor.playerId,
        reviewFeedback: null,
        archivedAt: null,
      },
    })
    await recordAction(db, publishAt && publishAt > new Date() ? 'article.scheduled' : 'article.published', actor, {
      articleId, publishAt: when.toISOString(),
    })
  })
}

/**
 * Approve a submission, or approve a proposed edit to a live article.
 *
 * One function for both because to an administrator they are the same decision — "these words may be
 * public" — and splitting them would make it possible to approve one and forget the other.
 */
export async function approveArticle(
  actor: EditorialActor,
  articleId: number,
  publishAt?: Date | null,
): Promise<void> {
  if (!actor.isAdmin) throw new EditorialError('Only an administrator can approve an article.')

  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: {
      state: true, publishedAt: true, pendingBody: true, pendingTitle: true,
      pendingExcerpt: true, pendingSubmittedAt: true,
    },
  })
  if (!article) throw new EditorialError('That article no longer exists.')

  const hasPendingEdit = article.pendingSubmittedAt != null

  await prisma.$transaction(async (db) => {
    if (hasPendingEdit) {
      await recordRevision(db, articleId, actor, 'Before approving a proposed edit')
      await db.article.update({
        where: { id: articleId },
        data: {
          ...(article.pendingTitle ? { title: article.pendingTitle } : {}),
          ...(article.pendingExcerpt ? { excerpt: article.pendingExcerpt } : {}),
          ...(article.pendingBody ? { body: article.pendingBody as Prisma.InputJsonValue } : {}),
          pendingTitle: null, pendingExcerpt: null, pendingBody: Prisma.DbNull, pendingSubmittedAt: null,
          revision: { increment: 1 },
          reviewerPlayerId: actor.playerId,
          reviewFeedback: null,
        },
      })
      await recordAction(db, 'article.edit_approved', actor, { articleId })
      return
    }

    if (article.state !== 'PENDING_REVIEW') throw new EditorialError('That article is not awaiting review.')
    const when = publishAt ?? new Date()
    await db.article.update({
      where: { id: articleId },
      data: {
        state: 'PUBLISHED',
        publishAt: when,
        publishedAt: article.publishedAt ?? when,
        approvedAt: new Date(),
        reviewerPlayerId: actor.playerId,
        reviewFeedback: null,
      },
    })
    await recordAction(db, 'article.approved', actor, { articleId, publishAt: when.toISOString() })
  })
}

/**
 * Reject a submission or a proposed edit, with a reason.
 *
 * The reason is private to the author and administrators. It is never rendered publicly, because a
 * rejection note is feedback to one person, not a public verdict on them.
 */
export async function rejectArticle(actor: EditorialActor, articleId: number, feedback: string): Promise<void> {
  if (!actor.isAdmin) throw new EditorialError('Only an administrator can reject an article.')
  const reason = cleanText(feedback).trim().slice(0, 2000)
  if (!reason) throw new EditorialError('Give the author a reason.')

  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { state: true, pendingSubmittedAt: true },
  })
  if (!article) throw new EditorialError('That article no longer exists.')

  await prisma.$transaction(async (db) => {
    if (article.pendingSubmittedAt != null) {
      // Drop the proposal; the live article is untouched and stays exactly as it was.
      await db.article.update({
        where: { id: articleId },
        data: {
          pendingTitle: null, pendingExcerpt: null, pendingBody: Prisma.DbNull, pendingSubmittedAt: null,
          reviewerPlayerId: actor.playerId, reviewFeedback: reason,
        },
      })
      await recordAction(db, 'article.edit_rejected', actor, { articleId })
      return
    }

    if (article.state !== 'PENDING_REVIEW') throw new EditorialError('That article is not awaiting review.')
    await db.article.update({
      where: { id: articleId },
      data: { state: 'REJECTED', reviewerPlayerId: actor.playerId, reviewFeedback: reason },
    })
    await recordAction(db, 'article.rejected', actor, { articleId })
  })
}

/** Take a published article out of the listings without destroying it. */
export async function archiveArticle(actor: EditorialActor, articleId: number): Promise<void> {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { authorPlayerId: true, state: true },
  })
  if (!article) throw new EditorialError('That article no longer exists.')
  if (!actor.isAdmin && article.authorPlayerId !== actor.playerId) {
    throw new EditorialError('You cannot archive that article.')
  }
  if (article.state !== 'PUBLISHED') throw new EditorialError('Only a published article can be archived.')

  await prisma.$transaction(async (db) => {
    await db.article.update({ where: { id: articleId }, data: { state: 'ARCHIVED', archivedAt: new Date() } })
    await recordAction(db, 'article.archived', actor, { articleId })
  })
}

/** Put an archived article back. Its original publication date is preserved. */
export async function restoreArticle(actor: EditorialActor, articleId: number): Promise<void> {
  if (!actor.isAdmin) throw new EditorialError('Only an administrator can restore an article.')
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { state: true, publishAt: true, publishedAt: true },
  })
  if (!article) throw new EditorialError('That article no longer exists.')
  if (article.state !== 'ARCHIVED' && article.state !== 'SOFT_DELETED') {
    throw new EditorialError('That article is not archived.')
  }

  await prisma.$transaction(async (db) => {
    await db.article.update({
      where: { id: articleId },
      data: {
        state: 'PUBLISHED',
        archivedAt: null,
        deletedAt: null,
        publishAt: article.publishAt ?? article.publishedAt ?? new Date(),
      },
    })
    await recordAction(db, 'article.restored', actor, { articleId })
  })
}

/**
 * Soft-delete. The row survives so the action can be undone and so comment threads keep their
 * shape; nothing about it is publicly reachable.
 */
export async function softDeleteArticle(actor: EditorialActor, articleId: number): Promise<void> {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { authorPlayerId: true, state: true },
  })
  if (!article) throw new EditorialError('That article no longer exists.')
  if (!actor.isAdmin && article.authorPlayerId !== actor.playerId) {
    throw new EditorialError('You cannot delete that article.')
  }

  await prisma.$transaction(async (db) => {
    await db.article.update({
      where: { id: articleId },
      data: { state: 'SOFT_DELETED', deletedAt: new Date() },
    })
    await recordAction(db, 'article.deleted', actor, { articleId })
  })
}

// --------------------------------------------------------------------------- revisions

/** Put the article back to an earlier revision. The current text is saved first, so this is undoable too. */
export async function restoreRevision(actor: EditorialActor, articleId: number, revisionId: number): Promise<void> {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { authorPlayerId: true, state: true },
  })
  if (!article) throw new EditorialError('That article no longer exists.')
  if (!canEditArticle(actor, article.authorPlayerId)) throw new EditorialError('You cannot edit that article.')

  const revision = await prisma.articleRevision.findUnique({
    where: { id: revisionId },
    select: { articleId: true, title: true, excerpt: true, body: true, revision: true },
  })
  if (!revision || revision.articleId !== articleId) throw new EditorialError('That revision does not belong to this article.')

  // Restoring into a live article is a content change like any other, so a member's restore is a
  // proposal and only somebody who could publish applies it directly.
  const mayEditLive = await canPublishNow(actor, article.authorPlayerId)
  const live = article.state === 'PUBLISHED' || article.state === 'ARCHIVED'

  await prisma.$transaction(async (db) => {
    if (live && !mayEditLive) {
      await db.article.update({
        where: { id: articleId },
        data: {
          pendingTitle: revision.title,
          pendingExcerpt: revision.excerpt,
          pendingBody: revision.body as Prisma.InputJsonValue,
          pendingSubmittedAt: new Date(),
        },
      })
      await recordAction(db, 'article.revision_proposed', actor, { articleId, revision: revision.revision })
      return
    }

    await recordRevision(db, articleId, actor, `Before restoring revision ${revision.revision}`)
    await db.article.update({
      where: { id: articleId },
      data: {
        title: revision.title,
        excerpt: revision.excerpt,
        body: revision.body as Prisma.InputJsonValue,
        revision: { increment: 1 },
      },
    })
    await recordAction(db, 'article.revision_restored', actor, { articleId, revision: revision.revision })
  })
}

// --------------------------------------------------------------------------- administrator flags

/** Feature, pin, mark official, or open and close comments. All administrator-only. */
export async function setArticleFlags(
  actor: EditorialActor,
  articleId: number,
  flags: {
    official?: boolean
    featured?: boolean
    pinned?: boolean
    pinOrder?: number
    commentsEnabled?: boolean
    commentsLocked?: boolean
  },
): Promise<void> {
  if (!actor.isAdmin) throw new EditorialError('Only an administrator can change that.')

  await prisma.$transaction(async (db) => {
    await db.article.update({
      where: { id: articleId },
      data: {
        ...(flags.official !== undefined ? { official: flags.official } : {}),
        ...(flags.featured !== undefined ? { featured: flags.featured } : {}),
        ...(flags.pinned !== undefined ? { pinned: flags.pinned } : {}),
        ...(flags.pinOrder !== undefined ? { pinOrder: Math.max(0, Math.trunc(flags.pinOrder)) } : {}),
        ...(flags.commentsEnabled !== undefined ? { commentsEnabled: flags.commentsEnabled } : {}),
        ...(flags.commentsLocked !== undefined ? { commentsLocked: flags.commentsLocked } : {}),
      },
    })
    await recordAction(db, 'article.flags', actor, { articleId, ...flags })
  })
}

/** Link an article to the competitions and players it is about. Replaces the existing set. */
export async function setArticleRelations(
  actor: EditorialActor,
  articleId: number,
  relations: {
    competitionSeriesIds?: number[]
    seasonIds?: number[]
    tournamentIds?: number[]
    playerIds?: string[]
  },
): Promise<void> {
  const article = await prisma.article.findUnique({ where: { id: articleId }, select: { authorPlayerId: true } })
  if (!article) throw new EditorialError('That article no longer exists.')
  if (!canEditArticle(actor, article.authorPlayerId)) throw new EditorialError('You cannot edit that article.')

  await prisma.$transaction(async (db) => {
    await db.articleRelation.deleteMany({ where: { articleId } })
    const rows: Prisma.ArticleRelationCreateManyInput[] = [
      ...(relations.competitionSeriesIds ?? []).map((competitionSeriesId) => ({ articleId, competitionSeriesId })),
      ...(relations.seasonIds ?? []).map((seasonId) => ({ articleId, seasonId })),
      ...(relations.tournamentIds ?? []).map((tournamentId) => ({ articleId, tournamentId })),
      ...(relations.playerIds ?? []).map((playerId) => ({ articleId, playerId })),
    ]
    if (rows.length) await db.articleRelation.createMany({ data: rows.slice(0, 60), skipDuplicates: true })
  })
}
