import Link from 'next/link'
import { Search, PenLine, ShieldCheck } from 'lucide-react'

import { Badge } from '@/components/ui/badge'

/**
 * The masthead and controls shared by every page under /news.
 *
 * The section is called The Break; the navigation calls it News, because that is the word a visitor
 * scans for. Both appear here so the two names are visibly the same place rather than a surprise.
 */

export const NEWS_SUBTITLE = 'News, predictions, analysis and community stories.'

export interface NewsChrome {
  categories: { slug: string; name: string; adminOnly: boolean; articleCount: number }[]
  activeCategory?: string | null
  search?: string
  canWrite: boolean
  isAdmin: boolean
  pendingCount?: number
}

export function NewsShell({
  chrome,
  children,
  heading,
  lede,
}: {
  chrome: NewsChrome
  children: React.ReactNode
  /** Overrides the section title on a filtered view (a category, a tag, an author). */
  heading?: React.ReactNode
  lede?: React.ReactNode
}) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <header className="border-b border-border pb-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-display text-xs font-semibold uppercase tracking-[0.18em] text-brand">
              The Break
            </p>
            <h1 className="mt-1 font-display text-3xl font-bold tracking-tight sm:text-4xl">
              {heading ?? 'News'}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{lede ?? NEWS_SUBTITLE}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {chrome.isAdmin && (
              <Link
                href="/staff/news"
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:border-brand/40 hover:text-foreground"
              >
                <ShieldCheck className="size-4" aria-hidden />
                Editorial
                {chrome.pendingCount ? <Badge variant="gold">{chrome.pendingCount}</Badge> : null}
              </Link>
            )}
            {chrome.canWrite && (
              <Link
                href="/news/new"
                className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-medium text-brand-foreground hover:bg-[var(--selected-surface)]"
              >
                <PenLine className="size-4" aria-hidden />
                Write an article
              </Link>
            )}
          </div>
        </div>

        <nav aria-label="Article categories" className="mt-5 flex flex-wrap items-center gap-2">
          <CategoryLink href="/news" label="All" active={!chrome.activeCategory} />
          {chrome.categories.map((c) => (
            <CategoryLink
              key={c.slug}
              href={`/news/category/${c.slug}`}
              label={c.name}
              count={c.articleCount}
              active={chrome.activeCategory === c.slug}
            />
          ))}

          <form method="get" action="/news" className="ml-auto flex items-center gap-1.5">
            <label htmlFor="news-search" className="sr-only">Search articles</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                id="news-search"
                type="search"
                name="q"
                defaultValue={chrome.search ?? ''}
                placeholder="Search articles…"
                className="w-44 rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25 sm:w-56"
              />
            </div>
          </form>
        </nav>
      </header>

      {children}
    </div>
  )
}

function CategoryLink({
  href, label, count, active,
}: { href: string; label: string; count?: number; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={[
        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-brand/50 bg-[var(--selected-surface)] text-brand'
          : 'border-border text-muted-foreground hover:border-brand/30 hover:text-foreground',
      ].join(' ')}
    >
      {label}
      {count != null && count > 0 && <span className="ml-1.5 opacity-60">{count}</span>}
    </Link>
  )
}

/** Shared empty state. Every listing can legitimately be empty, so it should look deliberate. */
export function NewsEmpty({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border py-16 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

/** Page-number links. Rendered as links so the listing works without JavaScript. */
export function Pagination({
  page, pageCount, hrefFor,
}: { page: number; pageCount: number; hrefFor: (page: number) => string }) {
  if (pageCount <= 1) return null
  const pages = pageNumbers(page, pageCount)

  return (
    <nav aria-label="Pagination" className="mt-8 flex flex-wrap items-center justify-center gap-1.5">
      {page > 1 && (
        <Link href={hrefFor(page - 1)} className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-brand/40">
          Previous
        </Link>
      )}
      {pages.map((p, i) =>
        p === null ? (
          <span key={`gap-${i}`} className="px-1 text-sm text-muted-foreground">…</span>
        ) : (
          <Link
            key={p}
            href={hrefFor(p)}
            aria-current={p === page ? 'page' : undefined}
            className={[
              'min-w-9 rounded-md border px-3 py-1.5 text-center text-sm',
              p === page ? 'border-brand/50 bg-[var(--selected-surface)] text-brand' : 'border-border hover:border-brand/40',
            ].join(' ')}
          >
            {p}
          </Link>
        ),
      )}
      {page < pageCount && (
        <Link href={hrefFor(page + 1)} className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-brand/40">
          Next
        </Link>
      )}
    </nav>
  )
}

/** First, last, and a window around the current page; `null` marks an elision. */
function pageNumbers(page: number, pageCount: number): (number | null)[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1)
  const out: (number | null)[] = [1]
  const from = Math.max(2, page - 1)
  const to = Math.min(pageCount - 1, page + 1)
  if (from > 2) out.push(null)
  for (let p = from; p <= to; p += 1) out.push(p)
  if (to < pageCount - 1) out.push(null)
  out.push(pageCount)
  return out
}
