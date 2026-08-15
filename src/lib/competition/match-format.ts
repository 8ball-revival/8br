/**
 * MATCH FORMAT — the single source of truth for how long a match is, per tournament format.
 *
 * These rules are HARD-CODED for the `GROUPS_PLAYOFFS` (Group Stage + Playoffs) format ONLY:
 *   - Group Stage: every matchup is exactly 10 games (not a race). 10–0 … 6–4 are decisive; 5–5 is a DRAW.
 *   - Playoffs:    every match before the Semifinals is Race to 7; Semifinals + Final are Race to 9.
 *                  A bracket that begins at the Semifinals (≤4 slots) is entirely Race to 9, and a lone
 *                  two-entrant Final is Race to 9. For double elimination the length comes from the
 *                  match's LOGICAL stage: early winners/losers matches are Race to 7; the winners-bracket
 *                  final, losers-bracket final, grand final, and grand-final reset are Race to 9.
 *
 * Every OTHER format (Single Elim, Double Elim, Swiss, …) keeps its configurable `tournament.raceLength`
 * — none of the helpers here should be applied to them. This module is pure/isomorphic (no DB, no
 * `server-only`) so both server validation and client display import the same rules.
 */

/** Games in every Group Stage matchup (fixed — not a race). */
export const GROUP_STAGE_GAMES = 10
/** Race length for playoff matches before the Semifinals. */
export const PLAYOFF_EARLY_RACE = 7
/** Race length for the Semifinals, Final, grand final, and grand-final reset. */
export const PLAYOFF_LATE_RACE = 9

/** True for the format whose match lengths are hard-coded here. */
export function isGroupsPlayoffs(tournamentFormat: string | null | undefined): boolean {
  return tournamentFormat === 'GROUPS_PLAYOFFS'
}

// NOTE: match SCORES are validated in `./scoring` (`validateResult`) — the race length / game count
// below are INFORMATIONAL formats for display only, never enforced against entered scores.

// ---------------------------------------------------------------------------- Playoff race length

/** Coarse description of a playoff bracket's shape, derived from its matches' rounds + sections. */
export interface PlayoffBracketShape {
  isDoubleElim: boolean
  /** Single-elim: the highest round number (the Final). */
  totalRounds: number
  /** Double-elim: highest Winners-bracket round (the WB final). */
  maxWbRound: number
  /** Double-elim: highest Losers-bracket round (the LB final). */
  maxLbRound: number
}

interface RoundedMatch {
  round: number
  section?: string | null // "WB" | "LB" | "GF" for double-elim; null/undefined for single-elim
}

/** Derive the bracket shape from the full set of playoff matches (round + section only). */
export function computeBracketShape(matches: readonly RoundedMatch[]): PlayoffBracketShape {
  const isDoubleElim = matches.some((m) => m.section != null)
  const roundsIn = (pred: (m: RoundedMatch) => boolean) => {
    const rs = matches.filter(pred).map((m) => m.round)
    return rs.length ? Math.max(...rs) : 0
  }
  return {
    isDoubleElim,
    totalRounds: roundsIn(() => true),
    maxWbRound: roundsIn((m) => m.section === 'WB'),
    maxLbRound: roundsIn((m) => m.section === 'LB'),
  }
}

/**
 * Race length for one GROUPS_PLAYOFFS playoff match, from its logical stage (never its label alone).
 *
 * Single elim: the Final and the Semifinals (the last two rounds) are Race to 9; everything earlier is
 * Race to 7. Because the window is "the last two rounds", a bracket that starts at the semifinals, and
 * a lone two-entrant Final, are naturally entirely Race to 9.
 *
 * Double elim: the grand final + reset (section GF), the winners-bracket final, and the losers-bracket
 * final are Race to 9 (the final-four/championship stage); all earlier WB/LB matches are Race to 7.
 */
export function playoffRaceLength(match: RoundedMatch, shape: PlayoffBracketShape): 7 | 9 {
  if (shape.isDoubleElim) {
    if (match.section === 'GF') return PLAYOFF_LATE_RACE
    if (match.section === 'WB' && match.round === shape.maxWbRound) return PLAYOFF_LATE_RACE
    if (match.section === 'LB' && match.round === shape.maxLbRound) return PLAYOFF_LATE_RACE
    return PLAYOFF_EARLY_RACE
  }
  // Single elim: last round = Final, last-but-one = Semifinals.
  return shape.totalRounds - match.round <= 1 ? PLAYOFF_LATE_RACE : PLAYOFF_EARLY_RACE
}

// ---------------------------------------------------------------------------- Display helpers

/** Human label for a Group Stage match format (used on reporting forms, cards, summaries). */
export const GROUP_STAGE_FORMAT_LABEL = `${GROUP_STAGE_GAMES} games`

/** The read-only format summary shown when Group Stage + Playoffs is chosen at creation. */
export const GROUPS_PLAYOFFS_FORMAT_SUMMARY: readonly { stage: string; format: string }[] = [
  { stage: 'Group Stage', format: `${GROUP_STAGE_GAMES} games` },
  { stage: 'Early Playoffs', format: `Race to ${PLAYOFF_EARLY_RACE}` },
  { stage: 'Semifinals', format: `Race to ${PLAYOFF_LATE_RACE}` },
  { stage: 'Final', format: `Race to ${PLAYOFF_LATE_RACE}` },
]
