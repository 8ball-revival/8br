import { ArrowUpRight, ExternalLink } from 'lucide-react'

import { formatDateTime } from '@/lib/format'
import { CUEVERSE_HOME_URL, CUEVERSE_LEADERBOARD_URL } from '@/lib/cueverse/provider'
import type { CueVerseSnapshotView } from '@/lib/cueverse/service'

/**
 * The two CueVerse cards.
 *
 * CueVerse is a separate product with its own identity, so these use its navy/teal palette rather
 * than the registry's gold. That is not decoration: the page shows two different ranking systems,
 * and a visitor has to be able to tell at a glance that the CueVerse five are not 8 Ball Registry
 * standings.
 */

/**
 * The promotional card. The whole surface is the link.
 *
 * One anchor wraps everything — no button inside a clickable card, one tab stop, one visible focus
 * ring. The arrow is the external-link indicator, and `rel` keeps the opened page from reaching back
 * through `window.opener`.
 */
export function CueVersePromoCard() {
  return (
    <a
      href={CUEVERSE_HOME_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative flex flex-col overflow-hidden rounded-lg border border-[#1d3a5c] bg-[#0a1628] p-5 transition-colors hover:border-[#2fd4c7]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2fd4c7]/70"
    >
      {/* Depth only — a soft teal wash from the corner, no animation. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-gradient-to-br from-[#2fd4c7]/20 to-transparent blur-2xl"
      />

      <div className="relative flex items-center gap-2.5">
        {/*
          Plain <img> rather than next/image: these are fixed-size brand assets already served from
          /public, so the optimizer has nothing to add, and width/height are given explicitly so the
          space is reserved before they load. Both are the official CueVerse files, stored locally
          rather than hotlinked.
        */}
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

      <p className="relative mt-4 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-[#2fd4c7]">
        Free online multiplayer pool
      </p>

      <h3 className="relative mt-1.5 font-display text-lg font-bold leading-tight tracking-tight text-white">
        Play 8 Ball Pool Online Free
      </h3>

      <p className="relative mt-2 text-sm leading-relaxed text-[#9fb3cc]">
        Real-time multiplayer 8-ball and 9-ball pool—play directly in your browser on desktop or mobile.
      </p>

      <span className="relative mt-auto inline-flex items-center gap-1.5 pt-4 text-sm font-semibold text-[#2fd4c7] group-hover:gap-2.5 motion-safe:transition-all">
        Continue Playing
        <ArrowUpRight className="size-4" aria-hidden />
        <span className="sr-only">(opens cueverse.gg in a new tab)</span>
      </span>
    </a>
  )
}

/**
 * The CueVerse top five.
 *
 * Read entirely from the local snapshot. This never calls CueVerse — a page render must not wait on
 * somebody else's service, and the daily job is what keeps the figures current.
 */
export function CueVerseTop5Card({ snapshot }: { snapshot: CueVerseSnapshotView | null }) {
  return (
    <section
      aria-labelledby="cueverse-top5-heading"
      className="flex flex-col overflow-hidden rounded-lg border border-[#1d3a5c] bg-[#0a1628]"
    >
      <div className="border-b border-[#1d3a5c] p-4">
        <h3
          id="cueverse-top5-heading"
          className="font-display text-sm font-bold uppercase tracking-[0.14em] text-[#2fd4c7]"
        >
          CueVerse Top 5
        </h3>
        <p className="mt-1 text-xs text-[#7e93ad]">Current in-game ratings</p>
        {snapshot && (
          <p className="mt-1 text-[0.7rem] text-[#5f74a0]">
            Updated {formatDateTime(snapshot.fetchedAt)}
          </p>
        )}
      </div>

      <div className="flex-1">
        {!snapshot ? (
          <div className="flex h-full flex-col justify-center gap-1 p-4">
            <p className="text-sm text-[#9fb3cc]">The CueVerse leaderboard is unavailable right now.</p>
            <p className="text-xs text-[#7e93ad]">It is refreshed daily; the live board is always available on CueVerse.</p>
          </div>
        ) : (
          <>
            {snapshot.stale && (
              <p className="border-b border-[#1d3a5c] bg-[#12233c] px-4 py-1.5 text-[0.7rem] text-[#c9a227]">
                Last successful update was over {Math.floor(snapshot.ageHours / 24)} day
                {Math.floor(snapshot.ageHours / 24) === 1 ? '' : 's'} ago.
              </p>
            )}
            <ol>
              {snapshot.entries.map((e) => (
                <li
                  key={e.rank}
                  className="flex items-center gap-3 border-b border-[#162c47] px-4 py-2 last:border-b-0"
                >
                  <span className="inline-flex size-6 shrink-0 items-center justify-center rounded bg-[#12233c] text-xs font-semibold tabular-nums text-[#2fd4c7]">
                    {e.rank}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-white">{e.name}</span>
                  {e.wins != null && e.losses != null && (
                    <span className="shrink-0 text-xs tabular-nums text-[#7e93ad]">{e.wins}–{e.losses}</span>
                  )}
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-[#2fd4c7]">{e.rating}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>

      <div className="border-t border-[#1d3a5c] p-3">
        <a
          href={CUEVERSE_LEADERBOARD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-sm text-[#2fd4c7] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2fd4c7]/70"
        >
          View full leaderboard
          <ExternalLink className="size-3.5" aria-hidden />
          <span className="sr-only">(opens cueverse.gg in a new tab)</span>
        </a>
      </div>
    </section>
  )
}
