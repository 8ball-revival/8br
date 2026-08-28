'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { Achievement } from '@/lib/achievements/types'

/**
 * The Achievements strip.
 *
 * ── A window over a shuffled list, not a scrolling track ─────────────────────────────────────────
 * The previous version laid every card in a scroll-snap row. That was fine for eighteen and wrong
 * for a set meant to grow: the arrows nudged a scrollbar, cards half-appeared at the edges, and
 * there was no notion of having seen one already.
 *
 * This shows a WINDOW of N whole cards and pages through the list. Nothing is ever half-visible, the
 * arrows move by a full page, and because the page index is bounded the strip can hold hundreds of
 * achievements without changing shape.
 *
 * ── Why N is measured rather than assumed ────────────────────────────────────────────────────────
 * The card has a minimum readable width. Rather than forcing five into whatever space exists and
 * letting them crush, the component measures its own width and shows as many whole cards as fit,
 * capped at five. That is what makes the count fall 5 → 4 → 3 → 2 → 1 naturally, including at zoom
 * levels and font sizes nobody thought to test.
 *
 * ── The order comes from the server ──────────────────────────────────────────────────────────────
 * Shuffled per request by the page, so a refresh brings a different five. The client never
 * re-shuffles: doing so on mount would mean the cards visibly change a moment after they appear,
 * and doing so on resize would move somebody's place in the list while they were reading it.
 */

/** Below this a card stops being readable, so a sixth is never squeezed in. */
const MIN_CARD_PX = 210
const MAX_VISIBLE = 5
const GAP_PX = 12

export function AchievementsCarousel({ achievements }: { achievements: Achievement[] }) {
  const trackRef = useRef<HTMLDivElement>(null)
  /*
   * Null until measured, and CSS handles the layout in the meantime.
   *
   * Seeding this with a number means the first paint is wrong for everybody it does not match: at 1
   * a desktop shows a single card and jumps to five when JavaScript arrives; at 5 a phone shows five
   * crushed columns first. `auto-fit` below fits whole cards with no script at all, so the server
   * render is already correct at every width and the measurement only refines the PAGING.
   */
  const [visible, setVisible] = useState<number | null>(null)
  const [page, setPage] = useState(0)

  /* How many whole cards fit right now. */
  const measure = useCallback(() => {
    const el = trackRef.current
    if (!el) return
    const width = el.clientWidth
    if (width <= 0) return
    const fit = Math.floor((width + GAP_PX) / (MIN_CARD_PX + GAP_PX))
    setVisible(Math.max(1, Math.min(MAX_VISIBLE, fit)))
  }, [])

  useEffect(() => {
    measure()
    const el = trackRef.current
    if (!el) return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure])

  const total = achievements.length
  /* Before measurement, assume the desktop maximum: CSS is showing whatever actually fits. */
  const windowSize = visible ?? MAX_VISIBLE
  const pages = Math.max(1, Math.ceil(total / windowSize))

  /*
   * The position is clamped during render, not corrected in an effect.
   *
   * Resizing changes how many pages exist, so a stored index can fall off the end. Fixing that with
   * `useEffect(() => setPage(...))` is a synchronous setState inside an effect — a cascading render,
   * and the browser paints the invalid page for one frame first. Deriving the safe value costs
   * nothing and there is no intermediate state to see.
   *
   * Clamping rather than resetting also means widening the window does not throw somebody back to
   * the first card.
   */
  const safePage = Math.min(page, pages - 1)

  if (total === 0) return null

  const start = safePage * windowSize
  const shown = achievements.slice(start, start + windowSize)
  const atStart = safePage === 0
  const atEnd = safePage >= pages - 1

  return (
    <section
      aria-labelledby="achievements-heading"
      className="dl-surface dl-on-light cyber-clip relative border border-[var(--acid-dim)] bg-[var(--acid)] p-4 text-[var(--acid-ink)]"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2
            id="achievements-heading"
            className="font-display text-sm font-bold uppercase tracking-[0.14em] text-[var(--acid-ink)]"
          >
            Achievements
          </h2>
          <p className="text-xs text-[var(--acid-ink)]/70">
            Celebrating the shots that make us question everything.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/achievements"
            className="text-[0.68rem] font-bold uppercase tracking-wider text-[var(--acid-ink)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--void)]"
          >
            View all achievements
          </Link>
          {pages > 1 && (
            <div className="flex items-center gap-1">
              <Arrow dir="left" onClick={() => setPage(Math.max(0, safePage - 1))} disabled={atStart} />
              {/* Position, so somebody paging a long list knows where they are. */}
              <span className="tabular px-1 text-[0.65rem] font-bold text-[var(--acid-ink)]/70" aria-hidden>
                {safePage + 1}/{pages}
              </span>
              <Arrow dir="right" onClick={() => setPage(Math.min(pages - 1, safePage + 1))} disabled={atEnd} />
            </div>
          )}
        </div>
      </div>

      <div ref={trackRef}>
        {/*
          `auto-fit` with a minimum card width is what makes the count fall 5 → 4 → 3 → 2 → 1.
          The browser fits as many whole 210px-or-wider cards as the space allows and no more, so a
          card is never crushed to make a fifth fit, and it works at any zoom or font size without
          anybody choosing breakpoints.
        */}
        <ul
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${MIN_CARD_PX}px, 1fr))` }}
          aria-live="polite"
        >
          {shown.map((a) => (
            <li key={a.id}>
              <AchievementCard achievement={a} />
            </li>
          ))}
        </ul>
      </div>

      <p className="sr-only" aria-live="polite">
        Showing {start + 1} to {Math.min(start + windowSize, total)} of {total} achievements.
      </p>
    </section>
  )
}

function Arrow({ dir, onClick, disabled }: { dir: 'left' | 'right'; onClick: () => void; disabled: boolean }) {
  const Icon = dir === 'left' ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === 'left' ? 'Previous achievements' : 'Next achievements'}
      className={cn(
        'cyber-clip-sm inline-flex size-7 items-center justify-center border border-[var(--acid-ink)]/40 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--void)]',
        disabled
          ? 'cursor-not-allowed opacity-30'
          : 'hover:border-[var(--acid-ink)] hover:bg-[var(--acid-ink)] hover:text-[var(--acid)]',
      )}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  )
}

/**
 * One card.
 *
 * The identity follows the site rule: the CueVerse ID leads, the Preferred Name sits under it. A
 * site-wide award has no player, so it renders the fact where the name would be rather than leaving
 * a gap the eye reads as a missing value.
 */
export function AchievementCard({ achievement: a }: { achievement: Achievement }) {
  return (
    <article className="flex h-full flex-col border border-[var(--acid-ink)]/25 bg-[var(--acid)] p-3">
      <h3 className="font-display text-[0.78rem] font-bold uppercase leading-tight tracking-wide text-[var(--acid-ink)]">
        {a.title}
      </h3>

      <div className="mt-2 min-h-[2.2rem]">
        {a.winners.length > 0 ? (
          <ul className="space-y-0.5">
            {a.winners.slice(0, 2).map((w) => (
              <li key={w.playerId} className="leading-tight">
                {w.href ? (
                  <Link
                    href={w.href}
                    className="text-sm font-bold text-[var(--acid-ink)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--void)]"
                  >
                    {w.cueverseId ?? w.preferredName}
                  </Link>
                ) : (
                  <span className="text-sm font-bold text-[var(--acid-ink)]">
                    {w.cueverseId ?? w.preferredName}
                  </span>
                )}
                {w.preferredName && w.preferredName.toLowerCase() !== (w.cueverseId ?? '').toLowerCase() && (
                  <span className="ml-1 text-[0.7rem] text-[var(--acid-ink)]/65">{w.preferredName}</span>
                )}
              </li>
            ))}
            {a.winners.length > 2 && (
              <li className="text-[0.7rem] font-semibold text-[var(--acid-ink)]/65">
                and {a.winners.length - 2} more
              </li>
            )}
          </ul>
        ) : (
          <p className="text-sm font-bold text-[var(--acid-ink)]">{a.stat || 'No qualifying player yet'}</p>
        )}
      </div>

      {a.winners.length > 0 && a.stat && (
        <p className="tabular mt-1 text-[0.72rem] font-bold uppercase tracking-wide text-[var(--acid-ink)]/80">
          {a.stat}
        </p>
      )}

      {a.caption && <p className="mt-2 text-[0.72rem] leading-snug text-[var(--acid-ink)]/75">{a.caption}</p>}

      {/*
        The arithmetic, kept on the card rather than hidden behind a tooltip. The joke is only funny
        if the number behind it is checkable.
      */}
      {a.detail && <p className="mt-auto pt-2 text-[0.66rem] leading-snug text-[var(--acid-ink)]/60">{a.detail}</p>}
    </article>
  )
}
