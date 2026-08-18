'use server'

import { computePlayerDetail, type LadderScope, type PlayerDetail } from '@/lib/stats/ladder-explorer'

/**
 * Detail for one expanded Ladder row.
 *
 * A Server Action rather than part of the page payload: the breakdown is only wanted for the rows a
 * reader actually opens, and shipping it for every player would multiply the page size to serve a
 * handful of clicks.
 *
 * Read-only and public, exactly like the Ladder itself, so there is nothing to authorise beyond
 * validating the shape of what comes in.
 */
export async function loadPlayerDetail(
  playerId: string,
  scope: LadderScope,
): Promise<PlayerDetail | null> {
  const id = typeof playerId === 'string' ? playerId.trim() : ''
  if (!id || id.length > 64) return null
  return computePlayerDetail(id, scope === 'current' ? 'current' : 'all-time')
}
