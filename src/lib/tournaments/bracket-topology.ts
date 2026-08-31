/**
 * Which positions in a Tournament bracket a person may arrange by hand.
 *
 * ── Entry positions, and everything else ────────────────────────────────────────────────────────
 * A draw has two kinds of seat. An ENTRY seat is filled by the draw — the first round — and can be
 * rearranged before anybody plays. Every other seat is filled by a result, and moving somebody into
 * one would be inventing an outcome. The board only ever offers the first kind, and the server
 * refuses the second independently.
 *
 * ── Double elimination has one entrance ─────────────────────────────────────────────────────────
 * Everybody enters through the Winners Bracket. The Losers Bracket is entirely fed — its occupants
 * arrive by losing — so its first round is not an entry round even though it is numbered like one.
 * Offering those seats would let somebody be placed into a defeat they had not suffered.
 *
 * Pure: the same shape the Season's `bracketTopology` produces, from rows the workspace already has.
 */

import type { EntrySlot } from '@/lib/seasons/playoff-topology'
import type { PlayoffRow } from './live'

export interface TournamentTopology {
  entrySlots: EntrySlot[]
  /** Fast membership test over `${matchId}:${side}`. */
  entryKeys: Set<string>
  /** Total matches, so a caller can tell "no bracket" from "no entry positions". */
  matches: number
}

/** The Winners Bracket, or the only bracket there is. */
const isEntrySection = (section: string | null | undefined) => section == null || section === 'WB'

export function tournamentTopology(rows: readonly PlayoffRow[]): TournamentTopology {
  if (rows.length === 0) return { entrySlots: [], entryKeys: new Set(), matches: 0 }

  const entryRounds = rows.filter((r) => isEntrySection(r.section))
  if (entryRounds.length === 0) return { entrySlots: [], entryKeys: new Set(), matches: rows.length }

  /*
    The FIRST round, found rather than assumed to be 1.

    A double-elimination bracket numbers its Losers rounds from 100, and a reconstructed record can
    begin at any number at all. Taking the minimum of what is actually there means the entry round
    is the earliest one that exists, which is what "first" means.
  */
  const first = Math.min(...entryRounds.map((r) => r.round))
  const firstRound = entryRounds
    .filter((r) => r.round === first)
    .slice()
    .sort((a, b) => a.slot - b.slot)

  const entrySlots: EntrySlot[] = []
  for (const m of firstRound) {
    /*
      A match with a result is out of bounds, even in the first round.

      Regenerating a bracket clears results, but a correction can leave one played tie in an
      otherwise untouched draw. Moving a player out of a match somebody has already won would leave
      a winner who was never in it.
    */
    if (m.winnerRegistrationId != null) continue
    entrySlots.push({
      matchId: m.id, side: 'home', section: m.section ?? null, round: m.round, slot: m.slot,
      label: m.label, entrantId: m.homeRegistrationId, entrantName: m.homeUsername, seed: m.homeSeed,
    })
    entrySlots.push({
      matchId: m.id, side: 'away', section: m.section ?? null, round: m.round, slot: m.slot,
      label: m.label, entrantId: m.awayRegistrationId, entrantName: m.awayUsername, seed: m.awaySeed,
    })
  }

  return {
    entrySlots,
    entryKeys: new Set(entrySlots.map((s) => `${s.matchId}:${s.side}`)),
    matches: rows.length,
  }
}

/** Who is already on the board, so the entrant list can say who is not. */
export function placedEntrantIds(topology: TournamentTopology): Set<number> {
  return new Set(topology.entrySlots.map((s) => s.entrantId).filter((id): id is number => id != null))
}
