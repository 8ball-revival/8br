'use client'

import { useState, useTransition } from 'react'
import { Plus, Search } from 'lucide-react'

export interface QuickAddCandidate {
  playerId: string
  primaryName: string
  cueverseId: string | null
}

/**
 * Add an entrant without leaving the group screen.
 *
 * Registration and group building used to be strictly sequential, which is right for a season being
 * played but wrong for one being reconstructed from an archive — there the roster and the groups are
 * discovered together, and a missing player should be addable where you notice they are missing.
 *
 * Purely presentational: the caller supplies the search and add calls, so Seasons and Tournaments
 * share this control while keeping their own services.
 */
export function EntrantQuickAdd({
  search,
  add,
  disabled,
  placeholder = 'Add entrant by name or CueVerse ID…',
  emptyHint = 'No eligible players. Create the account first.',
}: {
  search: (q: string) => Promise<QuickAddCandidate[]>
  add: (playerId: string) => Promise<{ ok?: boolean; error?: string; message?: string }>
  disabled?: boolean
  placeholder?: string
  emptyHint?: string
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [candidates, setCandidates] = useState<QuickAddCandidate[]>([])
  const [searching, startSearch] = useTransition()
  const [adding, startAdd] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const load = (value: string) => {
    setQ(value)
    startSearch(async () => setCandidates(await search(value.trim())))
  }
  const openList = () => {
    if (disabled) return
    setOpen(true)
    if (candidates.length === 0) load('')
  }

  function choose(c: QuickAddCandidate) {
    setError(null)
    startAdd(async () => {
      const r = await add(c.playerId)
      if (r.error) {
        setError(r.error)
        return
      }
      // Clear and refill the list so the next player can be added straight away — a roster is
      // entered in a run, not one at a time.
      setQ('')
      setCandidates(await search(''))
    })
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden />
        <input
          value={q}
          onChange={(e) => load(e.target.value)}
          onFocus={openList}
          onClick={openList}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          disabled={disabled || adding}
          placeholder={placeholder}
          aria-label="Add entrant"
          autoComplete="off"
          className="w-72 rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm disabled:opacity-60"
        />
      </div>
      {open && (
        <ul className="absolute z-20 mt-1 max-h-64 w-72 space-y-1 overflow-y-auto rounded-md border border-border bg-background p-1 shadow-lg">
          {(searching || adding) && <li className="px-2 py-1.5 text-xs text-muted-foreground">{adding ? 'Adding…' : 'Searching…'}</li>}
          {!searching && !adding && candidates.length === 0 && (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">{emptyHint}</li>
          )}
          {!adding && candidates.map((c) => (
            <li key={c.playerId}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(c)}
                className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                <span>
                  {c.primaryName}
                  {c.cueverseId && c.cueverseId.toLowerCase() !== c.primaryName.toLowerCase() && (
                    <span className="ml-1 text-xs text-muted-foreground">({c.cueverseId})</span>
                  )}
                </span>
                <Plus className="size-3.5 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  )
}
