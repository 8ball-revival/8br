'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
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
 *
 * ── The moving underline ────────────────────────────────────────────────────────────────────────
 * One element that slides between tabs, rather than a border on each. A border cannot animate from
 * one element to another, and eight tabs each fading their own line reads as a flicker instead of a
 * movement. Its position is measured from the active tab and written as a transform, so the travel
 * is compositor-only and costs no layout.
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
  const listRef = useRef<HTMLDivElement>(null)
  const inkRef = useRef<HTMLSpanElement>(null)

  /*
    Move the underline to the active tab.

    Written straight to the element's style rather than held in state: this runs after every layout
    that could have moved a tab, and putting the measurement into state would render again purely to
    describe what had already been measured. `useLayoutEffect` so the line is in place before the
    browser paints, rather than jumping a frame later.
  */
  useLayoutEffect(() => {
    const ink = inkRef.current
    const list = listRef.current
    const tab = tabRefs.current.get(activeKey)
    if (!ink || !list || !tab) return
    const a = tab.getBoundingClientRect()
    const b = list.getBoundingClientRect()
    ink.style.width = `${a.width}px`
    ink.style.transform = `translateX(${a.left - b.left}px)`
  }, [activeKey, tabs])

  /* A resize moves the tabs, so the line has to follow. One observer, disconnected on cleanup. */
  useEffect(() => {
    const list = listRef.current
    if (!list || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const ink = inkRef.current
      const tab = tabRefs.current.get(activeKey)
      if (!ink || !tab) return
      const a = tab.getBoundingClientRect()
      const b = list.getBoundingClientRect()
      ink.style.width = `${a.width}px`
      ink.style.transform = `translateX(${a.left - b.left}px)`
    })
    ro.observe(list)
    return () => ro.disconnect()
  }, [activeKey])

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
        ref={listRef}
        role="tablist"
        aria-label="Profile sections"
        className="pf-tablist relative flex flex-wrap gap-1 border-b"
        style={{ borderColor: 'var(--pf-border)' }}
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
              /*
                `pf-tab` rather than the site's own tokens: the active tab is one of the places the
                brief requires a player's accent to reach, and a hard-coded gold underline ignored
                whatever they had chosen.
              */
              className={cn('pf-tab -mb-px px-3 py-2 sm:px-4')}
            >
              {tab.label}
            </button>
          )
        })}
        {/* The travelling underline. Decorative: the selected state is on the tabs themselves. */}
        <span aria-hidden ref={inkRef} className="pf-tab-ink" />
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
            /*
              `pf-tabpanel` fades and lifts the panel in on selection. The animation is keyed to the
              panel becoming visible rather than to a state change, so returning to a tab replays it
              without anything being re-created — the panels stay mounted.
            */
            className={cn('pf-tabpanel pt-4 focus-visible:outline-none', selected && 'pf-tabpanel-active')}
          >
            {tab.panel}
          </div>
        )
      })}
    </div>
  )
}
