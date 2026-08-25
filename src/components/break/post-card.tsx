import Link from 'next/link'
import { MessageSquare, Lock, Pin, EyeOff, BadgeCheck, Repeat2, Image as ImageIcon, Play, BarChart3, Link2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { FeedCard } from '@/lib/break/feed'
import { VoteControl } from './vote-control'
import { PostActions } from './post-actions'

/**
 * One post in the feed.
 *
 * ── The card opens the post; the controls do not ─────────────────────────────────────────────────
 * The whole content area is a link, so the large easy target does the common thing. Voting, saving
 * and sharing sit OUTSIDE that link rather than inside it — a button nested in an anchor is a
 * coin-toss between navigating and acting, and on a phone it is usually the wrong one. They are
 * siblings in the layout, which is why the card is a grid rather than one big anchor.
 *
 * ── No bodies in the feed ────────────────────────────────────────────────────────────────────────
 * A card shows a title, a thumbnail and the counts. Excerpts turn a feed into a wall of half-read
 * paragraphs and make every card a different height, which is what the old article tiles did.
 */
export function PostCard({ card, viewerSignedIn }: { card: FeedCard; viewerSignedIn: boolean }) {
  const href = `/the-break/${card.slug}`
  const media = card.media[0]
  const removed = card.removedAt != null
  const deleted = card.deletedAt != null

  return (
    <article
      className={cn(
        'grid grid-cols-[auto_1fr] gap-3 rounded-lg border border-border bg-card/40 p-3 transition-colors',
        'hover:border-[var(--gold)]/30 sm:gap-4 sm:p-4',
        card.pinned && 'border-[var(--gold)]/40',
      )}
    >
      {/* Voting: its own column, so it never competes with the link for a tap. */}
      <div className="flex flex-col items-center gap-1 pt-0.5">
        <VoteControl
          target="post"
          id={card.id}
          score={card.score}
          viewerVote={card.viewerVote}
          signedIn={viewerSignedIn}
          returnTo={href}
        />
      </div>

      <div className="min-w-0">
        {/* Flags first: a reader should know a post is pinned or locked before reading the title. */}
        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.7rem]">
          {card.pinned && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--gold)]/40 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-[var(--gold)]">
              <Pin className="size-3" aria-hidden />Pinned
            </span>
          )}
          {card.official && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--gold)]/40 bg-[var(--selected-surface)] px-1.5 py-0.5 font-semibold uppercase tracking-wide text-[var(--gold)]">
              <BadgeCheck className="size-3" aria-hidden />Official
            </span>
          )}
          {card.category && (
            <Link
              href={`/the-break?category=${card.category.slug}`}
              className="rounded-full border border-border px-1.5 py-0.5 font-medium text-muted-foreground hover:text-foreground"
            >
              {card.category.name}
            </Link>
          )}
          {card.locked && (
            <span className="inline-flex items-center gap-1 text-muted-foreground" title="Locked — existing replies stay readable">
              <Lock className="size-3" aria-hidden />Locked
            </span>
          )}
          {card.spoiler && (
            <span className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 font-semibold uppercase tracking-wide text-muted-foreground">
              <EyeOff className="size-3" aria-hidden />Spoiler
            </span>
          )}
          {card.repostOfId != null && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Repeat2 className="size-3" aria-hidden />Repost
            </span>
          )}
        </div>

        <div className="flex gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-balance font-display text-base font-bold leading-snug sm:text-lg">
              <Link href={href} className="hover:text-[var(--gold)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60">
                {removed ? '[removed]' : deleted ? '[deleted]' : card.title}
              </Link>
            </h2>

            <p className="mt-1 text-xs text-muted-foreground">
              {/* Preferred Name in gold, CueVerse ID in white — the site's identity rule. */}
              <span className="font-medium text-[var(--gold)]">{card.authorName}</span>
              {card.authorHandle && <span className="text-foreground"> {card.authorHandle}</span>}
              {card.publishedAt && (
                <>
                  {' · '}
                  <time dateTime={card.publishedAt.toISOString()}>{relative(card.publishedAt)}</time>
                </>
              )}
              {card.editedAt && <span title={`Edited ${card.editedAt.toISOString()}`}> · edited</span>}
            </p>

            {removed && card.removalReason && (
              <p className="mt-2 rounded border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
                Removed by a moderator: {card.removalReason}
              </p>
            )}
          </div>

          {/* Thumbnail. Fixed box, object-cover, so a tall or wide source crops rather than stretches. */}
          {(media || card.linkImageUrl) && (
            <Link
              href={href}
              aria-hidden
              tabIndex={-1}
              className="relative hidden size-20 shrink-0 overflow-hidden rounded border border-border bg-muted sm:block"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={media?.posterUrl ?? media?.url ?? card.linkImageUrl ?? ''}
                alt=""
                className={cn('size-full object-cover', (card.spoiler || card.sensitive) && 'blur-md')}
                loading="lazy"
              />
              {media?.kind === 'VIDEO' && (
                <span className="absolute inset-0 grid place-items-center bg-black/30">
                  <Play className="size-6 text-white" aria-hidden />
                </span>
              )}
              {card.mediaCount > 1 && (
                <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-[0.6rem] font-semibold text-white">
                  {card.mediaCount}
                </span>
              )}
            </Link>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-muted-foreground">
          <Link
            href={href}
            className="inline-flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-white/[0.06] hover:text-foreground"
          >
            <MessageSquare className="size-3.5" aria-hidden />
            {card.commentCount} {card.commentCount === 1 ? 'comment' : 'comments'}
          </Link>

          <TypeHint card={card} />

          <PostActions postId={card.id} slug={card.slug} saved={card.viewerSaved} signedIn={viewerSignedIn} />
        </div>
      </div>
    </article>
  )
}

/** A small hint of what the post is, for cards with no thumbnail. */
function TypeHint({ card }: { card: FeedCard }) {
  if (card.type === 'POLL') {
    return (
      <span className="inline-flex items-center gap-1.5 px-1.5 py-1">
        <BarChart3 className="size-3.5" aria-hidden />{card.pollOptionCount} options
      </span>
    )
  }
  if (card.type === 'LINK' && card.linkDomain) {
    return (
      <span className="inline-flex items-center gap-1.5 px-1.5 py-1">
        <Link2 className="size-3.5" aria-hidden />{card.linkDomain}
      </span>
    )
  }
  if (card.type === 'GALLERY') {
    return (
      <span className="inline-flex items-center gap-1.5 px-1.5 py-1">
        <ImageIcon className="size-3.5" aria-hidden />{card.mediaCount} images
      </span>
    )
  }
  return null
}

/** Short relative time. Exact time stays in the `datetime` attribute for anyone who needs it. */
function relative(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}
