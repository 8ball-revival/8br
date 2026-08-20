import type { Metadata } from 'next'
import Link from 'next/link'

import { Wide } from '@/components/primitives'
import { FeedToolbar } from '@/components/break/feed-toolbar'
import { PostCard } from '@/components/break/post-card'
import { getFeed, searchPosts } from '@/lib/break/feed'
import { currentBreakActor, canPost } from '@/lib/break/permissions'
import { FEED_SORTS, TOP_WINDOWS, type FeedSort, type TopWindow } from '@/lib/break/ranking'
import { pageMetadata } from '@/lib/site'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = pageMetadata({
  title: 'The Break',
  description: 'News, predictions, history, memes and community discussion.',
  path: '/the-break',
})

/**
 * The Break — one sitewide community.
 *
 * There are no separate communities here and no plans for any: one feed, filtered by category. That
 * is why a category is a query parameter rather than a path segment — it narrows this feed, it does
 * not open a different one.
 */
export default async function TheBreakPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const one = (k: string) => { const v = sp[k]; return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined }

  // Anything unrecognised falls back to the default rather than erroring: a URL is user input.
  const sortParam = one('sort')
  const sort: FeedSort = FEED_SORTS.includes(sortParam as FeedSort) ? (sortParam as FeedSort) : 'hot'
  const windowParam = one('window')
  const topWindow: TopWindow = TOP_WINDOWS.some((w) => w.key === windowParam)
    ? (windowParam as TopWindow)
    : 'week'
  const category = one('category') ?? null
  const q = one('q')?.trim() || null
  const cursor = one('cursor') ?? null

  const actor = await currentBreakActor()
  const viewerPlayerId = actor?.playerId ?? null

  const page = q
    ? await searchPosts({ q, sort: 'relevance', category, cursor, viewerPlayerId })
    : await getFeed({ sort, window: topWindow, category, cursor, viewerPlayerId })

  const signedIn = actor != null

  return (
    <Wide name="the-break" className="py-6">
      <header className="mb-4">
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">The Break</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          News, predictions, history, memes and community discussion
        </p>
      </header>

      <FeedToolbar sort={sort} window={topWindow} category={category} q={q} canPost={canPost(actor)} />

      {q && (
        <p className="mb-3 text-sm text-muted-foreground">
          {page.cards.length === 0 ? 'Nothing matches' : 'Results for'}{' '}
          <span className="font-medium text-foreground">&ldquo;{q}&rdquo;</span>
        </p>
      )}

      {/* Pinned first, labelled, above the sort rather than inside it. */}
      {page.pinned.length > 0 && (
        <div className="mb-3 flex flex-col gap-2">
          {page.pinned.map((card) => (
            <PostCard key={`pinned-${card.id}`} card={card} viewerSignedIn={signedIn} />
          ))}
        </div>
      )}

      {page.cards.length === 0 && page.pinned.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {q
            ? 'No posts match that search.'
            : category
              ? 'Nothing in this category yet.'
              : 'Nothing here yet. Be the first to post.'}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {page.cards.map((card) => (
            <PostCard key={card.id} card={card} viewerSignedIn={signedIn} />
          ))}
        </div>
      )}

      {/*
        The accessible fallback for infinite scrolling.

        A real link with a real href, so it works without JavaScript, can be opened in a new tab, and
        is reachable by keyboard. The observer-driven loader enhances this rather than replacing it.
      */}
      {page.nextCursor && (
        <div className="mt-4 flex justify-center">
          <Link
            href={{ pathname: '/the-break', query: cleanQuery({ sort, window: topWindow, category, q, cursor: page.nextCursor }) }}
            className="rounded-full border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-[var(--gold)]/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
          >
            Load More
          </Link>
        </div>
      )}
    </Wide>
  )
}

/** Drop defaults and empties so the URL stays readable. */
function cleanQuery(input: Record<string, string | null | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(input)) {
    if (v == null || v === '') continue
    if (k === 'sort' && v === 'hot') continue
    out[k] = v
  }
  return out
}
