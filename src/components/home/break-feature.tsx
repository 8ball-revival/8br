import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

import type { HomeNews } from '@/lib/home/news'

/**
 * The Break feature: the acid panel that opens the homepage.
 *
 * ── Real articles only ───────────────────────────────────────────────────────────────────────────
 * Headline, excerpt, byline and dates all come from the article the existing `getHomeNews` service
 * selected. Nothing here composes a headline, and the panel does not exist when there is no eligible
 * article to put in it — a fabricated "2026 Season Championships kick off this weekend", which is
 * what the mock showed, would be the site publishing something nobody wrote.
 *
 * The article's own visibility rules are the service's business, so an unpublished or restricted
 * piece cannot reach this panel by being rendered differently.
 *
 * ── Why the largest acid surface after the navigation ────────────────────────────────────────────
 * This is what carries the yellow to its intended share of the viewport. It also puts the editorial
 * voice first, which is the point of leading with The Break rather than with a table.
 */
export function BreakFeature({ news }: { news: HomeNews }) {
  const { featured, latest, second } = news
  if (!featured) return <BreakFallback />

  const others = [latest, second].filter(
    (a): a is NonNullable<typeof a> => a != null && a.id !== featured.id,
  )

  return (
    <section
      aria-labelledby="break-feature-heading"
      className="cyber-clip grid gap-5 border border-[var(--acid-dim)] bg-[var(--acid)] p-5 text-[var(--acid-ink)] lg:grid-cols-[minmax(0,62fr)_minmax(0,38fr)]"
    >
      <div className="min-w-0">
        <p className="eyebrow text-[var(--acid-ink)]/70">The Break</p>

        <h2 id="break-feature-heading" className="mt-2 font-display text-2xl font-bold uppercase leading-[1.05] tracking-tight sm:text-3xl lg:text-4xl">
          <Link
            href={`/the-break/${featured.slug}`}
            className="underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--void)]"
          >
            {featured.title}
          </Link>
        </h2>

        {featured.excerpt && (
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-[var(--acid-ink)]/80">
            {featured.excerpt}
          </p>
        )}

        <p className="mt-3 text-[0.68rem] font-semibold uppercase tracking-wider text-[var(--acid-ink)]/60">
          {featured.author}
          {featured.categoryName ? ` · ${featured.categoryName}` : ''}
          {` · ${featured.readingMinutes} min read`}
        </p>

        {/*
          Red on acid: the one call to action on the panel, and the only place these two colours meet
          as a fill. It clears AA comfortably at this size and is unmistakable against the yellow.
        */}
        <Link
          href={`/the-break/${featured.slug}`}
          className="cyber-clip-sm mt-4 inline-flex items-center gap-2 bg-[var(--hot-red)] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-[var(--clean-white)] transition-colors hover:bg-[var(--hot-red-dim)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--void)]"
        >
          Read The Break
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>

      {others.length > 0 && (
        <div className="min-w-0 border-t border-[var(--acid-ink)]/20 pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
          <h3 className="eyebrow text-[var(--acid-ink)]/70">Latest news</h3>
          <ul className="mt-2 space-y-3">
            {others.map((a) => (
              <li key={a.id} className="flex gap-2">
                <span className="mt-[0.45rem] size-1.5 shrink-0 rounded-full bg-[var(--hot-red)]" aria-hidden />
                <span className="min-w-0">
                  <Link
                    href={`/the-break/${a.slug}`}
                    className="block text-sm font-semibold leading-snug underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--void)]"
                  >
                    {a.title}
                  </Link>
                  <time
                    dateTime={a.publishAt.toISOString()}
                    className="mt-0.5 block text-[0.65rem] font-semibold uppercase tracking-wider text-[var(--acid-ink)]/55"
                  >
                    {a.publishAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </time>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/**
 * Shown when no article is eligible.
 *
 * Keeps the panel's shape so the page does not reflow around an absence, and says plainly that there
 * is nothing rather than inventing something to fill it.
 */
function BreakFallback() {
  return (
    <section className="cyber-clip border border-[var(--acid-dim)] bg-[var(--acid)] p-5 text-[var(--acid-ink)]">
      <p className="eyebrow text-[var(--acid-ink)]/70">The Break</p>
      <h2 className="mt-2 font-display text-2xl font-bold uppercase tracking-tight">
        Nothing published yet
      </h2>
      <p className="mt-2 max-w-lg text-sm text-[var(--acid-ink)]/75">
        Match reports, season write-ups and everything else land here.
      </p>
      <Link
        href="/the-break"
        className="cyber-clip-sm mt-4 inline-flex items-center gap-2 bg-[var(--hot-red)] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-[var(--clean-white)] transition-colors hover:bg-[var(--hot-red-dim)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--void)]"
      >
        Visit The Break
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </section>
  )
}
