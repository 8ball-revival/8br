import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

import type { HomeNews } from '@/lib/home/news'

/**
 * Competition History: the acid feature panel that opens the homepage.
 *
 * ── It replaces the banner, rather than sitting under it ─────────────────────────────────────────
 * The homepage used to open with a 2.2MB photographic hero, and that image was the site's identity
 * on arrival. This panel is the identity now: it says what the site IS in one sentence, and it does
 * it in type rather than in a background image, so it costs nothing to load, scales to any width and
 * stays legible at every size.
 *
 * ── Two halves, one panel ────────────────────────────────────────────────────────────────────────
 * The statement takes the majority of the width and Latest News is separated on the right by a rule.
 * They belong together because they answer consecutive questions — what is this, and what happened
 * recently — and splitting them into two panels would have put a border between a question and its
 * follow-up.
 */
export function CompetitionHistory({ news }: { news: HomeNews }) {
  /*
   * The three most recent items, taken from the existing news service.
   *
   * `featured` rotates hourly and may be an older piece, so it is included only when it is not
   * already one of the two newest — otherwise the list would show the same headline twice.
   */
  const items = [news.latest, news.second, news.featured]
    .filter((a): a is NonNullable<typeof a> => a != null)
    .filter((a, i, all) => all.findIndex((b) => b.id === a.id) === i)
    /*
     * Sorted by date, because the heading says Latest News.
     *
     * The three come from the service as [latest, second, featured], and `featured` rotates hourly
     * and can be older than both. Rendering them in that order put an older piece at the bottom or a
     * newer one out of sequence depending on the hour, so the list is ordered by what it claims to
     * be ordered by.
     */
    .sort((a, b) => b.publishAt.getTime() - a.publishAt.getTime())
    .slice(0, 3)

  return (
    <section
      aria-labelledby="competition-history-heading"
      className="cyber-clip relative grid gap-5 border border-[var(--acid-dim)] bg-[var(--acid)] p-5 text-[var(--acid-ink)] lg:grid-cols-[minmax(0,62fr)_minmax(0,38fr)] lg:p-6"
    >
      {/*
        The technical linework from the design, drawn in ink rather than red.

        Red on acid is the one pairing that stays legible at full strength, and it is used for the
        button below; a red hairline grid behind the type as well would make the panel vibrate. These
        are the ink colour at low alpha, which reads as an engraved detail.
      */}
      <span aria-hidden className="pointer-events-none absolute left-0 top-0 size-4 border-l-2 border-t-2 border-[var(--acid-ink)]" />
      <span aria-hidden className="pointer-events-none absolute bottom-0 right-0 size-4 border-b-2 border-r-2 border-[var(--acid-ink)]" />

      <div className="min-w-0">
        <p className="eyebrow flex items-center gap-2 text-[var(--acid-ink)]/70">
          Welcome to 8 Ball Registry
          {/* The slash pair is a decorative mark from the design; braced so it is a string, not a comment. */}
          <span aria-hidden className="text-[var(--hot-red)]">{'//'}</span>
        </p>

        <h1
          id="competition-history-heading"
          className="mt-3 font-display text-4xl font-bold uppercase leading-[0.95] tracking-tight sm:text-5xl lg:text-6xl"
        >
          Competition
          <br />
          History
        </h1>

        <p className="mt-4 max-w-xl text-base font-semibold leading-snug sm:text-lg">
          Explore seasons, tournaments, champions, and results from across the competitive 8-ball
          community.
        </p>
        <p className="mt-2 max-w-xl text-sm italic text-[var(--acid-ink)]/60">
          Every competition. Every result. One permanent record.
        </p>

        <Link
          href="/rankings"
          className="cyber-clip-sm mt-6 inline-flex items-center gap-2 bg-[var(--hot-red)] px-6 py-3 text-sm font-bold uppercase tracking-[0.12em] text-[var(--clean-white)] transition-colors hover:bg-[var(--hot-red-dim)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--void)]"
        >
          Rankings
        </Link>
      </div>

      <div className="min-w-0 border-t border-[var(--acid-ink)]/25 pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
        <h2 className="eyebrow text-[var(--acid-ink)]/70">Latest News</h2>
        {items.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--acid-ink)]/70">
            Nothing published yet. Match reports and write-ups land here.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {items.map((a) => (
              <li key={a.id} className="flex gap-2 border-b border-[var(--acid-ink)]/15 pb-3 last:border-b-0 last:pb-0">
                <span aria-hidden className="mt-[0.45rem] size-1.5 shrink-0 rounded-full bg-[var(--hot-red)]" />
                <span className="min-w-0">
                  <Link
                    href={`/the-break/${a.slug}`}
                    className="block text-sm font-semibold leading-snug underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--void)]"
                  >
                    {a.title}
                  </Link>
                  <time
                    dateTime={a.publishAt.toISOString()}
                    className="tabular mt-1 block text-[0.65rem] font-bold uppercase tracking-wider text-[var(--acid-ink)]/55"
                  >
                    {a.publishAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </time>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

/** The arrow is exported for the sibling panels so the affordance is drawn once. */
export function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-[0.66rem] font-bold uppercase tracking-[0.12em] text-[var(--hot-red)] underline-offset-4 transition-colors hover:text-[var(--acid)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      {children}
      <ArrowRight className="size-3" aria-hidden />
    </Link>
  )
}
