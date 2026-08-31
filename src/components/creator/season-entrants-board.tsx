'use client'

/**
 * The Season's Entrants stage: the shared board, wired to Season actions.
 *
 * ── Why this file is now four callbacks ─────────────────────────────────────────────────────────
 * The table, the in-place identity edit, the count and the close confirmation moved to
 * `EntrantsBoard`, because a Tournament needs exactly the same screen. What is left here is the
 * part that was ever Season-specific: which action fills the list, and what closing it means.
 *
 * The Season's behaviour is unchanged — the same actions, in the same order, with the same wording
 * on the confirmation. `verify-season-*` is the guard on that.
 */

import { useCallback } from 'react'

import { AutoAssignPanel } from '@/components/archive/auto-assign-panel'
import { createMemberAction } from '@/lib/staff/create-member'
import {
  searchSeasonPlayersAction, addSeasonEntrantAction, removeSeasonEntrantAction,
} from '@/lib/seasons/actions'
import {
  closeRegistrationPreflightAction, closeRegistrationToGroupsAction,
} from '@/lib/creator/season-entrants-actions'
import { EntrantsBoard, type CreatorEntrant, type EntrantsBoardApi } from './entrants-board'
import type { PlayerSearchResult } from '@/components/players/player-search'

export type { CreatorEntrant }

export function SeasonEntrantsBoard({
  seasonId,
  entrants,
  isOpen,
  showAutoAdd,
  autoAddDisabledReason,
}: {
  seasonId: number
  entrants: CreatorEntrant[]
  /** Registration is still open: entrants can be added and removed. */
  isOpen: boolean
  showAutoAdd: boolean
  autoAddDisabledReason: string | null
}) {
  const api = useCallback((): EntrantsBoardApi => ({
    search: async (term): Promise<PlayerSearchResult[]> => {
      const rows = await searchSeasonPlayersAction(seasonId, term)
      return rows.map((c) => ({ id: c.playerId, name: c.primaryName, cueverseId: c.cueverseId ?? '' }))
    },
    add: (playerId) => addSeasonEntrantAction(seasonId, playerId),
    remove: (entrantId) => removeSeasonEntrantAction(seasonId, entrantId),
    /*
      Creating an account from here is a Season affordance that predates the shared board: an
      archived player being reconstructed often has no account yet, and stopping to make one in
      another screen loses your place in the list.
    */
    createAndAdd: async (handle) => {
      const made = await createMemberAction({ cueverseId: handle, preferredName: handle })
      if (made.error || !made.playerId) return { error: made.error ?? 'Could not create that account.' }
      const added = await addSeasonEntrantAction(seasonId, made.playerId)
      if (added.error) return { error: added.error }
      return { ok: true, message: `Created ${handle} and added them as an entrant.` }
    },
    closePreflight: async () => {
      const p = await closeRegistrationPreflightAction(seasonId)
      return { entrants: p.entrants, noEntrants: p.noEntrants, unresolvedArchive: p.unresolvedArchive }
    },
    close: () => closeRegistrationToGroupsAction(seasonId),
  }), [seasonId])()

  return (
    <EntrantsBoard
      entrants={entrants}
      isOpen={isOpen}
      api={api}
      copy={{
        closeExplanation:
          'The entrant list locks, every entrant’s current Rankings rating is captured as the seeding snapshot, and the Season moves to Group Setup.',
        closeConfirmLabel: 'Close and Set Up Groups',
        emptyWarning: 'This Season has no entrants. Closing now leaves nothing to draw groups from.',
      }}
      extras={showAutoAdd ? (
        <div className="flex flex-col items-start gap-1">
          <AutoAssignPanel seasonId={seasonId} mode="entrants" disabledReason={autoAddDisabledReason} />
          {!autoAddDisabledReason && (
            <span className="text-xs text-muted-foreground">
              Searches every existing account for this Season&rsquo;s archived players. Creates nobody &mdash;
              anyone without an account is listed for you to add by hand.
            </span>
          )}
        </div>
      ) : undefined}
    />
  )
}
