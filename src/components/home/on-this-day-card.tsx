'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { OnThisDayEvent } from '@/lib/stats/on-this-day'

const ROTATE_MS = 7000

/**
 * "On This Day" — rotates through results that happened on today's date in earlier years.
 *
 * Accessibility: previous/next buttons and indicator dots are real buttons with labels; the panel
 * is a labelled `region` and announces changes politely. Rotation pauses on hover AND on keyboard
 * focus anywhere inside, so a keyboard user is never chasing a moving target, and it does not run
 * at all under `prefers-reduced-motion`.
 */
export function OnThisDayCard({ events, emptyText }: { events: OnThisDayEvent[]; emptyText: string }) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const reduced = useRef(false)

  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }, [])

  const go = useCallback(
    (next: number) => setIndex(() => (events.length === 0 ? 0 : (next + events.length) % events.length)),
    [events.length],
  )

  useEffect(() => {
    if (paused || reduced.current || events.length < 2) return
    const t = setInterval(() => setIndex((n) => (n + 1) % events.length), ROTATE_MS)
    return () => clearInterval(t)
  }, [paused, events.length])

  const current = events[index]

  return (
    <section
      aria-label="On this day"
      className="flex h-full flex-col rounded-xl border border-border bg-card p-6"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <p className="eyebrow flex items-center gap-2 text-gold">
        <CalendarDays className="size-3.5" aria-hidden /> On This Day
      </p>

      {events.length === 0 ? (
        <p className="mt-6 flex-1 text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <>
          <div aria-live="polite" className="mt-5 flex-1">
            <p className="font-display text-3xl font-bold tabular-nums text-foreground">{current.year}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {new Date(current.date).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}
              {current.context ? ` · ${current.context}` : ''}
            </p>

            <div className="mt-4 flex items-center gap-3">
              <Initials value={current.homeInitials} />
              <span className="text-xs font-semibold text-muted-foreground">vs</span>
              <Initials value={current.awayInitials} />
            </div>

            <p className="mt-4 text-sm text-foreground">{current.description}</p>
          </div>

          {events.length > 1 && (
            <div className="mt-5 flex items-center justify-between">
              <div className="flex gap-1.5" role="tablist" aria-label="Select an event">
                {events.map((e, i) => (
                  <button
                    key={e.date + i}
                    type="button"
                    role="tab"
                    aria-selected={i === index}
                    aria-label={`Event ${i + 1} of ${events.length}: ${e.year}`}
                    onClick={() => go(i)}
                    className={cn(
                      'size-2 rounded-full transition-colors',
                      i === index ? 'bg-gold' : 'bg-border hover:bg-muted-foreground',
                    )}
                  />
                ))}
              </div>
              <div className="flex gap-1">
                <button type="button" onClick={() => go(index - 1)} aria-label="Previous event" className="rounded-md border border-border p-1.5 hover:bg-accent">
                  <ChevronLeft className="size-4" aria-hidden />
                </button>
                <button type="button" onClick={() => go(index + 1)} aria-label="Next event" className="rounded-md border border-border p-1.5 hover:bg-accent">
                  <ChevronRight className="size-4" aria-hidden />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function Initials({ value }: { value: string }) {
  return (
    <span className="inline-flex size-10 items-center justify-center rounded-full border border-gold/40 bg-gold/10 font-display text-sm font-bold text-gold">
      {value}
    </span>
  )
}
