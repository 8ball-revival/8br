'use server'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/lib/prisma'
import { currentBreakActor } from './permissions'
import { addComment, editComment, softDeleteComment, MAX_COMMENT_CHARS } from './comments'
import { consume, limitMessage } from './rate-limit'

/**
 * Comment endpoints.
 *
 * Plain text arrives from the client and is turned into the site's rich-text document HERE, then
 * sanitised by the shared sanitiser on the way into the database. The client never supplies a
 * document, so it cannot supply a node type the sanitiser has not been taught to refuse.
 */

/** Wrap typed text into the document shape, one paragraph per blank-line-separated block. */
function textToDocument(text: string) {
  const blocks = text
    .slice(0, MAX_COMMENT_CHARS)
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => ({ t: 'p', c: [{ t: 'text', v: chunk }] }))
  return { v: 1, blocks }
}

export async function addCommentAction(input: {
  postId: number
  parentId: number | null
  text: string
}): Promise<{ ok: boolean; error?: string; commentId?: number }> {
  const actor = await currentBreakActor()
  if (!actor) return { ok: false, error: 'Sign in to comment.' }

  const limit = await consume('comment.create', { playerId: actor.playerId })
  if (!limit.allowed) return { ok: false, error: limitMessage('comment.create', limit) }

  const parentId = input.parentId ? Number(input.parentId) : null
  if (parentId != null && (!Number.isInteger(parentId) || parentId <= 0)) {
    return { ok: false, error: 'That is not a valid comment.' }
  }

  /*
   * A reply's post comes from its PARENT, not from the payload.
   *
   * The client sends zero for a reply precisely so there is nothing to spoof: the only way to attach
   * a reply to a post is to name a parent that already belongs to it.
   */
  let postId = Number(input.postId)
  if (parentId != null) {
    const parent = await prisma.breakComment.findUnique({ where: { id: parentId }, select: { postId: true } })
    if (!parent) return { ok: false, error: 'That comment no longer exists.' }
    postId = parent.postId
  }
  if (!Number.isInteger(postId) || postId <= 0) return { ok: false, error: 'That is not a valid post.' }

  const result = await addComment(actor, {
    postId,
    parentId,
    body: textToDocument(String(input.text ?? '')),
  })

  if (result.ok) {
    const post = await prisma.breakPost.findUnique({ where: { id: postId }, select: { slug: true } })
    if (post) revalidatePath(`/the-break/${post.slug}`)
    revalidatePath('/the-break')
  }
  return result
}

export async function editCommentAction(input: {
  commentId: number
  text: string
}): Promise<{ ok: boolean; error?: string }> {
  const actor = await currentBreakActor()
  if (!actor) return { ok: false, error: 'Sign in to edit.' }

  const limit = await consume('comment.edit', { playerId: actor.playerId })
  if (!limit.allowed) return { ok: false, error: limitMessage('comment.edit', limit) }

  const id = Number(input.commentId)
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'That is not a valid comment.' }

  const result = await editComment(actor, id, textToDocument(String(input.text ?? '')))
  if (result.ok) revalidatePath('/the-break')
  return result
}

export async function deleteCommentAction(commentId: number): Promise<{ ok: boolean; error?: string }> {
  const actor = await currentBreakActor()
  if (!actor) return { ok: false, error: 'Sign in first.' }

  const id = Number(commentId)
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'That is not a valid comment.' }

  const result = await softDeleteComment(actor, id)
  if (result.ok) revalidatePath('/the-break')
  return result
}
