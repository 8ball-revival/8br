'use server'

import { computePlayerDetail, computeHeadToHead } from '@/lib/stats/rankings-detail'
import type { PlayerDetail, HeadToHeadPair } from '@/lib/stats/rankings-detail'
import type { LadderScope } from '@/lib/stats/ladder-explorer'

// NOTE: no `export type` re-export here. Next compiles a 'use server' module by re-exporting every
// export as a VALUE for the client to reference; a type re-export becomes a reference to a binding
// that does not exist at runtime, and the whole actions module fails to evaluate with
// "ReferenceError: PlayerDetail is not defined". The symptom is remote from the cause: every
// expanded row sits on "Loading this player's history..." for ever, because the action it calls
// could never load. Import the types from ./rankings-detail directly instead.

/**
 * Detail for one expanded Rankings row.
 *
 * Read-only and public, exactly like the rankings themselves, so there is nothing to authorise
 * beyond the arguments being well formed.
 */
export async function loadPlayerDetail(playerId: string, scope: LadderScope): Promise<PlayerDetail | null> {
  if (!playerId || typeof playerId !== 'string') return null
  return computePlayerDetail(playerId, scope === 'current' ? 'current' : 'all-time')
}

/**
 * Direct meetings between the players selected for comparison.
 *
 * Capped at three because the panel compares at most three; a longer list would be a different
 * feature reached through the same door.
 */
export async function loadHeadToHead(playerIds: string[]): Promise<HeadToHeadPair[]> {
  if (!Array.isArray(playerIds)) return []
  const ids = playerIds.filter((v): v is string => typeof v === 'string' && v.length > 0).slice(0, 3)
  if (ids.length < 2) return []
  return computeHeadToHead(ids)
}
