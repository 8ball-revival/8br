'use client'

/**
 * One control for "find a player", wherever that is asked.
 *
 * ── Why the search function is a prop ───────────────────────────────────────────────────────────
 * The Site Builder asks this question as the Owner, editing a page. The Creator asks it as a
 * competition manager, filling an entrant list. Those are different capabilities, and the gate
 * belongs to the caller — a control that carried its own would either lock out the manager or hand
 * the Owner's reach to everybody who can add an entrant.
 *
 * So this owns the interaction and nothing else: debouncing, the keyboard, the loading and empty
 * states, and what a result looks like. Who may search, and what they may search, stays with the
 * action each caller passes in.
 *
 * ── Typing searches; only choosing picks ────────────────────────────────────────────────────────
 * There is no keystroke that produces a value. That is what separates this from the text box it
 * replaces in both places, where a typo silently became the stored answer.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Search, X } from 'lucide-react'

import { cn } from '@/lib/utils'

/** Everything the control needs to draw a result. Callers map their own rows onto this. */
export interface PlayerSearchResult {
  id: string
  name: string
  cueverseId: string
  /** Past handles, shown only when they help tell two people apart. */
  aliases?: string[]
  /** Why this row matched, when it was not the name — e.g. `known as po0lin`. */
  note?: string
  /** Archived players are still selectable, but say so. */
  archived?: boolean
}

/** Long enough that a slow typist is not firing a query per letter, short enough to feel live. */
const DEBOUNCE_MS = 250
const MIN_CHARS = 2

export function PlayerSearch({
  search, onPick, placeholder = 'Search by name, CueVerse ID or an old handle…',
  label = 'Search for a player', autoFocus = false, onCancel, footer, className,
}: {
  search: (term: string) => Promise<PlayerSearchResult[]>
  onPick: (result: PlayerSearchResult) => void
  placeholder?: string
  label?: string
  autoFocus?: boolean
  /** Shown as a dismiss control when the caller can close the search. */
  onCancel?: () => void
  /** Rendered under the results — used for "create this account and add them". */
  footer?: (term: string) => React.ReactNode
  className?: string
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [hits, setHits] = useState<{ term: string; list: PlayerSearchResult[] } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const term = query.trim()

  useEffect(() => {
    const wanted = query.trim()
    if (wanted.length < MIN_CHARS) return
    let cancelled = false
    const timer = setTimeout(() => {
      void (async () => {
        const list = await search(wanted)
        // A late answer for an earlier term is not rendered: it is remembered WITH its term, and
        // only shown while that term is still the one in the box.
        if (!cancelled) setHits({ term: wanted, list })
      })()
    }, DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query, search])

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  const results = term.length >= MIN_CHARS && hits?.term === term ? hits.list : null
  const loading = term.length >= MIN_CHARS && results === null
  // Clamped rather than reset, so a shrinking list cannot leave the highlight past its end.
  const activeIndex = Math.min(active, Math.max(0, (results?.length ?? 1) - 1))

  const pick = useCallback((r: PlayerSearchResult) => {
    onPick(r)
    setQuery('')
    setHits(null)
    setActive(0)
  }, [onPick])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = results ?? []
    if (e.key === 'Escape') { e.preventDefault(); onCancel?.(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(activeIndex + 1, Math.max(0, list.length - 1))); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(activeIndex - 1, 0)); return }
    if (e.key === 'Home') { e.preventDefault(); setActive(0); return }
    if (e.key === 'End') { e.preventDefault(); setActive(Math.max(0, list.length - 1)); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      const chosen = list[activeIndex]
      if (chosen) pick(chosen)
    }
  }

  // Keep the highlighted row in view when the keyboard moves it rather than the mouse.
  useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const listId = 'player-search-results'

  return (
    <div className={cn('border border-border bg-background', className)}>
      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={label}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0) }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        {loading && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Stop searching"
            className="shrink-0 text-muted-foreground hover:text-[var(--hot-red)]"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>

      <ul id={listId} ref={listRef} role="listbox" aria-label="Matching players" className="max-h-64 overflow-y-auto">
        {term.length < MIN_CHARS && (
          <li className="px-3 py-2 text-xs text-muted-foreground">
            Type at least {MIN_CHARS} characters. Old handles are searched too.
          </li>
        )}
        {loading && (
          <li className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" aria-hidden /> Searching…
          </li>
        )}
        {results?.length === 0 && (
          <li className="px-3 py-2 text-xs text-muted-foreground">
            No player matches “{term}”. Names, CueVerse IDs and old handles were all searched.
          </li>
        )}
        {results?.map((r, i) => (
          <li key={r.id}>
            <button
              type="button"
              role="option"
              aria-selected={i === activeIndex}
              onMouseEnter={() => setActive(i)}
              // The list is often inside something that closes on blur; picking must beat that.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(r)}
              className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left',
                i === activeIndex ? 'bg-muted' : 'bg-transparent')}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  {r.cueverseId && <span className="font-semibold text-[var(--gold)]">{r.cueverseId}</span>}
                  {r.cueverseId && <span className="text-muted-foreground"> · </span>}
                  <span className="text-foreground">{r.name}</span>
                  {r.archived && (
                    <span className="ml-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">archived</span>
                  )}
                </span>
                {(r.note || (r.aliases && r.aliases.length > 0)) && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {r.note}
                    {r.note && r.aliases && r.aliases.length > 0 && ' · '}
                    {r.aliases && r.aliases.length > 0 && `also ${r.aliases.join(', ')}`}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
        {footer && term.length >= MIN_CHARS && results?.length === 0 && (
          <li className="border-t border-border px-3 py-2">{footer(term)}</li>
        )}
      </ul>
    </div>
  )
}
