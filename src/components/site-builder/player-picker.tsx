'use client'

/**
 * Choosing a player without ever seeing an id.
 *
 * ── The problem it replaces ─────────────────────────────────────────────────────────────────────
 * This field used to be a plain text box holding a 25-character cuid. That id appears nowhere on
 * the site — not in a profile URL, not in a staff page, not in the admin area — so "put Derrick in
 * this record" was a database query. Worse, the box accepted anything: a typo, a season id, a
 * sentence. The failure was silent, because a wrong id renders as no player at all.
 *
 * ── What it stores ──────────────────────────────────────────────────────────────────────────────
 * The same canonical player id as before, unchanged. Existing configs keep working untouched, and
 * nothing downstream has to learn a new shape. Only the way it is CHOSEN is different: the search
 * writes the id, and the editor is shown the player.
 *
 * ── Why the search box is not also the value ────────────────────────────────────────────────────
 * A combo box that writes whatever was typed would put the free-text field back. Typing searches;
 * only choosing a result sets the value. There is no keystroke that produces an arbitrary id.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Loader2, Search, UserRound, X } from 'lucide-react'

import { searchPlayersAction, resolvePlayersAction } from '@/lib/site-builder/player-actions'
import type { PlayerOption } from '@/lib/players/picker-search'
import { cn } from '@/lib/utils'

/** Long enough that a slow typist is not firing a query per letter, short enough to feel live. */
const DEBOUNCE_MS = 250

const MATCH_NOTE: Record<NonNullable<PlayerOption['matchedOn']>, string> = {
  name: '',
  cueverseId: '',
  alias: 'known as',
  merged: 'merged from',
}

export function PlayerPicker({ value, onChange }: {
  value: string
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [showDebug, setShowDebug] = useState(false)
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  /*
    ── Both lookups remember WHICH input they answered ───────────────────────────────────────────
    Storing `{ id, player }` rather than a bare player, and `{ term, list }` rather than a bare
    list, is what lets what is rendered be DERIVED from the current input instead of assigned when
    a response happens to arrive. Two things fall out of that.

    A stale answer can no longer be shown: typing "der" then "derrick" starts two searches and the
    shorter one can land second, but a result whose term is not the term in the box is simply not
    rendered. The same holds for a player resolved for an id that has since been replaced.

    And neither effect sets state on its synchronous path, which is what the compiler asks for — a
    cascading render on every keystroke is a real cost in a panel this size.
  */
  const [lookup, setLookup] = useState<{ id: string; player: PlayerOption | null } | null>(null)
  const [hits, setHits] = useState<{ term: string; list: PlayerOption[] } | null>(null)

  const term = query.trim()

  // ── Resolve whatever is stored ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!value) return
    let cancelled = false
    void (async () => {
      const res = await resolvePlayersAction([value])
      if (cancelled) return
      setLookup({ id: value, player: res.ok ? (res.data[value] ?? null) : null })
    })()
    return () => { cancelled = true }
  }, [value])

  // ── Debounced search ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const wanted = query.trim()
    if (wanted.length < 2) return

    let cancelled = false
    const timer = setTimeout(() => {
      void (async () => {
        const res = await searchPlayersAction(wanted)
        if (cancelled) return
        setHits({ term: wanted, list: res.ok ? res.data : [] })
      })()
    }, DEBOUNCE_MS)

    return () => { cancelled = true; clearTimeout(timer) }
  }, [query, open])

  /*
    `undefined` is "still looking"; `null` is "looked, and nobody has that id".

    The difference matters: the second is a broken reference the editor has to be told about, and
    reporting it while the request is still in flight would flag every selection for a moment.
  */
  const selected: PlayerOption | null | undefined = !value
    ? null
    : lookup?.id === value ? lookup.player : undefined

  const results = term.length >= 2 && hits?.term === term ? hits.list : null
  const loading = open && term.length >= 2 && results === null
  // Clamped rather than reset, so a shrinking list cannot leave the highlight past its end.
  const activeIndex = Math.min(active, Math.max(0, (results?.length ?? 1) - 1))

  const choose = useCallback((p: PlayerOption) => {
    onChange(p.id)
    setOpen(false)
    setQuery('')
  }, [onChange])

  const startSearching = () => {
    setOpen(true)
    setQuery('')
    setActive(0)
    // Focus after paint, or the field does not exist yet to receive it.
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = results ?? []
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(Math.min(activeIndex + 1, Math.max(0, list.length - 1)))
      return
    }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(activeIndex - 1, 0)); return }
    if (e.key === 'Home') { e.preventDefault(); setActive(0); return }
    if (e.key === 'End') { e.preventDefault(); setActive(Math.max(0, list.length - 1)); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      const pick = list[activeIndex]
      if (pick) choose(pick)
    }
  }

  // Keep the highlighted row in view when it is moved by the keyboard rather than the mouse.
  useEffect(() => {
    if (!open) return
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  const listId = 'player-picker-results'

  return (
    <div className="flex flex-col gap-1.5">
      {/* ── What is chosen ─────────────────────────────────────────────────────────────────── */}
      {!open && (
        <div className="flex items-stretch gap-1.5">
          <button
            type="button"
            onClick={startSearching}
            /*
              It opens a list of options, so it says so. Assistive technology announces it as a
              control that expands rather than as a button whose label happens to be a person's
              name — and it gives the control a stable handle that does not change with the
              selection, which is what its label does.
            */
            aria-haspopup="listbox"
            aria-expanded={false}
            aria-label={selected ? `Change the linked player, currently ${selected.name}` : 'Choose a player'}
            className="flex min-w-0 flex-1 items-center gap-2 border border-border px-2 py-1.5 text-left text-xs text-foreground hover:border-[var(--hot-red)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <UserRound className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1">
              {!value && <span className="text-muted-foreground">Search for a player…</span>}
              {value && selected === undefined && (
                <span className="text-muted-foreground">Looking this player up…</span>
              )}
              {value && selected === null && (
                <span className="flex items-center gap-1.5 text-[var(--hot-red)]">
                  <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                  This player no longer exists
                </span>
              )}
              {selected && (
                <>
                  <span className="block truncate font-semibold">{selected.name}</span>
                  {selected.cueverseId && (
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {selected.cueverseId}
                      {!selected.active && ' · archived'}
                    </span>
                  )}
                </>
              )}
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </button>
          {value && (
            <button
              type="button"
              onClick={() => onChange('')}
              aria-label="Clear the selected player"
              title="Clear the selected player"
              className="shrink-0 border border-border px-2 text-muted-foreground hover:border-[var(--hot-red)] hover:text-[var(--hot-red)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
      )}

      {value && !open && selected === null && (
        <p className="border border-[var(--hot-red)] p-1.5 text-[11px] leading-relaxed text-foreground">
          The stored reference does not match any player. Until it is changed, the fallback name and
          CueVerse ID below are what visitors see.
        </p>
      )}

      {/* ── Searching ──────────────────────────────────────────────────────────────────────── */}
      {open && (
        <div className="border border-[var(--line-strong)]">
          <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
            <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0) }}
              onKeyDown={onKeyDown}
              placeholder="Name, CueVerse ID or an old handle…"
              aria-label="Search for a player"
              aria-autocomplete="list"
              aria-controls={listId}
              aria-expanded
              role="combobox"
              className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
            />
            {loading && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Stop searching"
              className="shrink-0 text-muted-foreground hover:text-[var(--hot-red)]"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>

          <ul
            id={listId}
            ref={listRef}
            role="listbox"
            aria-label="Matching players"
            className="max-h-56 overflow-y-auto"
          >
            {term.length < 2 && (
              <li className="p-2 text-[11px] text-muted-foreground">
                Type at least two characters. Old handles are searched too.
              </li>
            )}
            {term.length >= 2 && loading && (
              <li className="flex items-center gap-1.5 p-2 text-[11px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" aria-hidden />
                Searching…
              </li>
            )}
            {results?.length === 0 && (
              <li className="p-2 text-[11px] text-muted-foreground">
                No player matches “{term}”. Names, CueVerse IDs and old handles were all
                searched.
              </li>
            )}
            {results?.map((p, i) => (
              <li key={p.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === activeIndex}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(p)}
                  className={cn(
                    'flex w-full items-center gap-2 px-2 py-1.5 text-left',
                    i === activeIndex ? 'bg-[var(--hover)]' : 'bg-transparent',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-foreground">
                      {p.name}
                      {!p.active && (
                        <span className="ml-1.5 font-normal text-[10px] uppercase tracking-wider text-muted-foreground">
                          archived
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {p.cueverseId || 'no CueVerse ID'}
                      {p.matchedOn && MATCH_NOTE[p.matchedOn] && p.matchedValue
                        && ` · ${MATCH_NOTE[p.matchedOn]} ${p.matchedValue}`}
                    </span>
                    {p.aliases.length > 0 && (
                      <span className="block truncate text-[10px] text-muted-foreground">
                        also {p.aliases.join(', ')}
                      </span>
                    )}
                  </span>
                  {p.id === value && <Check className="size-3.5 shrink-0 text-[var(--acid)]" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── The id, for when it is genuinely needed ────────────────────────────────────────── */}
      {value && (
        <div>
          <button
            type="button"
            onClick={() => setShowDebug((v) => !v)}
            className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            aria-expanded={showDebug}
          >
            {showDebug ? 'Hide' : 'Show'} stored id
          </button>
          {showDebug && (
            <div className="mt-1 flex items-center gap-1.5">
              <code className="min-w-0 flex-1 truncate border border-border bg-[var(--inset)] px-1.5 py-1 text-[10px] text-muted-foreground">
                {value}
              </code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(value).then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  })
                }}
                className="shrink-0 border border-border px-1.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
