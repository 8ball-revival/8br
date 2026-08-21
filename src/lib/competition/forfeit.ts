/**
 * FF — a Tournament match nobody played.
 *
 * ── What a forfeit is, and is not ────────────────────────────────────────────────────────────────
 * One player did not play. The other moves on because the bracket has to keep moving, NOT because
 * they beat anybody. Those are different facts, and the whole design here exists to keep them
 * separate: the opponent advances structurally, and their competitive record does not change.
 *
 * ── Why no score is stored ───────────────────────────────────────────────────────────────────────
 * The obvious shortcut is to write 7–0 and let everything downstream treat it as an ordinary win.
 * It is wrong within a week: the frame count is fiction, the point differential is fiction, and once
 * it is in the table nothing can tell it apart from a real 7–0. So `homeGames`/`awayGames` stay
 * NULL, the status says FORFEIT, and `forfeitRegistrationId` says who. Anything that needs to know
 * can ask; nothing has to guess.
 *
 * This mirrors `season_match.forfeitEntrantId` exactly — the convention this project already settled
 * on. One rule, two models.
 *
 * ── A bye is not a forfeit ───────────────────────────────────────────────────────────────────────
 * A bye is an empty slot: nobody was ever scheduled, so there is nothing to forfeit and nobody to
 * record. A forfeit needs two named players, one of whom failed to appear. `interpretForfeit`
 * refuses when the opponent is missing, precisely so the two cannot be conflated.
 *
 * Pure — no database, no imports. Every rule here is directly testable.
 */

/** One side of a score entry, as typed. */
export type ForfeitField = { kind: 'ff' } | { kind: 'number'; n: number } | { kind: 'blank' } | { kind: 'invalid' }

/**
 * Read one field.
 *
 * Case-insensitive and whitespace-tolerant by intent: an administrator typing quickly produces
 * `ff`, ` FF `, `Ff`, and rejecting those would be a puzzle rather than a safeguard.
 */
export function parseForfeitField(raw: string | number | null | undefined): ForfeitField {
  if (typeof raw === 'number') return Number.isInteger(raw) && raw >= 0 ? { kind: 'number', n: raw } : { kind: 'invalid' }
  const s = (raw ?? '').trim()
  if (s === '') return { kind: 'blank' }
  if (s.toUpperCase() === 'FF') return { kind: 'ff' }
  if (/^\d+$/.test(s)) return { kind: 'number', n: Number(s) }
  return { kind: 'invalid' }
}

export type MatchEntry =
  | { kind: 'score'; homeGames: number; awayGames: number }
  | { kind: 'forfeit'; forfeiter: 'home' | 'away' }
  | { kind: 'invalid'; error: string }

/**
 * Interpret a pair of entered fields.
 *
 * `bothPresent` is whether the match actually has two determined players. A forfeit is refused
 * without it: with one slot still empty there is no opponent to advance, so recording one would
 * either strand the bracket or invent a winner.
 */
export function interpretForfeit(
  homeRaw: string | number | null | undefined,
  awayRaw: string | number | null | undefined,
  opts: { bothPresent: boolean },
): MatchEntry {
  const h = parseForfeitField(homeRaw)
  const a = parseForfeitField(awayRaw)

  if (h.kind === 'invalid' || a.kind === 'invalid') {
    return { kind: 'invalid', error: 'Enter a whole number of games, or FF for a forfeit.' }
  }

  if (h.kind === 'ff' || a.kind === 'ff') {
    // Both sides FF has no answer: there is no opponent to advance, and picking one would be a
    // coin toss recorded as a result.
    if (h.kind === 'ff' && a.kind === 'ff') {
      return { kind: 'invalid', error: 'Both players cannot forfeit the same match. Enter FF for one side only.' }
    }
    if (!opts.bothPresent) {
      return { kind: 'invalid', error: 'Both players must be determined before a forfeit can be recorded.' }
    }
    // The opponent's field is ignored rather than required — a forfeited match has no score, so
    // asking for one would be asking for a number that means nothing.
    return { kind: 'forfeit', forfeiter: h.kind === 'ff' ? 'home' : 'away' }
  }

  if (h.kind === 'blank' || a.kind === 'blank') {
    return { kind: 'invalid', error: 'Enter both scores, or FF for the player who forfeited.' }
  }
  return { kind: 'score', homeGames: h.n, awayGames: a.n }
}

/** How a forfeited match reads. The forfeiting side shows FF; the opponent shows no invented score. */
export const FORFEIT_LABEL = 'FF'
