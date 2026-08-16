/**
 * Standard Elo — the 8BR Rating system. Pure, deterministic, isomorphic (no DB).
 *
 * Every player starts at 1500. K = 32. Rating is applied PER completed matchup (group, playoff, or
 * Swiss — all weighted equally); tournament placement, format, phase, score margin, and race length
 * never affect it. Winning a tournament is tracked separately (Tournament Wins / trophies), not here.
 *
 *   expected(p, o) = 1 / (1 + 10 ^ ((o - p) / 400))
 *   change         = round( K * (actual - expected) )    // actual: 1 win / 0 loss / 0.5 draw
 *
 * A head-to-head match is zero-sum: the loser's change is exactly the negation of the winner's, so
 * ratings never drift. Forfeits are Elo-neutral (change 0) even though they count as a win/loss in the
 * record. Rating never decays from inactivity.
 */
export const ELO_START = 1500
export const ELO_K = 32

/** Expected score of `playerRating` against `opponentRating` (0..1). */
export function expectedScore(playerRating: number, opponentRating: number): number {
  return 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400))
}

/** Rounded rating change for `playerRating` given the `actual` result (1/0/0.5) vs `opponentRating`. */
export function ratingDelta(playerRating: number, opponentRating: number, actual: number, k: number = ELO_K): number {
  return Math.round(k * (actual - expectedScore(playerRating, opponentRating)))
}

/**
 * Resolve one head-to-head matchup into balanced (zero-sum) integer changes for both sides. The home
 * side's change is rounded once and the away side mirrors it, so winner gain == -loser loss exactly
 * (avoids the rare ±0.5 rounding asymmetry). A forfeit yields no change on either side.
 */
export function matchDeltas(
  homeRating: number,
  awayRating: number,
  homeActual: number, // 1 home win, 0 home loss, 0.5 draw
  opts: { forfeit?: boolean } = {},
): { home: { expected: number; delta: number }; away: { expected: number; delta: number } } {
  const eHome = expectedScore(homeRating, awayRating)
  const eAway = expectedScore(awayRating, homeRating)
  if (opts.forfeit) return { home: { expected: eHome, delta: 0 }, away: { expected: eAway, delta: 0 } }
  const homeDelta = Math.round(ELO_K * (homeActual - eHome))
  return { home: { expected: eHome, delta: homeDelta }, away: { expected: eAway, delta: -homeDelta } }
}
