import { ArrowUpRight, ExternalLink } from 'lucide-react'

import { formatDateTime } from '@/lib/format'
import { CUEVERSE_HOME_URL, CUEVERSE_LEADERBOARD_URL } from '@/lib/cueverse/provider'
import type { CueVerseSnapshotView } from '@/lib/cueverse/service'

/**
 * The Competition Center: the CueVerse promotion and the CueVerse top five, side by side in one
 * panel.
 *
 * Deliberately styled in the site's own palette — near-black, charcoal, neutral borders, white and
 * muted-grey text, gold for headings and actions. The only blue on the panel is the official CueVerse
 * logo itself. An earlier version used CueVerse's navy and cyan across the whole card, and the effect
 * was of a section pasted in from another website; the content is external, the chrome should not be.
 *
 * The distinction from the 8 Ball Registry Top 10 is carried by wording and placement instead:
 * "Current in-game ratings" against "external", in the main column rather than the ranking sidebar.
 */

export function CompetitionCenter({ snapshot }: { snapshot: CueVerseSnapshotView | null }) {
  return (
    <section aria-labelledby="competition-center-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2">
        <h2
          id="competition-center-heading"
          className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-brand"
        >
          Competition Center
        </h2>
        <p className="text-xs text-muted-foreground">CueVerse · external</p>
      </div>

      <div className="mt-4 grid items-stretch gap-4 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <CueVersePromo />
        <CueVerseTop5 snapshot={snapshot} />
      </div>
    </section>
  )
}

/**
 * The promotional card. One anchor wraps the whole surface, so there is no button nested inside a
 * clickable card, one tab stop, and one focus ring.
 */
function CueVersePromo() {
  return (
    <a
      href={CUEVERSE_HOME_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative flex flex-col overflow-hidden rounded-none border border-border bg-card/40 p-5 transition-colors hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
    >
      {/*
        The official CueVerse assets, stored locally rather than hotlinked, and left exactly as
        supplied — not recoloured, not redrawn. Explicit dimensions reserve the space so nothing
        shifts as they load.
      */}
      <div className="flex items-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
        <img
          src="/assets/cueverse/cueverse-mark.webp"
          alt=""
          width={399}
          height={268}
          className="h-7 w-auto"
          aria-hidden
        />
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
        <img
          src="/assets/cueverse/cueverse-wordmark.webp"
          alt="CueVerse"
          width={544}
          height={76}
          className="h-4 w-auto"
        />
      </div>

      <p className="mt-4 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-brand">
        Free online multiplayer pool
      </p>

      <h3 className="mt-1.5 font-display text-lg font-bold leading-tight tracking-tight">
        Play 8 Ball Pool Online Free
      </h3>

      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Real-time multiplayer 8-ball and 9-ball pool—play directly in your browser on desktop or mobile.
      </p>

      <span className="mt-auto inline-flex items-center gap-1.5 pt-4 text-sm font-medium text-brand group-hover:underline">
        Continue Playing
        <ArrowUpRight className="size-4" aria-hidden />
        <span className="sr-only">(opens cueverse.gg in a new tab)</span>
      </span>
    </a>
  )
}

/**
 * The mirrored top five.
 *
 * Read entirely from the local snapshot — a page render never calls CueVerse, so an outage there
 * cannot slow or break this one. Gold carries the rank emphasis, matching the rest of the homepage.
 */
function CueVerseTop5({ snapshot }: { snapshot: CueVerseSnapshotView | null }) {
  return (
    <section
      aria-labelledby="cueverse-top5-heading"
      className="flex flex-col overflow-hidden rounded-none border border-border bg-card/40"
    >
      <div className="border-b border-border px-4 py-3">
        <h3
          id="cueverse-top5-heading"
          className="font-display text-sm font-bold uppercase tracking-[0.14em] text-brand"
        >
          CueVerse Top 5
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">Current in-game ratings</p>
        {snapshot && (
          <p className="mt-0.5 text-[0.7rem] text-muted-foreground/80">
            Updated {formatDateTime(snapshot.fetchedAt)}
          </p>
        )}
      </div>

      <div className="flex-1">
        {!snapshot ? (
          <div className="flex h-full flex-col justify-center gap-1 p-4">
            <p className="text-sm text-muted-foreground">The CueVerse leaderboard is unavailable right now.</p>
            <p className="text-xs text-muted-foreground/80">
              It refreshes daily; the live board is always on CueVerse.
            </p>
          </div>
        ) : (
          <>
            {snapshot.stale && (
              <p className="border-b border-border bg-warning/[0.07] px-4 py-1.5 text-[0.7rem] text-warning">
                Last successful update was over {Math.floor(snapshot.ageHours / 24)} day
                {Math.floor(snapshot.ageHours / 24) === 1 ? '' : 's'} ago.
              </p>
            )}
            <ol className="divide-y divide-border">
              {snapshot.entries.map((e) => (
                <li key={e.rank} className="flex items-center gap-3 px-4 py-2">
                  <span
                    className={`inline-flex size-6 shrink-0 items-center justify-center rounded text-xs font-semibold tabular-nums ${
                      e.rank === 1 ? 'bg-[var(--selected-surface)] text-brand' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {e.rank}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{e.name}</span>
                  {e.wins != null && e.losses != null && (
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {e.wins}–{e.losses}
                    </span>
                  )}
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{e.rating}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>

      <div className="border-t border-border px-4 py-2.5">
        <a
          href={CUEVERSE_LEADERBOARD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md text-sm text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          View full leaderboard
          <ExternalLink className="size-3.5" aria-hidden />
          <span className="sr-only">(opens cueverse.gg in a new tab)</span>
        </a>
      </div>
    </section>
  )
}
