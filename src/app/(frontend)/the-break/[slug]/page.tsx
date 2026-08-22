import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, Lock, Pin, BadgeCheck, ExternalLink } from 'lucide-react'

import { Wide } from '@/components/primitives'
import { RichText } from '@/components/editorial/rich-text'
import { VoteControl } from '@/components/break/vote-control'
import { PostActions } from '@/components/break/post-actions'
import { CommentThread } from '@/components/break/comment-thread'
import { CommentComposer } from '@/components/break/comment-composer'
import { getPostBySlug } from '@/lib/break/posts'
import { getCommentTree } from '@/lib/break/comments'
import { currentBreakActor, canReplyTo, canViewRemovedBody } from '@/lib/break/permissions'
import { COMMENT_SORTS, type CommentSort } from '@/lib/break/ranking'
import { slugKeyOf } from '@/lib/editorial/slug-format'
import type { RichDocument } from '@/lib/editorial/richtext'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const post = await getPostBySlug(slug, null)
  if (!post) return { title: 'The Break' }
  return {
    title: post.title,
    description: (post.bodyText ?? '').slice(0, 160) || 'A post on The Break.',
    // Canonical points at the post's CURRENT slug, so a retired URL and the live one are not two
    // pages as far as a search engine is concerned.
    alternates: { canonical: `/the-break/${post.slug}` },
  }
}

export default async function PostPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { slug } = await params
  const sp = await searchParams
  const one = (k: string) => { const v = sp[k]; return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined }

  const actor = await currentBreakActor()
  const post = await getPostBySlug(slug, actor)
  if (!post) notFound()

  // Arriving by a retired slug lands on the canonical URL rather than serving the same page twice.
  if (slugKeyOf(slug) !== post.slugKey) redirect(`/the-break/${post.slug}`)

  const sortParam = one('sort')
  const sort: CommentSort = COMMENT_SORTS.includes(sortParam as CommentSort) ? (sortParam as CommentSort) : 'best'
  const rootId = Number(one('thread')) || null

  const comments = await getCommentTree({ postId: post.id, viewer: actor, sort, rootId })

  const removed = post.removedAt != null
  const deleted = post.deletedAt != null
  const showBody = !deleted && (!removed || canViewRemovedBody(actor, post.authorPlayerId))
  const mayReply = canReplyTo(actor, {
    postLocked: post.locked,
    branchLocked: false,
    commentsEnabled: post.commentsEnabled,
  })
  const viewerVote = post.votes[0]?.value ?? (actor ? 0 : null)
  const href = `/the-break/${post.slug}`

  return (
    <Wide name="break-post" className="py-6">
      <Link
        href="/the-break"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />The Break
      </Link>

      <article className="rounded-lg border border-border bg-card/40 p-4 sm:p-5">
        <div className="grid grid-cols-[auto_1fr] gap-3 sm:gap-4">
          <div className="pt-0.5">
            <VoteControl
              target="post" id={post.id} score={post.score} viewerVote={viewerVote}
              signedIn={actor != null} returnTo={href}
            />
          </div>

          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.7rem]">
              {post.pinned && (
                <span className="inline-flex items-center gap-1 rounded-full border border-[var(--gold)]/40 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-[var(--gold)]">
                  <Pin className="size-3" aria-hidden />Pinned
                </span>
              )}
              {post.official && (
                <span className="inline-flex items-center gap-1 rounded-full border border-[var(--gold)]/40 bg-[var(--selected-surface)] px-1.5 py-0.5 font-semibold uppercase tracking-wide text-[var(--gold)]">
                  <BadgeCheck className="size-3" aria-hidden />Official
                </span>
              )}
              {post.category && (
                <Link
                  href={`/the-break?category=${post.category.slug}`}
                  className="rounded-full border border-border px-1.5 py-0.5 font-medium text-muted-foreground hover:text-foreground"
                >
                  {post.category.name}
                </Link>
              )}
              {post.locked && (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Lock className="size-3" aria-hidden />Locked
                </span>
              )}
            </div>

            <h1 className="text-balance font-display text-xl font-bold leading-tight sm:text-2xl">
              {post.title}
            </h1>

            <p className="mt-1 text-xs text-muted-foreground">
              <span className="font-medium text-[var(--gold)]">{post.authorNameSnapshot}</span>
              {post.authorHandleSnapshot && <span className="text-foreground"> {post.authorHandleSnapshot}</span>}
              {post.publishedAt && (
                <> · <time dateTime={post.publishedAt.toISOString()}>{post.publishedAt.toLocaleDateString()}</time></>
              )}
              {post.editedAt && <> · edited</>}
            </p>

            {removed && (
              <p className="mt-3 rounded border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                Removed by a moderator{post.removalReason ? `: ${post.removalReason}` : '.'}
                {showBody && <span className="ml-1 italic">You can still see it because it is yours or you are staff.</span>}
              </p>
            )}
            {deleted && (
              <p className="mt-3 rounded border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                The author deleted this post. The discussion below is kept.
              </p>
            )}

            {showBody && (
              <>
                {/* Media, before the body, at its natural aspect ratio. */}
                {post.media.filter((m) => m.status === 'READY').map((m) => (
                  <figure key={m.id} className="mt-4">
                    {m.kind === 'VIDEO' ? (
                      <video
                        controls
                        preload="metadata"
                        poster={m.posterUrl ?? undefined}
                        className="max-h-[70vh] w-full rounded border border-border bg-black"
                      >
                        <source src={m.url} type={m.mimeType} />
                        {m.captionsUrl && <track kind="captions" src={m.captionsUrl} default />}
                      </video>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={m.url}
                        alt={m.alt ?? ''}
                        width={m.width ?? undefined}
                        height={m.height ?? undefined}
                        className={cn(
                          'max-h-[70vh] w-auto max-w-full rounded border border-border object-contain',
                          (post.spoiler || post.sensitive) && 'blur-xl',
                        )}
                      />
                    )}
                    {m.caption && <figcaption className="mt-1 text-xs text-muted-foreground">{m.caption}</figcaption>}
                  </figure>
                ))}

                {post.linkUrl && (
                  <a
                    href={post.linkUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow ugc"
                    className="mt-4 inline-flex items-center gap-1.5 rounded border border-border px-3 py-2 text-sm text-[var(--gold)] hover:underline"
                  >
                    <ExternalLink className="size-4" aria-hidden />
                    {post.linkDomain ?? post.linkUrl}
                  </a>
                )}

                {post.body != null && (
                  <div className="mt-4">
                    <RichText doc={post.body as unknown as RichDocument} />
                  </div>
                )}
              </>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <span className="px-1.5 py-1">{post.commentCount} {post.commentCount === 1 ? 'comment' : 'comments'}</span>
              <PostActions
                postId={post.id} slug={post.slug}
                saved={post.saves.length > 0} signedIn={actor != null}
              />
            </div>
          </div>
        </div>
      </article>

      <section aria-labelledby="comments-heading" className="mt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="comments-heading" className="font-display text-lg font-bold">
            {post.commentCount} {post.commentCount === 1 ? 'Comment' : 'Comments'}
          </h2>
          <nav aria-label="Sort comments" className="flex items-center gap-1 text-xs">
            {COMMENT_SORTS.map((s) => (
              <Link
                key={s}
                href={s === 'best' ? href : `${href}?sort=${s}`}
                aria-current={sort === s ? 'page' : undefined}
                className={cn(
                  'rounded-full px-2 py-1 font-medium capitalize transition-colors',
                  sort === s ? 'bg-[var(--selected-surface)] text-[var(--gold)]' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {s}
              </Link>
            ))}
          </nav>
        </div>

        {rootId && (
          <Link href={href} className="mb-3 inline-block text-sm text-[var(--gold)] hover:underline">
            ← Back to the whole discussion
          </Link>
        )}

        {mayReply ? (
          <CommentComposer postId={post.id} parentId={null} />
        ) : (
          <p className="mb-4 rounded border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            {actor == null
              ? <>You need an account to reply. <Link href={`/login?next=${encodeURIComponent(href)}`} className="text-[var(--gold)] hover:underline">Sign in</Link>.</>
              : post.locked
                ? 'This post is locked. Existing replies stay readable.'
                : 'Comments are closed on this post.'}
          </p>
        )}

        <CommentThread
          nodes={comments}
          postSlug={post.slug}
          postLocked={post.locked}
          signedIn={actor != null}
          viewerPlayerId={actor?.playerId ?? null}
          isModerator={!!actor?.isAdmin}
        />
      </section>
    </Wide>
  )
}
