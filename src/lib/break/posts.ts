import 'server-only'
import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { slugify, slugKeyOf, MAX_SLUG_LENGTH } from '@/lib/editorial/slug-format'
import { sanitizeDocument, documentToPlainText, isEmptyDocument, type RichDocument } from '@/lib/editorial/richtext'
import { hotRank } from './ranking'
import { seedAuthorVote } from './voting'
import type { BreakActor } from './permissions'

/**
 * Creating, editing and publishing posts.
 *
 * ── Drafts are private, full stop ────────────────────────────────────────────────────────────────
 * A draft belongs to its author and to nobody else — not to staff, not to somebody who guesses the
 * id. Every loader in this file takes the viewer and applies that rule, rather than leaving it to
 * whichever page happens to call it.
 *
 * ── A permalink is a promise ─────────────────────────────────────────────────────────────────────
 * Retitling a published post does NOT change its URL. The slug is fixed at publication; if it is
 * ever deliberately changed, the old one is retired into the slug history and keeps resolving. A
 * link somebody shared last month has to keep working, and the way to guarantee that is to never
 * silently move the target.
 */

export const MAX_TITLE = 300
export const MAX_GALLERY_ITEMS = 20
export const MAX_POLL_OPTIONS = 6
export const MIN_POLL_OPTIONS = 2

export type PostType = 'TEXT' | 'IMAGE' | 'GALLERY' | 'GIF' | 'VIDEO' | 'LINK' | 'POLL'

export const POST_TYPES: { key: PostType; label: string; hint: string }[] = [
  { key: 'TEXT', label: 'Text', hint: 'Write something.' },
  { key: 'IMAGE', label: 'Image', hint: 'One picture.' },
  { key: 'GALLERY', label: 'Gallery', hint: 'Several pictures in order.' },
  { key: 'GIF', label: 'GIF', hint: 'Upload one, paste one, or search GIPHY.' },
  { key: 'VIDEO', label: 'Video', hint: 'A clip. MP4 or WebM.' },
  { key: 'LINK', label: 'Link', hint: 'Somewhere else worth reading.' },
  { key: 'POLL', label: 'Poll', hint: 'Ask the room to choose.' },
]

/** Types whose defining content is media, so publishing has to wait for it to be ready. */
const MEDIA_TYPES: PostType[] = ['IMAGE', 'GALLERY', 'GIF', 'VIDEO']

export interface PostDraftInput {
  type: PostType
  title: string
  /** Rich text. Sanitised here, server-side, whatever the client claims to have done. */
  body?: unknown
  categorySlug?: string | null
  linkUrl?: string | null
  spoiler?: boolean
  sensitive?: boolean
  official?: boolean
  poll?: { options: string[]; closesAt?: string | null } | null
}

export interface PostResult {
  ok: boolean
  error?: string
  postId?: number
  slug?: string
}

function cleanTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE)
}

/**
 * Validate what a post claims to be.
 *
 * Returned as a list rather than the first failure, so the composer can show everything that needs
 * fixing at once instead of one thing per attempt.
 */
export function validateForPublish(input: {
  type: PostType
  title: string
  body: RichDocument | null
  categoryId: number | null
  linkUrl: string | null
  mediaCount: number
  pendingMedia: number
  failedMedia: number
  pollOptions: number
}): string[] {
  const errors: string[] = []
  if (cleanTitle(input.title).length === 0) errors.push('A post needs a title.')
  if (input.categoryId == null) errors.push('Choose a category.')

  if (input.type === 'LINK' && !input.linkUrl) errors.push('A link post needs a URL.')
  if (MEDIA_TYPES.includes(input.type) && input.mediaCount === 0) {
    errors.push(`A ${input.type.toLowerCase()} post needs at least one file.`)
  }
  if (input.type === 'GALLERY' && input.mediaCount < 2) {
    errors.push('A gallery needs at least two items — one picture is an Image post.')
  }
  if (input.mediaCount > MAX_GALLERY_ITEMS) {
    errors.push(`A gallery holds at most ${MAX_GALLERY_ITEMS} items.`)
  }
  if (input.type === 'POLL' && (input.pollOptions < MIN_POLL_OPTIONS || input.pollOptions > MAX_POLL_OPTIONS)) {
    errors.push(`A poll needs between ${MIN_POLL_OPTIONS} and ${MAX_POLL_OPTIONS} options.`)
  }
  if (input.type === 'TEXT' && (!input.body || isEmptyDocument(input.body))) {
    errors.push('A text post needs a body.')
  }

  /*
   * Publication waits for media.
   *
   * A post published while its video is still being processed renders as a broken frame to everyone
   * who arrives before the job finishes — and if the job then fails, it is permanently broken. A
   * failed item blocks too, with a message that says which, because the author can retry or remove
   * it and neither is possible if the post has already gone out.
   */
  if (input.pendingMedia > 0) errors.push('Some media is still processing. Publishing will be possible once it finishes.')
  if (input.failedMedia > 0) errors.push('Some media failed to process. Retry or remove it before publishing.')

  return errors
}

/** A slug that is unique across posts and their retired slugs. Collisions get a numeric suffix. */
export async function uniqueSlug(title: string, exceptPostId?: number, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<{ slug: string; slugKey: string }> {
  const base = slugify(title).slice(0, MAX_SLUG_LENGTH) || 'post'
  for (let n = 0; n < 200; n++) {
    const slug = n === 0 ? base : `${base}-${n + 1}`.slice(0, MAX_SLUG_LENGTH)
    const key = slugKeyOf(slug)
    const [taken, retired] = await Promise.all([
      db.breakPost.findFirst({ where: { slugKey: key, ...(exceptPostId ? { id: { not: exceptPostId } } : {}) }, select: { id: true } }),
      db.breakPostSlug.findFirst({ where: { slugKey: key, ...(exceptPostId ? { postId: { not: exceptPostId } } : {}) }, select: { id: true } }),
    ])
    if (!taken && !retired) return { slug, slugKey: key }
  }
  // Two hundred posts with the same title is not a collision, it is a script. A timestamp ends it.
  const slug = `${base}-${Date.now().toString(36)}`.slice(0, MAX_SLUG_LENGTH)
  return { slug, slugKey: slugKeyOf(slug) }
}

async function categoryIdFor(slug: string | null | undefined, actor: BreakActor): Promise<{ id: number | null; error?: string }> {
  if (!slug) return { id: null }
  const cat = await prisma.breakCategory.findUnique({
    where: { slug }, select: { id: true, active: true, adminOnly: true, name: true },
  })
  if (!cat || !cat.active) return { id: null, error: 'That category is not available.' }
  if (cat.adminOnly && !actor.isAdmin) return { id: null, error: `${cat.name} is for staff posts.` }
  return { id: cat.id }
}

/** Start a draft. Nothing is published by this path — publishing is always a separate, explicit act. */
export async function createDraft(actor: BreakActor, input: PostDraftInput): Promise<PostResult> {
  const title = cleanTitle(input.title || 'Untitled')
  const cat = await categoryIdFor(input.categorySlug, actor)
  if (cat.error) return { ok: false, error: cat.error }

  const body = input.body === undefined ? null : sanitizeDocument(input.body)
  const { slug, slugKey } = await uniqueSlug(title || 'untitled')

  const post = await prisma.$transaction(async (tx) => {
    const p = await tx.breakPost.create({
      data: {
        type: input.type,
        state: 'DRAFT',
        authorPlayerId: actor.playerId,
        authorNameSnapshot: actor.name,
        authorHandleSnapshot: actor.handle,
        title,
        slug,
        slugKey,
        body: (body ?? undefined) as Prisma.InputJsonValue | undefined,
        bodyText: body ? documentToPlainText(body).slice(0, 100_000) : null,
        categoryId: cat.id,
        linkUrl: input.linkUrl ?? null,
        spoiler: !!input.spoiler,
        sensitive: !!input.sensitive,
        official: !!input.official && actor.isAdmin,
      },
      select: { id: true, slug: true },
    })

    if (input.type === 'POLL' && input.poll) {
      await createPollFor(tx, p.id, input.poll)
    }
    return p
  })

  return { ok: true, postId: post.id, slug: post.slug }
}

async function createPollFor(
  tx: Prisma.TransactionClient,
  postId: number,
  poll: { options: string[]; closesAt?: string | null },
): Promise<void> {
  const options = poll.options.map((o) => o.trim()).filter(Boolean).slice(0, MAX_POLL_OPTIONS)
  const closesAt = poll.closesAt ? new Date(poll.closesAt) : null
  await tx.breakPoll.create({
    data: {
      postId,
      closesAt: closesAt && !Number.isNaN(closesAt.getTime()) ? closesAt : null,
      options: { create: options.map((text, i) => ({ text: text.slice(0, 200), position: i })) },
    },
  })
}

/**
 * Save a draft, or edit a post that is already out.
 *
 * The difference matters. A draft can become anything; a published post with votes and comments on it
 * cannot change into an incompatible type, because the discussion underneath was about the thing it
 * was. That is the one conversion that is refused rather than confirmed.
 */
export async function updatePost(
  actor: BreakActor,
  postId: number,
  input: Partial<PostDraftInput>,
): Promise<PostResult> {
  const post = await prisma.breakPost.findUnique({
    where: { id: postId },
    select: {
      id: true, authorPlayerId: true, state: true, type: true, title: true, slug: true,
      publishedAt: true, score: true, commentCount: true,
      _count: { select: { votes: true, comments: true } },
    },
  })
  if (!post) return { ok: false, error: 'That post no longer exists.' }
  if (post.authorPlayerId !== actor.playerId && !actor.isAdmin) {
    return { ok: false, error: 'That is not yours to edit.' }
  }

  const data: Prisma.BreakPostUpdateInput = {}

  if (input.type && input.type !== post.type) {
    const engaged = post._count.votes > 1 || post._count.comments > 0
    if (post.state === 'PUBLISHED' && engaged) {
      return {
        ok: false,
        error: 'This post already has votes and replies, so its type cannot be changed. '
          + 'Post it again as the new type if that is what you meant.',
      }
    }
    data.type = input.type
  }

  if (input.title !== undefined) {
    const title = cleanTitle(input.title)
    if (title.length === 0) return { ok: false, error: 'A post needs a title.' }
    data.title = title
    /*
     * The URL does NOT follow the title on a published post.
     *
     * Renaming is normal — fixing a typo, sharpening a headline — and it must not quietly break
     * every link already shared. Drafts have no shared links, so their slug tracks the title freely.
     */
    if (post.state === 'DRAFT') {
      const { slug, slugKey } = await uniqueSlug(title, post.id)
      data.slug = slug
      data.slugKey = slugKey
    }
  }

  if (input.body !== undefined) {
    const body = sanitizeDocument(input.body)
    data.body = body as unknown as Prisma.InputJsonValue
    data.bodyText = documentToPlainText(body).slice(0, 100_000)
  }

  if (input.categorySlug !== undefined) {
    const cat = await categoryIdFor(input.categorySlug, actor)
    if (cat.error) return { ok: false, error: cat.error }
    data.category = cat.id ? { connect: { id: cat.id } } : { disconnect: true }
  }

  if (input.linkUrl !== undefined) data.linkUrl = input.linkUrl
  if (input.spoiler !== undefined) data.spoiler = !!input.spoiler
  if (input.sensitive !== undefined) data.sensitive = !!input.sensitive
  if (input.official !== undefined && actor.isAdmin) data.official = !!input.official

  // Only a published post carries an edited marker — a draft being edited is just a draft.
  if (post.state === 'PUBLISHED') data.editedAt = new Date()

  const updated = await prisma.breakPost.update({ where: { id: postId }, data, select: { id: true, slug: true } })
  return { ok: true, postId: updated.id, slug: updated.slug }
}

/** Publish a draft. Validates first, seeds the author's real +1, and sets the initial Hot rank. */
export async function publishPost(actor: BreakActor, postId: number): Promise<PostResult & { errors?: string[] }> {
  const post = await prisma.breakPost.findUnique({
    where: { id: postId },
    include: {
      media: { select: { status: true } },
      poll: { select: { _count: { select: { options: true } } } },
    },
  })
  if (!post) return { ok: false, error: 'That post no longer exists.' }
  if (post.authorPlayerId !== actor.playerId && !actor.isAdmin) {
    return { ok: false, error: 'That is not yours to publish.' }
  }
  if (post.state === 'PUBLISHED') return { ok: true, postId: post.id, slug: post.slug }

  const errors = validateForPublish({
    type: post.type as PostType,
    title: post.title,
    body: (post.body as RichDocument | null) ?? null,
    categoryId: post.categoryId,
    linkUrl: post.linkUrl,
    mediaCount: post.media.length,
    pendingMedia: post.media.filter((m) => m.status === 'PENDING').length,
    failedMedia: post.media.filter((m) => m.status === 'FAILED').length,
    pollOptions: post.poll?._count.options ?? 0,
  })
  if (errors.length > 0) return { ok: false, error: errors[0], errors }

  const now = new Date()
  await prisma.$transaction(async (tx) => {
    // The slug is fixed at publication, from the final title.
    const { slug, slugKey } = await uniqueSlug(post.title, post.id, tx)
    await tx.breakPost.update({
      where: { id: postId },
      data: {
        state: 'PUBLISHED',
        publishedAt: now,
        slug,
        slugKey,
        hotRank: hotRank(1, 0, now),
      },
    })
    await seedAuthorVote(tx, postId, post.authorPlayerId)
  })

  const out = await prisma.breakPost.findUniqueOrThrow({ where: { id: postId }, select: { slug: true } })
  return { ok: true, postId, slug: out.slug }
}

/**
 * The author withdrawing their own post.
 *
 * A post with replies leaves a shell behind. Deleting it outright would take a conversation other
 * people took part in with it, and their comments would have nowhere to be.
 */
export async function softDeletePost(actor: BreakActor, postId: number): Promise<PostResult> {
  const post = await prisma.breakPost.findUnique({
    where: { id: postId }, select: { id: true, authorPlayerId: true, commentCount: true, state: true },
  })
  if (!post) return { ok: false, error: 'That post no longer exists.' }
  if (post.authorPlayerId !== actor.playerId && !actor.isAdmin) {
    return { ok: false, error: 'That is not yours to delete.' }
  }

  // A draft nobody has seen can simply go.
  if (post.state === 'DRAFT') {
    await prisma.breakPost.delete({ where: { id: postId } })
    return { ok: true, postId }
  }

  await prisma.breakPost.update({
    where: { id: postId },
    data: { deletedAt: new Date(), state: 'DELETED' },
  })
  return { ok: true, postId }
}

// ─────────────────────────────────────────────────────────────────────────────────── reading

/**
 * One post, with everything its page needs.
 *
 * The viewer is a parameter rather than something read inside, so the same function serves a page, a
 * preview and a test, and the visibility rule is applied in exactly one place either way.
 */
export async function getPostBySlug(slug: string, viewer: BreakActor | null) {
  const key = slugKeyOf(slug)
  let post = await prisma.breakPost.findUnique({
    where: { slugKey: key },
    include: postInclude(viewer),
  })

  // A retired slug still resolves — that is what the history is for.
  if (!post) {
    const retired = await prisma.breakPostSlug.findUnique({
      where: { slugKey: key }, select: { postId: true },
    })
    if (retired) {
      post = await prisma.breakPost.findUnique({ where: { id: retired.postId }, include: postInclude(viewer) })
    }
  }
  if (!post) return null

  if (post.state === 'DRAFT' && post.authorPlayerId !== viewer?.playerId) return null
  return post
}

export async function getPostById(id: number, viewer: BreakActor | null) {
  const post = await prisma.breakPost.findUnique({ where: { id }, include: postInclude(viewer) })
  if (!post) return null
  if (post.state === 'DRAFT' && post.authorPlayerId !== viewer?.playerId) return null
  return post
}

function postInclude(viewer: BreakActor | null) {
  return {
    category: true,
    media: { orderBy: { position: 'asc' as const } },
    poll: { include: { options: { orderBy: { position: 'asc' as const } } } },
    repostOf: {
      select: {
        id: true, title: true, slug: true, authorNameSnapshot: true, authorHandleSnapshot: true,
        publishedAt: true, state: true, deletedAt: true, removedAt: true,
      },
    },
    /*
     * With no viewer there is no vote and no save to find, so the relation matches nothing.
     *
     * This used to say `playerId: '\0none'` — a literal NUL byte, meant as an id nobody could
     * ever hold. Postgres accepts a NUL in no text value at all and rejects the whole query with
     * "invalid byte sequence for encoding UTF8: 0x00", so every read that took this branch died
     * at the database rather than returning an empty list. `in: []` says the same thing and is a
     * query Postgres will actually run.
     */
    votes: viewer
      ? { where: { playerId: viewer.playerId }, select: { value: true } }
      : { where: { playerId: { in: [] } }, select: { value: true } },
    saves: viewer
      ? { where: { playerId: viewer.playerId }, select: { playerId: true } }
      : { where: { playerId: { in: [] } }, select: { playerId: true } },
  }
}

/** A member's own drafts. Never visible to anyone else, staff included. */
export async function listDrafts(actor: BreakActor) {
  return prisma.breakPost.findMany({
    where: { authorPlayerId: actor.playerId, state: 'DRAFT' },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true, title: true, type: true, updatedAt: true, createdAt: true,
      category: { select: { slug: true, name: true } },
      _count: { select: { media: true } },
    },
  })
}
