'use client'

/**
 * The Season's playoff actions, shaped as the scoring screen's api.
 *
 * Kept out of the page because the page is a server component and these are client-callable server
 * actions the scoring screen invokes from the browser. Behaviour is unchanged: the same two
 * actions, the same options, the same downstream-rebuild warning.
 */

import {
  recordSeasonPlayoffResultAction, recordSeasonPlayoffForfeitAction,
} from '@/lib/seasons/actions'
import type { ScoringApi } from './playoff-scoring'

export function seasonScoringApi(): ScoringApi {
  return {
    record: (matchId, home, away, opts) => recordSeasonPlayoffResultAction(matchId, home, away, opts),
    forfeit: (matchId, forfeiter, opts) => recordSeasonPlayoffForfeitAction(matchId, forfeiter, opts),
  }
}
