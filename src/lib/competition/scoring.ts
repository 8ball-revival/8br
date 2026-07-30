/** Pure score validation for a race-to-N match. */

export interface ScoreValidationResult {
  ok: boolean
  error?: string
  winnerRegistrationId?: number
  loserRegistrationId?: number
}

/**
 * Validate a completed match score against the season race length.
 * Rules: the winner must reach exactly `raceLength`; the loser must be in
 * [0, raceLength); no ties; whole numbers only.
 */
export function validateScore(
  raceLength: number,
  homeRegistrationId: number,
  awayRegistrationId: number,
  homeGames: number,
  awayGames: number,
): ScoreValidationResult {
  if (!Number.isInteger(homeGames) || !Number.isInteger(awayGames))
    return { ok: false, error: 'Scores must be whole numbers.' }
  if (homeGames < 0 || awayGames < 0) return { ok: false, error: 'Scores cannot be negative.' }
  if (homeGames === awayGames) return { ok: false, error: 'A match cannot end in a tie.' }

  const winnerGames = Math.max(homeGames, awayGames)
  const loserGames = Math.min(homeGames, awayGames)

  if (winnerGames !== raceLength)
    return { ok: false, error: `The winner must reach ${raceLength} games (race to ${raceLength}).` }
  if (loserGames >= raceLength)
    return { ok: false, error: `The loser must have fewer than ${raceLength} games.` }

  const homeWon = homeGames > awayGames
  return {
    ok: true,
    winnerRegistrationId: homeWon ? homeRegistrationId : awayRegistrationId,
    loserRegistrationId: homeWon ? awayRegistrationId : homeRegistrationId,
  }
}
