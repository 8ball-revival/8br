'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'

import { searchSeasonPlayersAction } from '@/lib/seasons/actions'

export interface EntrantCandidate {
  playerId: string
  primaryName: string
  cueverseId: string | null
}

/**
 * The list of Players who may still be added to a Season, kept honest.
 *
 * ── What went wrong ─────────────────────────────────────────────────────────────────────────────
 * The server has always excluded existing entrants. The CLIENT was the problem: it fetched the list
 * once, then never again. It did not refetch when the dropdown was reopened — the guard was
 * `if (candidates.length === 0)`, so a populated list stayed populated — and adding somebody did not
 * take them out of it. So the Player you had just entered was still sitting there to be clicked, and
 * clicking them produced "already entered", which reads as a bug in the save rather than a stale
 * menu. The error was correct; the list it came from was not.
 *
 * ── How this fixes it ───────────────────────────────────────────────────────────────────────────
 * Three things, and all three are needed:
 *
 *   · `exclude(playerId)` drops the Player the moment the add succeeds, so an OPEN dropdown is
 *     correct immediately, with no refresh and no round trip.
 *   · `reload()` refetches whenever the dropdown opens and whenever the roster version changes, so
 *     closing and reopening, searching, and a page refresh all agree with the database — and a
 *     REMOVED entrant reappears as available, which the optimistic path alone could never do.
 *   · everything is keyed on the canonical Player id. Never the preferred name, never the displayed
 *     handle: both are editable, both can collide, and either would exclude the wrong person.
 *
 * The server-side duplicate check stays exactly where it is. This makes the list right; that keeps
 * it right when two administrators are working at once, which no client-side list can.
 */
export function useEntrantCandidates(seasonId: number, rosterVersion = 0) {
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<EntrantCandidate[]>([])
  const [searching, startSearch] = useTransition()

  const fetchFor = useCallback((value: string) => {
    startSearch(async () => setCandidates(await searchSeasonPlayersAction(seasonId, value.trim())))
  }, [seasonId])

  /** Refetch for whatever is currently typed — the dropdown opening, or the roster having changed. */
  const reload = useCallback(() => fetchFor(query), [fetchFor, query])

  /** Type-ahead: the query changes, so the list must come from the server rather than be filtered. */
  const search = useCallback((value: string) => {
    setQuery(value)
    fetchFor(value)
  }, [fetchFor])

  /**
   * Drop one Player immediately, by canonical id.
   *
   * Optimistic on purpose: the point is that an open dropdown is correct before the server answers.
   * `reload` reconciles afterwards, so an add that actually failed does not leave a Player hidden.
   */
  const exclude = useCallback((playerId: string) => {
    setCandidates((current) => current.filter((c) => c.playerId !== playerId))
  }, [])

  /*
   * Whenever the roster changes — an add, a removal, a reopen — the list is refetched. This is what
   * makes a removed entrant available again, and it is why `exclude` can afford to be optimistic.
   */
  useEffect(() => {
    if (rosterVersion > 0) reload()
    // Deliberately keyed on the version alone: including `reload` would refetch on every keystroke,
    // because it closes over the query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterVersion])

  return { query, setQuery, candidates, searching, search, reload, exclude }
}
