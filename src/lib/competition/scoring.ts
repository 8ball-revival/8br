/** Pure result validation. Race/game-count values are INFORMATIONAL match formats, not result-entry
 *  limits: any non-negative whole-number score is accepted, and the winner is derived from the scores. */

export interface ScoreValidationResult {
  ok: boolean
  error?: string
  /** True for an accepted equal score in a draw-permitting format (Group Stage / Swiss-with-draws). */
  isDraw?: boolean
  /** Winner/loser derived from the two scores. Both null on an accepted draw. */
  winnerRegistrationId?: number | null
  loserRegistrationId?: number | null
}

/**
 * Validate a submitted match result and derive the winner from the two scores.
 *
 * The configured race length / game count is only an informational format shown to players — it is
 * NOT enforced here: the winning score need not equal the race target, and the two scores need not
 * sum to the configured number of games. Scores are stored exactly as entered.
 *
 * Rules:
 *   - Both scores must be finite, non-negative WHOLE numbers within the safe integer range.
 *   - 0–0 is never a completed match (that is an administrative result type, handled elsewhere).
 *   - The higher score wins. Never trust a winner chosen by the client — always derive it here.
 *   - An equal score is a DRAW only when `allowDraw` is true (Group Stage / Swiss where the format
 *     permits it); otherwise (any elimination / playoff bracket) an equal score is rejected.
 */
export function validateResult(
  homeRegistrationId: number,
  awayRegistrationId: number,
  homeGames: number,
  awayGames: number,
  opts: { allowDraw: boolean },
): ScoreValidationResult {
  for (const v of [homeGames, awayGames]) {
    if (typeof v !== 'number' || Number.isNaN(v) || !Number.isFinite(v))
      return { ok: false, error: 'Enter a score for each side.' }
    if (!Number.isInteger(v)) return { ok: false, error: 'Scores must be whole numbers.' }
    if (v < 0) return { ok: false, error: 'Scores cannot be negative.' }
    if (v > Number.MAX_SAFE_INTEGER) return { ok: false, error: 'That score is too large.' }
  }
  if (homeGames === 0 && awayGames === 0) return { ok: false, error: 'Enter the score that was actually played.' }

  if (homeGames === awayGames) {
    if (!opts.allowDraw)
      return { ok: false, error: 'An elimination match must have a winner — enter the final score played.' }
    return { ok: true, isDraw: true, winnerRegistrationId: null, loserRegistrationId: null }
  }

  const homeWon = homeGames > awayGames
  return {
    ok: true,
    isDraw: false,
    winnerRegistrationId: homeWon ? homeRegistrationId : awayRegistrationId,
    loserRegistrationId: homeWon ? awayRegistrationId : homeRegistrationId,
  }
}

/**
 * Client-side pre-check mirroring {@link validateResult} for immediate feedback (the server remains
 * authoritative). Returns a winner side, a draw flag, or a reason the values can't yet be saved.
 */
export function previewResult(
  homeGames: number,
  awayGames: number,
  allowDraw: boolean,
): { status: 'home' | 'away' | 'draw' | 'invalid'; reason?: string } {
  for (const v of [homeGames, awayGames]) {
    if (!Number.isFinite(v) || !Number.isInteger(v) || v < 0) return { status: 'invalid' }
  }
  if (homeGames === 0 && awayGames === 0) return { status: 'invalid' }
  if (homeGames === awayGames) return allowDraw ? { status: 'draw' } : { status: 'invalid', reason: 'An elimination match must have a winner.' }
  return { status: homeGames > awayGames ? 'home' : 'away' }
}
