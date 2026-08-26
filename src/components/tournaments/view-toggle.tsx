'use client'

import { useRouter } from 'next/navigation'
import { useRef } from 'react'

import { cn } from '@/lib/utils'

type View = 'groups' | 'playoffs'

/**
 * Groups | Playoffs tab toggle for a published Group Stage + Playoffs tournament. The selected view is
 * carried in the URL (?view=) so back/forward and refresh behave predictably; the ordinary URL (no
 * query) defaults to Playoffs (resolved server-side). Switching is a soft navigation — it never leaves
 * the tournament page. Accessible tablist: arrow-key navigation, roving tabindex, aria-selected.
 */
export function ViewToggle({ number, active }: { number: number; active: View }) {
  const router = useRouter()
  const tabs: View[] = ['groups', 'playoffs']
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const go = (v: View) => router.push(`/tournaments/${number}?view=${v}`, { scroll: false })

  const onKey = (e: React.KeyboardEvent, i: number) => {
    let next = i
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % tabs.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    else return
    e.preventDefault()
    refs.current[next]?.focus()
    go(tabs[next])
  }

  return (
    <div role="tablist" aria-label="Tournament view" className="inline-flex rounded-none border border-border bg-card/40 p-1">
      {tabs.map((v, i) => {
        const selected = active === v
        return (
          <button
            key={v}
            ref={(el) => { refs.current[i] = el }}
            role="tab"
            id={`tab-${v}`}
            aria-selected={selected}
            aria-controls={`panel-${v}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => go(v)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              'rounded-md px-4 py-1.5 text-sm font-semibold capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected ? 'bg-brand text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {v}
          </button>
        )
      })}
    </div>
  )
}
