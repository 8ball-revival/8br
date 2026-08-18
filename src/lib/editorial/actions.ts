'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { EditorialError } from './service'
import * as svc from './service'
import * as comments from './comments'
import { currentEditorialActor, type EditorialActor } from './permissions'
import { generateUniqueSlug, isSlugAvailable, isValidSlug } from './slug'

/**
 * Server actions for The Break.
 *
 * Every action resolves the acting user itself and lets the service layer decide what they may do.
 * Nothing here accepts an actor, a role or an author id from the client — a server action is a public
 * HTTP endpoint whatever the UI around it looks like, so anything the caller sends is a request, not
 * a fact.
 *
 * Actions return `{ ok }` or `{ error }` rather than throwing. An expected refusal ("you cannot
 * publish that") is part of the interface and should render as a sentence next to the button; only an
 * unexpected failure deserves an error boundary.
 */

export interface ActionResult<T = void> {
  ok?: boolean
  error?: string
  data?: T
}

/** Run an action with a resolved actor, turning expected refusals into a message. */
async function run<T>(fn: (actor: EditorialActor) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const actor = await currentEditorialActor()
    if (!actor) return { error: 'Sign in with an active account to do that.' }
    const data = await fn(actor)
    return { ok: true, data }
  } catch (err) {
    if (err instanceof EditorialError) return { error: err.message }
    // Anything else is a bug rather than a rule, and the details do not belong in a browser.
    console.error('[editorial] action failed', err)
    return { error: 'Something went wrong. Try again.' }
  }
}

/** Refresh every surface an article can appear on. Cheap, and always correct. */
function revalidateArticle(slug?: string | null) {
  revalidatePath('/news')
  revalidatePath('/news/mine')
  revalidatePath('/staff/news')
  revalidatePath('/')
  if (slug) revalidatePath(`/news/${slug}`)
}

// --------------------------------------------------------------------------- authoring

export async function createArticleAction(input: svc.ArticleInput): Promise<ActionResult<number>> {
  const res = await run((actor) => svc.createArticle(actor, input))
  if (res.ok) revalidateArticle()
  return res
}

export async function updateArticleAction(
  articleId: number,
  input: svc.ArticleInput,
): Promise<ActionResult<{ pending: boolean }>> {
  const res = await run((actor) => svc.updateArticle(actor, articleId, input))
  if (res.ok) revalidateArticle(await slugOf(articleId))
  return res
}

export async function autosaveDraftAction(
  articleId: number,
  title: string,
  bodySource: string,
): Promise<ActionResult> {
  // No revalidation: autosave fires while somebody is typing, and busting the cache on every
  // keystroke would be a self-inflicted denial of service.
  return run((actor) => svc.autosaveDraft(actor, articleId, title, bodySource))
}

export async function submitForReviewAction(articleId: number): Promise<ActionResult> {
  const res = await run((actor) => svc.submitForReview(actor, articleId))
  if (res.ok) revalidateArticle(await slugOf(articleId))
  return res
}

export async function withdrawSubmissionAction(articleId: number): Promise<ActionResult> {
  const res = await run((actor) => svc.withdrawSubmission(actor, articleId))
  if (res.ok) revalidateArticle(await slugOf(articleId))
  return res
}

export async function publishArticleAction(
  articleId: number,
  publishAtIso?: string | null,
): Promise<ActionResult> {
  const when = publishAtIso ? new Date(publishAtIso) : null
  if (when && Number.isNaN(when.getTime())) return { error: 'That publication time is not valid.' }
  const res = await run((actor) => svc.publishArticle(actor, articleId, when))
  if (res.ok) revalidateArticle(await slugOf(articleId))
  return res
}

export async function archiveArticleAction(articleId: number): Promise<ActionResult> {
  const res = await run((actor) => svc.archiveArticle(actor, articleId))
  if (res.ok) revalidateArticle(await slugOf(articleId))
  return res
}

export async function deleteArticleAction(articleId: number): Promise<ActionResult> {
  const slug = await slugOf(articleId)
  const res = await run((actor) => svc.softDeleteArticle(actor, articleId))
  if (res.ok) revalidateArticle(slug)
  return res
}

export async function restoreRevisionAction(articleId: number, revisionId: number): Promise<ActionResult> {
  const res = await run((actor) => svc.restoreRevision(actor, articleId, revisionId))
  if (res.ok) revalidateArticle(await slugOf(articleId))
  return res
}

export async function setArticleRelationsAction(
  articleId: number,
  relations: Parameters<typeof svc.setArticleRelations>[2],
): Promise<ActionResult> {
  const res = await run((actor) => svc.setArticleRelations(actor, articleId, relations))
  if (res.ok) revalidateArticle(await slugOf(articleId))
  return res
}

/** Live slug check for the editor, plus the suggestion it would use. */
export async function checkSlugAction(
  slug: string,
  articleId?: number,
): Promise<ActionResult<{ available: boolean; suggestion: string }>> {
  return run(async () => {
    const valid = isValidSlug(slug)
    const available = valid && (await isSlugAvailable(slug, articleId))
    return { available, suggestion: await generateUniqueSlug(slug || 'article', articleId) }
  })
}

// --------------------------------------------------------------------------- review

export async function approveArticleAction(
  articleId: number,
  publishAtIso?: string | null,
): Promise<ActionResult> {
  const when = publishAtIso ? new Date(publishAtIso) : null
  if (when && Number.isNaN(when.getTime())) return { error: 'That publication time is not valid.' }
  const res = await run((actor) => svc.approveArticle(actor, articleId, when))
  if (res.ok) revalidateArticle(await slugOf(articleId))
  return res
}

export async function rejectArticleAction(articleId: number, feedback: string): Promise<ActionResult> {
  const res = await run((actor) => svc.rejectArticle(actor, articleId, feedback))
  if (res.ok) revalidateArticle(await slugOf(articleId))
  return res
}

export async function restoreArticleAction(articleId: number): Promise<ActionResult> {
  const res = await run((actor) => svc.restoreArticle(actor, articleId))
  if (res.ok) revalidateArticle(await slugOf(articleId))
  return res
}

export async function setArticleFlagsAction(
  articleId: number,
  flags: Parameters<typeof svc.setArticleFlags>[2],
): Promise<ActionResult> {
  const res = await run((actor) => svc.setArticleFlags(actor, articleId, flags))
  if (res.ok) revalidateArticle(await slugOf(articleId))
  return res
}

// --------------------------------------------------------------------------- comments

export async function addCommentAction(
  articleId: number,
  body: string,
  parentId?: number | null,
): Promise<ActionResult<number>> {
  const res = await run((actor) => comments.addComment(actor, articleId, body, parentId))
  if (res.ok) revalidateArticle(await slugOf(articleId))
  return res
}

export async function editCommentAction(commentId: number, body: string): Promise<ActionResult> {
  const res = await run((actor) => comments.editComment(actor, commentId, body))
  if (res.ok) revalidateArticle(await slugOfComment(commentId))
  return res
}

export async function deleteCommentAction(commentId: number): Promise<ActionResult> {
  const slug = await slugOfComment(commentId)
  const res = await run((actor) => comments.deleteOwnComment(actor, commentId))
  if (res.ok) revalidateArticle(slug)
  return res
}

export async function reportCommentAction(commentId: number, reason: string): Promise<ActionResult> {
  return run((actor) => comments.reportComment(actor, commentId, reason))
}

export async function hideCommentAction(commentId: number, reason?: string): Promise<ActionResult> {
  const slug = await slugOfComment(commentId)
  const res = await run((actor) => comments.hideComment(actor, commentId, reason))
  if (res.ok) revalidateArticle(slug)
  return res
}

export async function unhideCommentAction(commentId: number): Promise<ActionResult> {
  const res = await run((actor) => comments.unhideComment(actor, commentId))
  if (res.ok) revalidateArticle(await slugOfComment(commentId))
  return res
}

export async function resolveReportAction(reportId: number, resolution: string): Promise<ActionResult> {
  const res = await run((actor) => comments.resolveReport(actor, reportId, resolution))
  if (res.ok) revalidatePath('/staff/news')
  return res
}

// --------------------------------------------------------------------------- settings

export async function updateEditorialSettingsAction(settings: {
  featuredArticleId?: number | null
  showFeatured?: boolean
  showOfficial?: boolean
  showPredictions?: boolean
  showCommunity?: boolean
  showDiscussed?: boolean
}): Promise<ActionResult> {
  const res = await run(async (actor) => {
    if (!actor.isAdmin) throw new EditorialError('Only an administrator can change the homepage.')
    await prisma.editorialSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...settings },
      update: settings,
    })
  })
  if (res.ok) { revalidatePath('/'); revalidatePath('/staff/news') }
  return res
}

// --------------------------------------------------------------------------- helpers

async function slugOf(articleId: number): Promise<string | null> {
  const a = await prisma.article.findUnique({ where: { id: articleId }, select: { slug: true } })
  return a?.slug ?? null
}

async function slugOfComment(commentId: number): Promise<string | null> {
  const c = await prisma.articleComment.findUnique({
    where: { id: commentId },
    select: { article: { select: { slug: true } } },
  })
  return c?.article.slug ?? null
}
