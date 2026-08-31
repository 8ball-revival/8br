'use client'

/**
 * The Tournament's Entrants stage: the shared board, wired to Tournament actions.
 *
 * The counterpart of `SeasonEntrantsBoard`, and deliberately as thin. What differs between the two
 * records is which action fills the list and what closing it leads to; everything a person sees is
 * the same screen, from the same file.
 */

import { useCallback } from 'react'

import {
  searchTournamentPlayersAction, addTournamentEntrantsAction, removeTournamentEntrantAction,
} from '@/lib/competition/tournament-actions'
import {
  tournamentClosePreflightAction, closeTournamentRegistrationAction,
} from '@/lib/creator/tournament-entrants-actions'
import { EntrantsBoard, type CreatorEntrant, type EntrantsBoardApi } from './entrants-board'
import type { PlayerSearchResult } from '@/components/players/player-search'

/** What closing leads to, said in the reader's terms rather than in lifecycle states. */
const NEXT: Record<string, { explanation: string; confirm: string }> = {
  GROUPS_PLAYOFFS: {
    explanation: 'The entrant list locks and the Tournament moves to Group Setup, where you draw the groups before anything is shown.',
    confirm: 'Close and Set Up Groups',
  },
  SWISS: {
    explanation: 'The entrant list locks and the Tournament moves to the Swiss rounds, where the first round is paired.',
    confirm: 'Close and Start Swiss',
  },
  DEFAULT: {
    explanation: 'The entrant list locks and the Tournament moves to bracket setup. The draw stays private until you start it, so you can arrange the first round before anybody sees it.',
    confirm: 'Close and Set Up the Bracket',
  },
}

export function TournamentEntrantsBoard({
  tournamentId, format, entrants, isOpen,
}: {
  tournamentId: number
  format: string
  entrants: CreatorEntrant[]
  isOpen: boolean
}) {
  const api = useCallback((): EntrantsBoardApi => ({
    search: async (term): Promise<PlayerSearchResult[]> => {
      const rows = await searchTournamentPlayersAction(tournamentId, term)
      return rows.map((c) => ({ id: c.playerId, name: c.primaryName, cueverseId: c.cueverseId ?? '' }))
    },
    add: (playerId) => addTournamentEntrantsAction(tournamentId, [playerId]),
    remove: (entrantId) => removeTournamentEntrantAction(tournamentId, entrantId),
    /*
      No create-and-add here, unlike a Season.

      A Season is often reconstructed from an archive whose players never had accounts. A Tournament
      is played by people who are already on the site, and `searchTournamentPlayersAction` already
      refuses anyone banned, deleted or management-only — making an account from this screen would
      be a way around a check rather than a convenience.
    */
    closePreflight: async () => {
      const p = await tournamentClosePreflightAction(tournamentId)
      return { entrants: p.entrants, noEntrants: p.noEntrants || p.tooFew }
    },
    close: () => closeTournamentRegistrationAction(tournamentId),
  }), [tournamentId])()

  const copy = NEXT[format] ?? NEXT.DEFAULT

  return (
    <EntrantsBoard
      entrants={entrants}
      isOpen={isOpen}
      api={api}
      addHint="Only registered accounts can be added. No account? Create it first, then it appears here."
      copy={{
        closeExplanation: copy.explanation,
        closeConfirmLabel: copy.confirm,
        emptyWarning: 'A bracket needs at least two entrants. Closing now leaves nothing to draw.',
      }}
    />
  )
}
