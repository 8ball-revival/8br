'use client'

import { useId, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Overview, Match History and Head to Head — real tabs, not three pages.
 *
 * ── Why they are not links ──────────────────────────────────────────────────────────────────────
 * The brief is explicit: switching tabs must not navigate, reload the route or lose the sidebar. So
 * all three panels are built once by the server and the tab list only chooses which is shown. There
 * is no router involved, nothing is refetched, and the sidebar never re-renders.
 *
 * Hidden panels stay mounted rather than being unmounted and rebuilt. That is what makes returning
 * to a tab instant, and it keeps whatever a reader had scrolled or opened inside one exactly where
 * they left it.
 *
 * ── Keyboard ────────────────────────────────────────────────────────────────────────────────────
 * The WAI-ARIA tabs pattern: one stop in the tab order for the whole list, arrow keys move between
 * tabs, Home and End jump to the ends. Arrowing selects, because these panels are already loaded
 * and there is nothing to defer.
 */

export interface ProfileTab {
  key: string
  label: string
  panel: React.ReactNode
}

export function ProfileTabs({ tabs, className }: { tabs: ProfileTab[]; className?: string }) {
  const [activeKey, setActiveKey] = useState(tabs[0]?.key ?? '')
  const baseId = useId()
  const tabRefs = useRef(new Map<string, HTMLButtonElement | null>())

  const index = Math.max(0, tabs.findIndex((t) => t.key === activeKey))

  const focusTab = (i: number) => {
    const next = tabs[(i + tabs.length) % tabs.length]
    if (!next) return
    setActiveKey(next.key)
    tabRefs.current.get(next.key)?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); focusTab(index + 1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); focusTab(index - 1) }
    else if (e.key === 'Home') { e.preventDefault(); focusTab(0) }
    else if (e.key === 'End') { e.preventDefault(); focusTab(tabs.length - 1) }
  }

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label="Profile sections"
        className="flex flex-wrap gap-1 border-b border-border"
      >
        {tabs.map((tab) => {
          const selected = tab.key === activeKey
          return (
            <button
              key={tab.key}
              ref={(el) => { tabRefs.current.set(tab.key, el) }}
              role="tab"
              id={`${baseId}-tab-${tab.key}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.key}`}
              // Only the selected tab is in the tab order — the arrow keys are the way between them.
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveKey(tab.key)}
              onKeyDown={onKeyDown}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] sm:px-4',
                selected
                  ? 'border-[var(--gold)] text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {tabs.map((tab) => {
        const selected = tab.key === activeKey
        return (
          <div
            key={tab.key}
            role="tabpanel"
            id={`${baseId}-panel-${tab.key}`}
            aria-labelledby={`${baseId}-tab-${tab.key}`}
            // `hidden` rather than unmounted: the panel keeps its state and returns instantly.
            hidden={!selected}
            tabIndex={0}
            className="pt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            {tab.panel}
          </div>
        )
      })}
    </div>
  )
}
