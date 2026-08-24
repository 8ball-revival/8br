'use server'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/lib/prisma'
import { currentBreakActor } from './permissions'
import { canManageTheBreak, manageBasis } from './permission-rules'
import { updatePost, softDeletePost, type PostDraftInput } from './posts'

/**
 * The write path for managing a post.
 *
 * ── Why these exist rather than calling the service from a component ─────────────────────────────
 * Everything reachable from a browser is reachable by anyone who can craft a request. A form that is
 * only rendered for admins is not a permission; the button being absent stops nobody. So each of
 * these resolves the actor from the session itself — never from an argument — and hands off to the
 * canonical service, which checks again inside its own transaction.
 *
 * That is three checks for one delete: the page decides whether to draw the control, the action
 * decides whether to accept the request, and the service decides whether to commit the row. Only the
 * last two are load-bearing. The first is courtesy.
 *
 * ── What they do not do ──────────────────────────────────────────────────────────────────────────
 * They never take an actor, an author or a capability as a parameter. A server action's arguments
 * come from the client, and a permission read from the client is a permission granted by the client.
 */

export interface ManageResult {
  ok: boolean
  error?: string
  slug?: string
}

/** Edit any post the actor is entitled to manage. Attribution is not among the editable fields. */
export async function updatePostAction(
  postId: number,
  input: Partial<PostDraftInput>,
): Promise<ManageResult> {
  const actor = await currentBreakActor()
  if (!actor) return { ok: false, error: 'You need to be signed in to do that.' }

  const post = await prisma.breakPost.findUnique({
    where: { id: postId },
    select: { authorPlayerId: true, slug: true },
  })
  if (!post) return { ok: false, error: 'That post no longer exists.' }
  if (!manageBasis(actor, post.authorPlayerId)) return { ok: false, error: 'That is not yours to edit.' }

  /*
   * Authorship is stripped from the input before it reaches the service.
   *
   * `PostDraftInput` has no author field today, and this is what keeps that true if one is ever
   * added: an admin fixing a typo must not become the person who wrote the post, and the way that
   * mistake usually arrives is a well-meaning "set author" alongside the other fields.
   */
  const safe = { ...input } as Partial<PostDraftInput> & { authorPlayerId?: never; author?: never }
  delete safe.authorPlayerId
  delete safe.author

  const r = await updatePost(actor, postId, safe)
  if (!r.ok) return { ok: false, error: r.error }

  revalidatePath('/the-break')
  revalidatePath(`/the-break/${r.slug ?? post.slug}`)
  revalidatePath('/the-break/manage')
  revalidatePath('/')
  return { ok: true, slug: r.slug ?? post.slug }
}

/** Withdraw any post the actor is entitled to manage. Recoverable: the row and its thread stay. */
export async function deletePostAction(postId: number): Promise<ManageResult> {
  const actor = await currentBreakActor()
  if (!actor) return { ok: false, error: 'You need to be signed in to do that.' }

  const post = await prisma.breakPost.findUnique({
    where: { id: postId },
    select: { authorPlayerId: true, slug: true },
  })
  if (!post) return { ok: false, error: 'That post no longer exists.' }
  if (!manageBasis(actor, post.authorPlayerId)) return { ok: false, error: 'That is not yours to delete.' }

  const r = await softDeletePost(actor, postId)
  if (!r.ok) return { ok: false, error: r.error }

  /*
   * Every surface that could still be holding it.
   *
   * A withdrawn post has to leave the feed, the homepage module, its own page and the management
   * list together. Missing one of these is how a "deleted" post keeps appearing on the front page
   * until something unrelated happens to invalidate the cache.
   */
  revalidatePath('/the-break')
  revalidatePath(`/the-break/${post.slug}`)
  revalidatePath('/the-break/manage')
  revalidatePath('/')
  return { ok: true }
}

/**
 * The management list.
 *
 * Read through a server action rather than a route handler so the same session check applies, and so
 * an unauthorised caller gets an empty result instead of a shape they can probe.
 */
export async function listManagedPosts(): Promise<{
  ok: boolean
  posts: {
    id: number
    slug: string
    title: string
    type: string
    state: string
    authorHandle: string | null
    authorName: string | null
    createdAt: string
    updatedAt: string
    commentCount: number
    score: number
  }[]
}> {
  const actor = await currentBreakActor()
  if (!canManageTheBreak(actor)) return { ok: false, posts: [] }

  const rows = await prisma.breakPost.findMany({
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: {
      id: true, slug: true, title: true, type: true, state: true,
      createdAt: true, updatedAt: true, commentCount: true, score: true,
      authorPlayerId: true,
    },
  })

  const authors = await prisma.player.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.authorPlayerId).filter((x): x is string => !!x))] } },
    select: { id: true, cueverseId: true, primaryName: true },
  })
  const byId = new Map(authors.map((a) => [a.id, a]))

  return {
    ok: true,
    posts: rows.map((r) => {
      const a = r.authorPlayerId ? byId.get(r.authorPlayerId) : null
      return {
        id: r.id,
        slug: r.slug,
        title: r.title,
        type: String(r.type),
        state: String(r.state),
        authorHandle: a?.cueverseId ?? null,
        authorName: a?.primaryName ?? null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        commentCount: r.commentCount,
        score: r.score,
      }
    }),
  }
}
