'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { Achievement } from '@/lib/achievements/types'

/**
 * The Achievements strip.
 *
 * ── Native scrolling, not a transform carousel ───────────────────────────────────────────────────
 * The track is an ordinary overflow-x container with scroll snapping. That single decision hands
 * over, for free, everything a hand-rolled carousel has to reimplement badly: touch dragging with
 * real momentum, trackpad swiping, keyboard scrolling, the scrollbar, and correct behaviour when
 * text is zoomed or the container is any width nobody anticipated.
 *
 * The buttons then only have to nudge `scrollLeft`. They are progressive enhancement: with no
 * JavaScript the strip still scrolls, and every card is still reachable.
 *
 * ── No layout shift ──────────────────────────────────────────────────────────────────────────────
 * Cards are a fixed flex-basis rather than a share of the container, so the strip occupies the same
 * height and the same rhythm before and after the facts land. The server renders the real cards
 * anyway — this is a client component only because the arrows need to know the scroll position.
 *
 * ── Five at a time ───────────────────────────────────────────────────────────────────────────────
 * On a desktop the basis is set so five cards fill the width. Below that they simply stop fitting
 * and the strip scrolls, which is the same interaction at every size rather than a separate mobile
 * mode with its own bugs.
 */
export function AchievementsCarousel({ achievements }: { achievements: Achievement[] }) {
  const trackRef = useRef<HTMLUListElement>(null)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(false)

  const sync = useCallback(() => {
    const el = trackRef.current
    if (!el) return
    setAtStart(el.scrollLeft <= 2)
    // A pixel of slack: sub-pixel layout means scrollLeft rarely reaches the exact maximum.
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 2)
  }, [])

  useEffect(() => {
    sync()
    const el = trackRef.current
    if (!el) return
    el.addEventListener('scroll', sync, { passive: true })
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', sync); ro.disconnect() }
  }, [sync])

  const page = (dir: -1 | 1) => {
    const el = trackRef.current
    if (!el) return
    /*
     * Scroll by a card, not by a viewport. Paging the full width skips past cards on a narrow
     * screen, where the arrows are most likely to be the only thing being used.
     */
    const card = el.querySelector('li')
    const step = card ? card.getBoundingClientRect().width + 12 : el.clientWidth * 0.8
    el.scrollBy({ left: dir * step, behavior: 'smooth' })
  }

  if (achievements.length === 0) return null

  return (
    <section
      aria-labelledby="achievements-heading"
      className="cyber-clip relative border border-[var(--acid-dim)] bg-[var(--acid)] p-4 text-[var(--acid-ink)]"
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
          <div className="flex items-center gap-1">
            <ArrowButton dir="left" onClick={() => page(-1)} disabled={atStart} />
            <ArrowButton dir="right" onClick={() => page(1)} disabled={atEnd} />
          </div>
        </div>
      </div>

      {/*
        `tabIndex` and a label on the track, because a scrollable region that cannot be focused
        cannot be scrolled by anybody without a pointer.
      */}
      <ul
        ref={trackRef}
        tabIndex={0}
        aria-label="Achievements, scrollable"
        className={cn(
          'flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1',
          'scrollbar-themed motion-safe:scroll-smooth',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--void)]',
        )}
      >
        {achievements.map((a) => (
          <li
            key={a.id}
            className="w-[15rem] shrink-0 snap-start sm:w-[16rem] xl:w-[calc((100%-3rem)/5)]"
          >
            <AchievementCard achievement={a} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function ArrowButton({ dir, onClick, disabled }: { dir: 'left' | 'right'; onClick: () => void; disabled: boolean }) {
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
 * The identity follows the site rule: the CueVerse ID is the line that leads, the Preferred Name
 * sits under it. A site-wide award has no player, so it renders the fact where the name would be
 * rather than leaving a gap the eye reads as a missing value.
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
          <p className="text-sm font-bold text-[var(--acid-ink)]">{a.stat}</p>
        )}
      </div>

      {a.winners.length > 0 && a.stat && (
        <p className="tabular mt-1 text-[0.72rem] font-bold uppercase tracking-wide text-[var(--acid-ink)]/80">
          {a.stat}
        </p>
      )}

      <p className="mt-2 text-[0.72rem] leading-snug text-[var(--acid-ink)]/75">{a.caption}</p>

      {/*
        The arithmetic, kept on the card rather than hidden behind a tooltip. The joke is only funny
        if the number behind it is checkable.
      */}
      <p className="mt-auto pt-2 text-[0.66rem] leading-snug text-[var(--acid-ink)]/60">{a.detail}</p>
    </article>
  )
}
