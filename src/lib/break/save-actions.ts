'use server'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/lib/prisma'
import { currentBreakActor } from './permissions'

/**
 * Saving and hiding.
 *
 * Both are PRIVATE to the member: a save list is not a public endorsement and a hidden post is not a
 * report. Nothing here is visible to anyone else, staff included, and nothing here is aggregated
 * into a public count beyond the post's own save total.
 */

export async function toggleSaveAction(input: {
  target: 'post' | 'comment'
  id: number
}): Promise<{ ok: boolean; saved?: boolean; error?: string }> {
  const actor = await currentBreakActor()
  if (!actor) return { ok: false, error: 'Sign in to save.' }

  const id = Number(input.id)
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'That is not a valid target.' }

  if (input.target === 'post') {
    const existing = await prisma.breakSavedPost.findUnique({
      where: { playerId_postId: { playerId: actor.playerId, postId: id } },
    })
    if (existing) {
      await prisma.$transaction([
        prisma.breakSavedPost.delete({ where: { playerId_postId: { playerId: actor.playerId, postId: id } } }),
        prisma.breakPost.update({ where: { id }, data: { saveCount: { decrement: 1 } } }),
      ])
      return { ok: true, saved: false }
    }
    const post = await prisma.breakPost.findUnique({ where: { id }, select: { state: true } })
    if (!post || post.state === 'DRAFT') return { ok: false, error: 'That post is not available.' }

    await prisma.$transaction([
      prisma.breakSavedPost.create({ data: { playerId: actor.playerId, postId: id } }),
      prisma.breakPost.update({ where: { id }, data: { saveCount: { increment: 1 } } }),
    ])
    return { ok: true, saved: true }
  }

  const existing = await prisma.breakSavedComment.findUnique({
    where: { playerId_commentId: { playerId: actor.playerId, commentId: id } },
  })
  if (existing) {
    await prisma.breakSavedComment.delete({
      where: { playerId_commentId: { playerId: actor.playerId, commentId: id } },
    })
    return { ok: true, saved: false }
  }
  const comment = await prisma.breakComment.findUnique({ where: { id }, select: { id: true } })
  if (!comment) return { ok: false, error: 'That comment is not available.' }

  await prisma.breakSavedComment.create({ data: { playerId: actor.playerId, commentId: id } })
  return { ok: true, saved: true }
}

/** Hiding removes a post from THIS member's feed. Nobody else's view changes. */
export async function toggleHideAction(postId: number): Promise<{ ok: boolean; hidden?: boolean; error?: string }> {
  const actor = await currentBreakActor()
  if (!actor) return { ok: false, error: 'Sign in to hide posts.' }

  const id = Number(postId)
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'That is not a valid post.' }

  const existing = await prisma.breakHiddenPost.findUnique({
    where: { playerId_postId: { playerId: actor.playerId, postId: id } },
  })
  if (existing) {
    await prisma.breakHiddenPost.delete({ where: { playerId_postId: { playerId: actor.playerId, postId: id } } })
    revalidatePath('/the-break')
    return { ok: true, hidden: false }
  }

  await prisma.breakHiddenPost.create({ data: { playerId: actor.playerId, postId: id } })
  revalidatePath('/the-break')
  return { ok: true, hidden: true }
}
