import Link from 'next/link'

import type { LeaderRow } from '@/lib/home/leaderboard'
import { cn } from '@/lib/utils'

/**
 * The top five, as a rail across the page rather than a panel down the side.
 *
 * ── Why the shape changed ───────────────────────────────────────────────────────────────────────
 * This used to be a tall panel in the hero's right third, which put it in competition with the
 * champion presentation for the same corner and made the page's most-read number — who is first —
 * appear twice within a few hundred pixels. As a rail it is one line, it sits directly beneath the
 * hero, and the champion appears once: named in the hero, and marked here as rank one.
 *
 * ── The angled separators ───────────────────────────────────────────────────────────────────────
 * Each segment is cut by a skewed border rather than a straight rule. `transform: skewX` on a
 * pseudo-element would tilt the text with it, so the tilt is drawn as a border on an absolutely
 * positioned sliver and the content is left upright.
 *
 * ── What happens when it does not fit ───────────────────────────────────────────────────────────
 * Below `lg` this scrolls horizontally with snap points rather than wrapping five ranks into an
 * unreadable grid, and the scroller carries the themed scrollbar and a real focus ring so it is
 * reachable and visible by keyboard. It is the one horizontal scroller on the page and it never
 * makes the PAGE scroll: the section clips, the rail inside it moves.
 */
export function RankingsRail({
  label, platformLabel, rows, viewAllLabel, viewAllHref, ratingLabel,
}: {
  label: string
  platformLabel: string
  rows: LeaderRow[]
  viewAllLabel: string
  viewAllHref: string
  ratingLabel: string
}) {
  if (!rows.length) return null

  return (
    <section
      aria-labelledby="home-rail-heading"
      className="relative border-b border-[var(--line-strong)] bg-[var(--void)]"
    >
      <div className="mx-auto w-full max-w-[var(--sb-container-width,96rem)] px-4 sm:px-6 lg:px-8">
        <div
          className={cn(
            'scrollbar-themed flex items-stretch overflow-x-auto',
            'snap-x snap-mandatory lg:snap-none lg:overflow-visible',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]',
          )}
          tabIndex={0}
          role="region"
          aria-label={`${label}, scrollable`}
        >
          {/* ── What this rail is ──────────────────────────────────────────────────────────────── */}
          <div className="relative flex shrink-0 snap-start flex-col justify-center py-4 pr-8 lg:pr-6 xl:pr-9">
            <h2 id="home-rail-heading" className="font-condensed text-[0.78rem] font-bold uppercase tracking-[0.26em] text-[var(--text-primary)]">
              {label}
            </h2>
            <p className="mt-1 flex items-center gap-2 font-condensed text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-[var(--steel-bright)]">
              <span aria-hidden className="h-px w-5 bg-[var(--signal)]" />
              {platformLabel}
            </p>
            <Slash />
          </div>

          {rows.map((r) => {
            const first = r.rank === 1
            const primary = r.cueverseId ?? r.preferredName
            const secondary = r.cueverseId ? r.preferredName : null
            const inner = (
              <>
                <span
                  aria-hidden
                  className={cn(
                    'font-condensed font-extrabold leading-none [font-variant-numeric:tabular-nums]',
                    first ? 'text-[var(--signal)]' : 'text-[var(--steel)]',
                  )}
                  style={{ fontSize: first ? '1.9rem' : '1.5rem' }}
                >
                  {r.rank}
                </span>
                <span className="min-w-0 flex-1">
                  {/*
                    Truncated with the full identity in `title`, because a CueVerse ID can be
                    `xlx_britishpoolking_xlx` and a rail is not the place to let one name push the
                    other four off the page.
                  */}
                  <span
                    className={cn(
                      'block truncate font-condensed text-base font-bold uppercase tracking-[0.02em]',
                      first ? 'text-[var(--text-primary)]' : 'text-[var(--text-primary)]',
                    )}
                    title={primary}
                  >
                    {primary}
                  </span>
                  {secondary && (
                    <span className="block truncate text-[0.78rem] italic leading-tight text-[var(--text-muted)]" title={secondary}>
                      {secondary}
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-condensed text-lg font-bold leading-none text-[var(--text-primary)] [font-variant-numeric:tabular-nums]">
                  {r.rating.toLocaleString()}
                </span>
              </>
            )

            /*
              Tighter from `lg` up, because that is where the names were being cut.

              Each segment holds a rank, a two-line identity and a rating, and they share the width
              equally. At 1600 that was enough for "STARKILLER"; at 1440 the same padding left about
              eighty pixels for the name and every entry ended in an ellipsis. The padding is the
              part with no information in it, so it goes first -- the truncation itself stays, for
              the genuinely long handles it was written for.
            */
            const cls = cn(
              'relative flex shrink-0 snap-start items-center gap-3 py-4 pl-6 pr-8',
              'lg:gap-2.5 lg:pl-4 lg:pr-5 xl:gap-3 xl:pl-6 xl:pr-7',
              'min-w-[15rem] lg:min-w-0 lg:flex-1',
              'transition-colors hover:bg-[color-mix(in_oklab,var(--surface-plaque)_70%,transparent)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]',
            )

            return r.slug ? (
              <Link
                key={r.playerId}
                href={`/players/${encodeURIComponent(r.slug)}`}
                className={cls}
                aria-label={`Rank ${r.rank}, ${primary}${secondary ? `, ${secondary}` : ''}, ${ratingLabel.toLowerCase()} ${r.rating}`}
              >
                {inner}
                <Slash />
              </Link>
            ) : (
              <div key={r.playerId} className={cls}>
                {inner}
                <Slash />
              </div>
            )
          })}

          <div className="relative flex shrink-0 snap-start items-center py-4 pl-6 lg:pl-4 xl:pl-7">
            <Link
              href={viewAllHref}
              className="inline-flex min-h-6 items-center gap-2 py-1 font-condensed text-[0.72rem] font-bold uppercase leading-tight tracking-[0.2em] text-[var(--steel-bright)] transition-colors hover:text-[var(--signal)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              {viewAllLabel}
              <span aria-hidden>&rarr;</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * The angled cut between two segments.
 *
 * A skewed left border on a two-pixel-wide absolutely positioned sliver, drawn at the END of a
 * segment so the first one has nothing before it. `pointer-events-none` because it overlaps the
 * neighbouring link and would otherwise swallow clicks along its edge.
 */
function Slash() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-y-3 right-0 w-px -skew-x-12 bg-[color-mix(in_oklab,var(--steel-dim)_70%,transparent)] last:hidden"
    />
  )
}
