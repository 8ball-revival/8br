'use client'

import { useRef } from 'react'

import { RANKING_SCOPES, SCOPE_DEFINITIONS, type RankingScope } from '@/lib/stats/rankings-scope'
import { cn } from '@/lib/utils'

/**
 * The four scopes of the current rankings.
 *
 * ── Why these are tabs and not another filter ────────────────────────────────────────────────────
 * They change WHICH LADDER you are reading, not which rows of one ladder you can see. That is the
 * same distinction the Yahoo split makes, one level down: an 8BRCAM standing and a tournament
 * standing are separate answers to separate questions, and burying the choice in a filter drawer
 * would make the most important decision on the page the hardest one to find.
 *
 * ── Keyboard ─────────────────────────────────────────────────────────────────────────────────────
 * Real ARIA tabs, so a screen reader announces "tab 2 of 4" and arrow keys move between them with
 * one tab stop for the strip. Roving `tabIndex` is what makes that work: without it, Tab walks
 * through all four before reaching the table.
 */
export function ScopeTabs({
  scope, onSelect, pending,
}: {
  scope: RankingScope
  onSelect: (s: RankingScope) => void
  pending?: boolean
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  const move = (delta: number) => {
    const i = RANKING_SCOPES.indexOf(scope)
    const next = RANKING_SCOPES[(i + delta + RANKING_SCOPES.length) % RANKING_SCOPES.length]
    onSelect(next)
    // Follow the selection, so the arrow keys move the focus ring as well as the tab.
    requestAnimationFrame(() => refs.current[next]?.focus())
  }

  return (
    <div className="mb-3">
      <div role="tablist" aria-label="Ranking scope" className="flex flex-wrap gap-px bg-[var(--line-strong)]">
        {RANKING_SCOPES.map((key) => {
          const def = SCOPE_DEFINITIONS[key]
          const on = key === scope
          return (
            <button
              key={key}
              ref={(el) => { refs.current[key] = el }}
              role="tab"
              id={`rk-scope-${key}`}
              aria-selected={on}
              aria-controls="rk-scope-panel"
              tabIndex={on ? 0 : -1}
              onClick={() => onSelect(key)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(1) }
                else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
                else if (e.key === 'Home') { e.preventDefault(); onSelect(RANKING_SCOPES[0]) }
                else if (e.key === 'End') { e.preventDefault(); onSelect(RANKING_SCOPES[RANKING_SCOPES.length - 1]) }
              }}
              className={cn(
                'min-w-[6.5rem] flex-1 px-3 py-2 text-[0.72rem] font-bold uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--cyan)]',
                on
                  ? 'bg-brand text-primary-foreground'
                  : 'bg-[var(--void)] text-muted-foreground hover:bg-[var(--graphite-raised)] hover:text-foreground',
              )}
            >
              {def.label}
            </button>
          )
        })}
      </div>
      <p className={cn('mt-2 text-xs text-muted-foreground transition-opacity', pending && 'opacity-50')}>
        {SCOPE_DEFINITIONS[scope].blurb}
      </p>
    </div>
  )
}

/**
 * What a scope shows when it has no rated results yet.
 *
 * Rendered instead of the table rather than above an empty one. A heading, a filter bar and a table
 * with no rows reads as a failure; a sentence saying what has to happen first reads as the truth,
 * which is that the competition has not finished yet.
 */
export function ScopeEmpty({ scope }: { scope: RankingScope }) {
  const def = SCOPE_DEFINITIONS[scope]
  return (
    <div className="border border-dashed border-[var(--line-strong)] bg-card px-6 py-14 text-center">
      <p className="font-display text-lg font-black text-foreground">{def.emptyTitle}</p>
      <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">{def.emptyBody}</p>
    </div>
  )
}
