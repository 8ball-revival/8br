'use client'

/**
 * The Tournament's playoff actions, shaped as the scoring screen's api.
 *
 * ── Two differences from a Season's, both deliberate ────────────────────────────────────────────
 * The Tournament actions take a plain `reason` rather than an options object, and they carry no
 * downstream-rebuild warning: a changed result re-advances the winner directly. So the note is
 * passed through as the reason, `expectedUpdatedAt` has nothing to compare against and is dropped,
 * and no `warning` is ever returned — which means the rebuild dialog never opens, because there is
 * nothing for it to confirm.
 *
 * Dropping the stale-edit check is a real difference, not an oversight: the Tournament action has
 * no parameter for it. Worth closing later by giving that action the same guard the Season has.
 */

import {
  recordTournamentScoreAction, recordTournamentForfeitAction,
} from '@/lib/competition/tournament-actions'
import type { ScoringApi } from './playoff-scoring'

export function tournamentScoringApi(): ScoringApi {
  return {
    record: (matchId, home, away, opts) =>
      recordTournamentScoreAction(matchId, home, away, opts.note ?? undefined),
    forfeit: (matchId, forfeiter, opts) =>
      recordTournamentForfeitAction(matchId, forfeiter, opts.note ?? undefined),
  }
}
