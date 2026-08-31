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

/**
 * A result that is recorded but does not move a rating.
 *
 * ── Why a Yahoo Tournament does not count ────────────────────────────────────────────────────────
 * The Yahoo ladder is a Season ladder. Its Tournaments were one-off side events run under their own
 * conditions, and letting a handful of them move a rating built from ninety-odd Seasons lets a single
 * afternoon outweigh a career. The result is still written — the row, the win, the loss and the
 * trophy all survive, and the Tournament columns keep reading them — but the rating change is zero,
 * exactly as it is for a forfeit. Scoped to Yahoo on purpose: CueVerse Tournaments are part of that
 * ladder and keep counting.
 *
 * ── Why it lives here rather than in the ledger writer ───────────────────────────────────────────
 * It was a private rule in the writer, which meant the REPLAY did not know about it: replaying a
 * Yahoo tournament match invented an Elo movement for a result the ledger had deliberately scored
 * as zero. Any view that replays — Current, a bounded All-Time, every filtered scope — therefore
 * disagreed with the stored ladder about players who had ever entered one.
 *
 * One definition, imported by both, is the only arrangement where they cannot drift apart.
 */
export function isRatingNeutral(platform: string, tournamentId?: number | null): boolean {
  return platform === 'YAHOO' && tournamentId != null
}

/**
 * The championship step: a title lifts a rating by a fixed amount, once.
 *
 * ── Why a step and not a per-title bonus ─────────────────────────────────────────────────────────
 * A per-title bonus multiplies, so six titles became +600 and opened a 584-point chasm between first
 * and tenth while tenth to fiftieth was only 274 — the ladder stretched hardest exactly where it
 * should be tightest. A single step shifts all champions together, so the shape of the field below
 * them is untouched: first to tenth is 116 points, and the spread widens down the table the way a
 * rating curve should.
 *
 * It also fixes what a per-title bonus could not. The requirement is that no champion sits below
 * anyone who never won: a multiplier has to clear that gap for the WEAKEST champion, which means
 * over-rewarding the strongest. One step clears it for everybody at once.
 *
 * ── Why it is applied after the replay, not during it ────────────────────────────────────────────
 * An in-timeline bonus made the winner a stronger favourite immediately, so they earned less for
 * every win that followed and the bonus partly ate itself — unevenly, by player. At 100 it demoted
 * the archive's only four-time champion BELOW where he sat with no bonus at all. Applied after the
 * ratings are settled it is arithmetic, and it cannot punish anyone for winning too often.
 *
 * ── Why 200 ──────────────────────────────────────────────────────────────────────────────────────
 * 157 is the smallest step that clears today's gap between the lowest-rated champion and the highest
 * non-champion. 200 costs nothing extra — every champion moves together, so the spread is identical
 * at any size — and leaves 44 points of headroom, so one ordinary Season cannot silently break the
 * rule. `verify-championship-step` asserts it still holds.
 *
 * The Elo itself is untouched and stays zero-sum: the step lives here, on top of the rating the
 * ledger computed, and never enters the replay.
 */
export const CHAMPION_STEP = 200

/**
 * The same idea, worth less: a Tournament win.
 *
 * ── Why a step, and not a fraction of Elo ───────────────────────────────────────────────────────
 * It works exactly as the Season step does, for the reasons above — applied after the ratings are
 * settled so it cannot punish a winner for winning again, and once rather than per title so five
 * Tournament wins do not stretch the top of the ladder away from the field.
 *
 * ── Why 25 ──────────────────────────────────────────────────────────────────────────────────────
 * A Tournament is one afternoon; a Season is months of it. The number says so: it is enough that
 * winning one is visible on the ladder, and small enough that no amount of them approaches a single
 * Season title. It is deliberately well inside the Season step's headroom — 157 is the smallest
 * step that keeps every Season champion above every non-champion, and 200 was chosen to leave room
 * — so lifting a Tournament winner by 25 cannot lift them past a Season champion who has not won
 * one. `verify-championship-step` is what proves that still holds.
 *
 * ── It obeys `isRatingNeutral`, like every other rating movement ────────────────────────────────
 * A Yahoo Tournament is recorded but moves nobody's rating: its matches are scored at zero because
 * letting a handful of one-off side events move a rating built from ninety-odd Seasons lets a single
 * afternoon outweigh a career. Awarding a step for WINNING one would say the opposite through the
 * back door — the matches worth nothing, the trophy worth 25 — so a neutral Tournament earns no
 * step either. Measured: it is also what keeps the Yahoo ladder's headroom at 44 rather than 38.
 */
export const TOURNAMENT_STEP = 25

/**
 * A rating with the honours a player holds added on top.
 *
 * Both steps apply where both are held: a Season champion who has also won a Tournament stands 225
 * above their Elo, which is the ordering the two numbers were chosen to produce — a Tournament win
 * counts, and it never counts like a Season.
 *
 * `tournamentWins` defaults to none so an existing caller that only knows about Season titles keeps
 * behaving exactly as it did.
 */
export function withChampionStep(rating: number, titles: number, tournamentWins = 0): number {
  return rating
    + (titles > 0 ? CHAMPION_STEP : 0)
    + (tournamentWins > 0 ? TOURNAMENT_STEP : 0)
}
