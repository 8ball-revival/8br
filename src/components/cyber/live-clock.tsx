'use client'

import { useEffect, useState } from 'react'

/**
 * The "LIVE · 03:53 PM PT" readout in the top right of the navigation.
 *
 * ── Why it renders empty on the server ───────────────────────────────────────────────────────────
 * The server's clock and the reader's clock are different, and the reader's time zone is unknown
 * until the browser says so. Rendering a time on the server therefore guarantees a hydration
 * mismatch on the first paint and a visible flicker as the value is corrected.
 *
 * So the time is filled in after mount, and the element that will hold it is reserved at its final
 * width beforehand. Nothing moves when the value arrives — the alternative, letting the bar grow by
 * eight characters a moment after load, shifts the whole right-hand side of the navigation.
 *
 * ── What "LIVE" claims ───────────────────────────────────────────────────────────────────────────
 * Only that the page is being served now. It is chrome, not a data-freshness indicator, so it is
 * marked decorative and carries no assertion about competitions being in progress.
 */
export function LiveClock({ className }: { className?: string }) {
  const [time, setTime] = useState<string | null>(null)

  useEffect(() => {
    const tick = () => {
      const now = new Date()
      // The reader's own zone, short-form, so it reads as their clock rather than the server's.
      const parts = new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short',
      }).format(now)
      setTime(parts.toUpperCase())
    }
    tick()
    /*
     * Aligned to the top of the minute rather than polled every second.
     *
     * The display has minute resolution, so a per-second interval would re-render sixty times for
     * every visible change. The first timeout lands on the next minute boundary and the interval
     * takes over from there.
     */
    const msToNextMinute = 60_000 - (Date.now() % 60_000)
    let interval: ReturnType<typeof setInterval> | undefined
    const timeout = setTimeout(() => {
      tick()
      interval = setInterval(tick, 60_000)
    }, msToNextMinute)
    return () => {
      clearTimeout(timeout)
      if (interval) clearInterval(interval)
    }
  }, [])

  return (
    <div className={className}>
      <span className="cyber-clip-sm inline-flex items-center gap-1.5 border border-[var(--hot-red)] bg-[var(--void)] px-2 py-1 text-[0.62rem] font-bold uppercase tracking-[0.14em] text-[var(--hot-red)]">
        <span className="size-1.5 shrink-0 rounded-full bg-[var(--hot-red)] motion-safe:animate-pulse" aria-hidden />
        Live
      </span>
      {/*
        The reserved slot. `min-w` holds the space a formatted time will need, and `tabular` stops
        the digits changing width as they change value.
      */}
      <span
        className="tabular ml-2 inline-block min-w-[6.5rem] text-right text-[0.7rem] font-semibold text-[var(--acid-ink)]/70"
        aria-hidden
      >
        {time ?? ''}
      </span>
    </div>
  )
}
