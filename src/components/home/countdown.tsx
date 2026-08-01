'use client'

import { useEffect, useState } from 'react'

function diff(targetMs: number) {
  const total = Math.max(0, targetMs - Date.now())
  const days = Math.floor(total / 86_400_000)
  const hrs = Math.floor((total % 86_400_000) / 3_600_000)
  const min = Math.floor((total % 3_600_000) / 60_000)
  const sec = Math.floor((total % 60_000) / 1000)
  return { total, days, hrs, min, sec }
}

/**
 * Live registration countdown. Renders zeros on the server / first paint (so SSR
 * and client markup match), then ticks every second once mounted.
 */
export function Countdown({ target }: { target: string }) {
  const targetMs = new Date(target).getTime()
  const [t, setT] = useState({ total: 1, days: 0, hrs: 0, min: 0, sec: 0 })

  useEffect(() => {
    const update = () => setT(diff(targetMs))
    // First tick on the next frame (keeps SSR markup = zeros, avoids a sync
    // setState in the effect body), then once per second.
    const raf = requestAnimationFrame(update)
    const id = setInterval(update, 1000)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(id)
    }
  }, [targetMs])

  if (t.total <= 0) {
    return (
      <p className="eyebrow text-muted-foreground" role="timer">
        Registration closed
      </p>
    )
  }

  const boxes: Array<[number, string]> = [
    [t.days, 'Days'],
    [t.hrs, 'Hrs'],
    [t.min, 'Min'],
    [t.sec, 'Sec'],
  ]

  return (
    <div className="flex gap-2 sm:gap-3" role="timer" aria-label="Time until registration closes">
      {boxes.map(([value, label]) => (
        <div
          key={label}
          className="flex min-w-[3.75rem] flex-col items-center rounded-lg border border-gold/20 bg-background/50 px-2 py-2 backdrop-blur sm:min-w-[4.25rem]"
        >
          <span className="tabular text-2xl font-bold leading-none text-foreground sm:text-3xl">
            {String(value).padStart(2, '0')}
          </span>
          <span className="eyebrow mt-1.5 text-[0.6rem] text-muted-foreground">{label}</span>
        </div>
      ))}
    </div>
  )
}
