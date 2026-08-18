'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CalendarClock, ChevronLeft, ChevronRight, Crown } from 'lucide-react'

import { formatDate } from '@/lib/format'
import type { OnThisDayEvent } from '@/lib/stats/on-this-day'

/**
 * "On This Day" — what happened on today's date in earlier years.
 *
 * Sits in the statistics row and must match the statistic cards' height exactly, so the card is a
 * fixed-height frame with the event absolutely positioned inside it. Changing event therefore never
 * changes the card's height, whatever the length of the description — the row cannot jump while
 * somebody is reading it.
 *
 * When there is more than one event the card rotates, with real controls: buttons that are reachable
 * and labelled, dots that say which event is showing, rotation that pauses on hover and on focus,
 * and no rotation at all for a visitor who has asked for reduced motion.
 */

const ROTATE_MS = 7000

export function OnThisDayCard({ events }: { events: OnThisDayEvent[] }) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(true)
  const liveRef = useRef<HTMLDivElement>(null)

  // Read the motion preference after mount rather than during render: it is a browser fact, and the
  // server has no view on it. Starting "reduced" means the card never auto-rotates before we know.
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReducedMotion(query.matches)
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    if (events.length < 2 || paused || reducedMotion) return
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % events.length), ROTATE_MS)
    return () => window.clearInterval(timer)
  }, [events.length, paused, reducedMotion])

  const event = events[Math.min(index, Math.max(0, events.length - 1))]
  const go = (next: number) => setIndex(((next % events.length) + events.length) % events.length)

  return (
    <section
      aria-labelledby="on-this-day-heading"
      // Pausing on focus matters as much as on hover: a keyboard reader is reading too.
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      className="relative flex h-full min-h-[9.5rem] min-w-[17rem] flex-col rounded-lg border border-border bg-card/40 p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h3
          id="on-this-day-heading"
          className="inline-flex items-center gap-1.5 text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-brand"
        >
          <CalendarClock className="size-3.5" aria-hidden />
          On This Day
        </h3>

        {events.length > 1 && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => go(index - 1)}
              aria-label="Previous event"
              className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => go(index + 1)}
              aria-label="Next event"
              className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>
        )}
      </div>

      {/*
        The event area is a fixed-size frame. Its content is absolutely positioned, so a long
        description cannot make this card taller than the statistic tiles beside it.
      */}
      <div className="relative mt-2 flex-1">
        {!event ? (
          <p className="absolute inset-0 flex items-center text-xs leading-relaxed text-muted-foreground">
            Nothing has happened on this date yet. Results appear here as competitions are played.
          </p>
        ) : (
          <div ref={liveRef} aria-live="polite" aria-atomic className="absolute inset-0 flex gap-2.5 overflow-hidden">
            <span
              aria-hidden
              className={`inline-flex size-8 shrink-0 items-center justify-center rounded-full text-[0.6rem] font-semibold ${
                event.kind === 'championship' ? 'bg-brand/15 text-brand' : 'bg-muted text-muted-foreground'
              }`}
            >
              {event.kind === 'championship' ? <Crown className="size-3.5" /> : event.homeInitials}
            </span>

            <span className="min-w-0 flex-1">
              <span className="block text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
                {formatDate(event.date)}
              </span>
              <span className="mt-0.5 block line-clamp-3 text-xs leading-relaxed text-foreground/90">
                {event.href ? (
                  <Link
                    href={event.href}
                    className="hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
                  >
                    {event.description}
                  </Link>
                ) : event.description}
              </span>
            </span>
          </div>
        )}
      </div>

      {events.length > 1 && (
        <div className="mt-2 flex items-center gap-1.5">
          {events.slice(0, 8).map((e, i) => (
            <button
              key={e.id}
              type="button"
              onClick={() => go(i)}
              aria-label={`Show event ${i + 1} of ${Math.min(events.length, 8)}`}
              aria-current={i === index ? 'true' : undefined}
              className={`h-1 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${
                i === index ? 'w-4 bg-brand' : 'w-1.5 bg-muted-foreground/40 hover:bg-muted-foreground/70'
              }`}
            />
          ))}
        </div>
      )}
    </section>
  )
}
