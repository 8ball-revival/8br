'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { searchPlayersAction } from '@/lib/players/profile-actions'
import type { PlayerOption } from '@/lib/players/picker-search'
import { cn } from '@/lib/utils'

/**
 * Find a player from anywhere on the site.
 *
 * ── It searches what people actually remember ───────────────────────────────────────────────────
 * A CueVerse ID, a name, or a handle somebody used years ago. All three, case-insensitively, on
 * partial text — the server side is `searchPlayers`, the same function the Creator's player picker
 * uses, which also resolves a merged-away identity to the account that absorbed it. So typing an
 * old handle lands on the person who has it now rather than on nothing.
 *
 * ── What it never shows ─────────────────────────────────────────────────────────────────────────
 * Database ids. A result is a handle, a name and the alias that matched — the three things that let
 * somebody recognise who they found. `cmsys8lj000016rig…` identifies a row, not a person.
 *
 * ── Keyboard and screen readers ─────────────────────────────────────────────────────────────────
 * A combobox, wired the way the pattern says: the input owns the listbox, arrow keys move
 * `aria-activedescendant` rather than focus, Enter opens the active option, Escape closes. The live
 * region announces the number of results, because a list appearing silently below a text field is
 * invisible to a screen reader.
 */

const MIN_QUERY = 2
const DEBOUNCE_MS = 180

export function NavPlayerSearch({ className }: { className?: string }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PlayerOption[]>([])
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  /** Mobile: the field is a single icon until asked for, so the bar stays a bar. */
  const [expanded, setExpanded] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  /*
    Which query the newest reply belongs to.

    Two keystrokes are two requests and they can answer out of order, which shows the results for
    "st" under the word "starkiller". The sequence number means only the newest answer is kept.
  */
  const seq = useRef(0)

  /*
    Nothing is set from the effect body itself.

    A term below the minimum simply schedules no work and the render below shows no results for it —
    deriving that is both correct and one render rather than two. Everything else happens inside the
    debounce callback, after the keystroke has settled.
  */
  useEffect(() => {
    const term = query.trim()
    if (term.length < MIN_QUERY) return
    const mine = ++seq.current
    const timer = setTimeout(async () => {
      setBusy(true)
      try {
        const found = await searchPlayersAction(term)
        if (mine !== seq.current) return
        setResults(found)
        setActive(0)
        setOpen(true)
      } catch {
        if (mine === seq.current) setResults([])
      } finally {
        if (mine === seq.current) setBusy(false)
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  /** Clicking away closes the list without clearing what was typed. */
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const go = useCallback((option: PlayerOption) => {
    setOpen(false)
    setQuery('')
    setResults([])
    setExpanded(false)
    // The profile route is keyed by the CueVerse ID; an archive player without one falls back to
    // the id, which is the only key their profile has.
    const key = option.cueverseId || option.id
    router.push(`/players/${encodeURIComponent(key)}`)
  }, [router])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (open) { setOpen(false); return }
      setQuery(''); setExpanded(false); inputRef.current?.blur(); return
    }
    const list = query.trim().length >= MIN_QUERY ? results : []
    if (!open || list.length === 0) {
      if (e.key === 'ArrowDown' && list.length > 0) { setOpen(true); e.preventDefault() }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % list.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + list.length) % list.length) }
    else if (e.key === 'Enter') {
      const option = list[active]
      if (option) { e.preventDefault(); go(option) }
    }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0) }
    else if (e.key === 'End') { e.preventDefault(); setActive(list.length - 1) }
  }

  const term = query.trim()
  // Below the minimum there is no search, so there are no results to show for what is typed now.
  const shown = term.length >= MIN_QUERY ? results : []
  const showEmpty = open && term.length >= MIN_QUERY && !busy && shown.length === 0

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      {/* Compact control for narrow screens: an icon that becomes the field. */}
      <button
        type="button"
        onClick={() => { setExpanded(true); requestAnimationFrame(() => inputRef.current?.focus()) }}
        aria-label="Search players"
        className={cn(
          'inline-flex size-9 items-center justify-center text-[var(--nav-foreground)] transition-colors hover:bg-[var(--acid-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
          expanded ? 'hidden' : 'md:hidden',
        )}
      >
        <Search className="size-4" aria-hidden />
      </button>

      <div className={cn('items-center', expanded ? 'flex' : 'hidden md:flex')}>
        <label htmlFor={`${listId}-input`} className="sr-only">Search players by CueVerse ID, name or alias</label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--nav-inactive)]"
            aria-hidden
          />
          <input
            id={`${listId}-input`}
            ref={inputRef}
            type="text"
            role="combobox"
            autoComplete="off"
            aria-expanded={open && shown.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && shown[active] ? `${listId}-opt-${active}` : undefined}
            aria-describedby={`${listId}-hint`}
            placeholder="Search players"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => { if (shown.length > 0) setOpen(true) }}
            onKeyDown={onKeyDown}
            className="w-40 border border-[var(--line-strong)] bg-[var(--surface-plaque,transparent)] py-1.5 pl-7 pr-7 text-sm text-[var(--nav-foreground)] placeholder:text-[var(--nav-inactive)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] lg:w-56"
          />
          {(query || expanded) && (
            <button
              type="button"
              onClick={() => { setQuery(''); setResults([]); setOpen(false); setExpanded(false) }}
              aria-label="Clear player search"
              className="absolute right-1 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center text-[var(--nav-inactive)] transition-colors hover:text-[var(--nav-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
      </div>

      <p id={`${listId}-hint`} className="sr-only">
        Search by CueVerse ID, player name or a known alias. Use the arrow keys to review results and Enter to open a profile.
      </p>
      {/* Announced, so the list is not something only sighted users know appeared. */}
      <span aria-live="polite" className="sr-only">
        {busy ? 'Searching' : open && shown.length > 0 ? `${shown.length} player${shown.length === 1 ? '' : 's'} found` : showEmpty ? 'No players found' : ''}
      </span>

      {open && (shown.length > 0 || showEmpty) && (
        <div className="absolute right-0 z-50 mt-1 w-[19rem] border border-[var(--line-strong)] bg-popover text-foreground shadow-lg">
          {showEmpty ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              No player matches “{term}”.
            </p>
          ) : (
            <ul id={listId} role="listbox" aria-label="Player results" className="max-h-80 overflow-auto py-1">
              {shown.map((option, i) => (
                <li
                  key={option.id}
                  id={`${listId}-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  // Chosen on mousedown so the click is not lost to the blur that closes the list.
                  onMouseDown={(e) => { e.preventDefault(); go(option) }}
                  className={cn(
                    'cursor-pointer px-3 py-2 text-sm',
                    i === active ? 'bg-accent text-accent-foreground' : 'text-foreground',
                  )}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-semibold">{option.cueverseId || option.name}</span>
                    {!option.active && (
                      <span className="shrink-0 text-[0.65rem] uppercase tracking-wide text-muted-foreground">Archived</span>
                    )}
                  </span>
                  {/* The name behind the handle, when it says something different. */}
                  {option.name && option.name.toLowerCase() !== (option.cueverseId || '').toLowerCase() && (
                    <span className="block truncate text-xs text-muted-foreground">{option.name}</span>
                  )}
                  {/*
                    Why this result is here, when the reason is not visible above: somebody who
                    searched an old handle needs to see the old handle to trust the match.
                  */}
                  {option.matchedOn === 'alias' && option.matchedValue && (
                    <span className="block truncate text-xs text-muted-foreground">
                      also known as {option.matchedValue}
                    </span>
                  )}
                  {option.matchedOn === 'merged' && option.matchedValue && (
                    <span className="block truncate text-xs text-muted-foreground">
                      formerly {option.matchedValue}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
