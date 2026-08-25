'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import Link from 'next/link'
import { Flame, Clock, TrendingUp, Sparkles, Search, PenSquare } from 'lucide-react'

import { cn } from '@/lib/utils'
import { TOP_WINDOWS, type FeedSort } from '@/lib/break/ranking'

/**
 * The feed's controls: sort, the Top window, search, and Create Post.
 *
 * Sorting is a LINK per option rather than a dropdown. Each sort is a real URL, so it can be shared,
 * bookmarked and opened in a new tab, and the browser's back button moves between them the way a
 * reader expects. A dropdown that pushed state would give up all three for no gain.
 */
const SORTS: { key: FeedSort; label: string; Icon: typeof Flame }[] = [
  { key: 'hot', label: 'Hot', Icon: Flame },
  { key: 'new', label: 'New', Icon: Clock },
  { key: 'top', label: 'Top', Icon: TrendingUp },
  { key: 'rising', label: 'Rising', Icon: Sparkles },
]

export function FeedToolbar({
  sort,
  window: topWindow,
  category,
  q,
  canPost,
}: {
  sort: FeedSort
  window: string
  category: string | null
  q: string | null
  canPost: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  /** Rebuild the query, dropping anything that is back at its default so URLs stay short. */
  function withParams(next: Record<string, string | null>) {
    const out = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === '') out.delete(k)
      else out.set(k, v)
    }
    // Changing anything invalidates the position in the old ordering.
    out.delete('cursor')
    const qs = out.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }

  return (
    <div className="sticky top-16 z-30 -mx-4 mb-4 border-b border-border bg-background/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:px-3">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Sort the feed" className="flex items-center gap-1">
          {SORTS.map(({ key, label, Icon }) => {
            const active = sort === key
            return (
              <Link
                key={key}
                href={withParams({ sort: key === 'hot' ? null : key, window: key === 'top' ? topWindow : null })}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60',
                  active
                    ? 'bg-[var(--selected-surface)] text-[var(--gold)]'
                    : 'text-muted-foreground hover:bg-white/[0.06] hover:text-foreground',
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            )
          })}
        </nav>

        {/* The window only exists for Top, so it only appears for Top. */}
        {sort === 'top' && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="sr-only sm:not-sr-only">Window</span>
            <select
              value={topWindow}
              onChange={(e) => router.push(withParams({ window: e.target.value }))}
              className="rounded border border-border bg-card px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
            >
              {TOP_WINDOWS.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
            </select>
          </label>
        )}

        <form
          role="search"
          className="ml-auto flex min-w-0 flex-1 items-center gap-2 sm:flex-none"
          onSubmit={(e) => {
            e.preventDefault()
            const value = new FormData(e.currentTarget).get('q')
            router.push(withParams({ q: typeof value === 'string' && value.trim() ? value.trim() : null }))
          }}
        >
          <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              name="q"
              type="search"
              defaultValue={q ?? ''}
              placeholder="Search The Break"
              aria-label="Search The Break"
              className="w-full rounded-full border border-border bg-card py-1.5 pl-7 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
            />
          </div>
        </form>

        <Link
          href={canPost ? '/the-break/submit' : '/login?next=%2Fthe-break%2Fsubmit'}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--gold)] px-3 py-1.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
        >
          <PenSquare className="size-4" aria-hidden />
          <span className="hidden sm:inline">Create Post</span>
          <span className="sm:hidden">Post</span>
        </Link>
      </div>

      {category && (
        <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          Filtered to <span className="font-medium text-foreground">{category}</span>
          <Link href={withParams({ category: null })} className="underline hover:text-foreground">clear</Link>
        </p>
      )}
    </div>
  )
}
