import type { ExplorerRow } from '@/lib/stats/ladder-explorer'

/**
 * The statistics an automatic achievement can be built from.
 *
 * ── One registry, one source of truth ────────────────────────────────────────────────────────────
 * Every entry reads a field the Rankings aggregate already computes. Nothing here re-derives a win
 * total, a rating or a championship count — if it did, the Achievements page and the Rankings page
 * would eventually disagree about the same player, and there would be no way to tell which was
 * right.
 *
 * Two statistics (finals reached / lost) are not on the Rankings row because nothing else needed
 * them; they are computed once from the finals in the season archive and merged in by player id.
 * They are marked `source: 'finals'` so the engine knows to join them.
 *
 * ── Adding a statistic later ─────────────────────────────────────────────────────────────────────
 * Add an entry here. That is the whole change: the admin dropdown, the validation, the rule builder
 * and the engine all read this list, so a new statistic appears in the UI without a migration and
 * without touching the engine. The `statistic` column is a string for exactly this reason.
 */

export type StatSource = 'ladder' | 'finals'

export interface StatDefinition {
  key: string
  label: string
  /** Where the value comes from. See the note above. */
  source: StatSource
  /** Reads the value from a Rankings row. Only for `source: 'ladder'`. */
  read?: (row: ExplorerRow) => number
  /**
   * A percentage is formatted and compared differently from a count: it is shown to one decimal,
   * and it is meaningless without a minimum, which is why the editor demands one.
   */
  isPercentage?: boolean
  /**
   * Whether a minimum-matches threshold should be offered — and required — for this statistic.
   *
   * A rate without a floor is the classic bad leaderboard: somebody who played once and won is
   * "the best player of all time" at 100%. Counts do not have that problem, so the field is only
   * shown where it changes the answer.
   */
  needsMinimum?: boolean
  /** Which stage filters make sense. A rating is not a per-stage figure. */
  stageAware?: boolean
  /** One line for the admin, explaining exactly what is counted. */
  hint: string
}

export const STATISTICS: StatDefinition[] = [
  // ── Volume ──────────────────────────────────────────────────────────────────────────────────
  { key: 'matchesPlayed', label: 'Matches played', source: 'ladder', stageAware: true,
    read: (r) => r.played, hint: 'Completed matches. Forfeits and no-contests are not played matches.' },
  { key: 'wins', label: 'Wins', source: 'ladder', stageAware: true,
    read: (r) => r.wins, hint: 'Matches won. Byes and walkovers are excluded.' },
  { key: 'losses', label: 'Losses', source: 'ladder', stageAware: true,
    read: (r) => r.losses, hint: 'Matches lost.' },
  { key: 'draws', label: 'Draws', source: 'ladder', stageAware: true,
    read: (r) => r.draws, hint: 'Drawn matches. Group stages only; a playoff cannot end level.' },
  { key: 'winPct', label: 'Win percentage', source: 'ladder', stageAware: true, isPercentage: true,
    needsMinimum: true, read: (r) => r.matchWinPct,
    hint: 'Wins as a share of played matches, draws included in the denominator.' },

  // ── Games within matches ────────────────────────────────────────────────────────────────────
  { key: 'gamesWon', label: 'Games won', source: 'ladder', stageAware: true,
    read: (r) => r.gamesWon, hint: 'Individual games (racks) won across all matches.' },
  { key: 'gamesLost', label: 'Games lost', source: 'ladder', stageAware: true,
    read: (r) => r.gamesLost, hint: 'Individual games lost.' },
  { key: 'gameWinPct', label: 'Game win percentage', source: 'ladder', stageAware: true,
    isPercentage: true, needsMinimum: true, read: (r) => r.gameWinPct,
    hint: 'Games won as a share of games played.' },

  // ── Standing ────────────────────────────────────────────────────────────────────────────────
  { key: 'rating', label: 'Rating', source: 'ladder',
    read: (r) => r.rating, hint: 'Current Elo rating, including the championship step.' },
  { key: 'peakRating', label: 'Highest rating reached', source: 'ladder',
    read: (r) => r.peakRating, hint: 'The highest rating this player ever held.' },
  { key: 'currentStreak', label: 'Current streak', source: 'ladder',
    read: (r) => r.currentStreak,
    hint: 'Signed: positive is an unbeaten run, negative a losing one. Use Lowest to find the worst.' },
  { key: 'longestWinStreak', label: 'Longest win streak', source: 'ladder',
    read: (r) => r.longestStreak, hint: 'The longest unbroken run of wins in this player’s career.' },

  // ── Participation ───────────────────────────────────────────────────────────────────────────
  { key: 'seasonsPlayed', label: 'Seasons entered', source: 'ladder',
    read: (r) => r.seasonsPlayed, hint: 'Distinct Seasons this player took part in.' },
  { key: 'competitionsEntered', label: 'Competitions entered', source: 'ladder',
    read: (r) => r.competitionsEntered, hint: 'Distinct Seasons and Tournaments combined.' },
  { key: 'forfeits', label: 'Forfeits', source: 'ladder',
    read: (r) => r.forfeits, hint: 'Matches this player forfeited.' },

  // ── Silverware ──────────────────────────────────────────────────────────────────────────────
  { key: 'seasonTitles', label: 'Season championships', source: 'ladder',
    read: (r) => r.seasonTitles, hint: 'Seasons won.' },
  { key: 'tournamentTitles', label: 'Tournament titles', source: 'ladder',
    read: (r) => r.tournamentTitles, hint: 'Standalone Tournaments won.' },
  { key: 'totalTitles', label: 'Total championships', source: 'ladder',
    read: (r) => r.seasonTitles + r.tournamentTitles, hint: 'Seasons and Tournaments won, together.' },

  // ── Per-stage records ───────────────────────────────────────────────────────────────────────
  { key: 'groupWins', label: 'Group stage wins', source: 'ladder',
    read: (r) => r.groupWins, hint: 'Wins in Season group stages only.' },
  { key: 'groupLosses', label: 'Group stage losses', source: 'ladder',
    read: (r) => r.groupLosses, hint: 'Losses in Season group stages only.' },
  { key: 'playoffWins', label: 'Playoff wins', source: 'ladder',
    read: (r) => r.playoffWins, hint: 'Wins in Season playoff brackets only.' },
  { key: 'playoffLosses', label: 'Playoff losses', source: 'ladder',
    read: (r) => r.playoffLosses, hint: 'Losses in Season playoff brackets only.' },
  { key: 'playoffMatches', label: 'Playoff matches', source: 'ladder',
    read: (r) => r.playoffWins + r.playoffLosses + r.playoffDraws,
    hint: 'Every playoff match played.' },
  { key: 'tournamentWins', label: 'Tournament wins', source: 'ladder',
    read: (r) => r.tournamentWins, hint: 'Wins in standalone Tournaments.' },
  { key: 'tournamentLosses', label: 'Tournament losses', source: 'ladder',
    read: (r) => r.tournamentLosses, hint: 'Losses in standalone Tournaments.' },

  // ── Finals ──────────────────────────────────────────────────────────────────────────────────
  // Not on the Rankings row: nothing else needed them. Computed from the season archive's finals
  // and joined by player id — see the engine.
  { key: 'finalsReached', label: 'Finals reached', source: 'finals',
    hint: 'Season Finals played, won or lost.' },
  { key: 'finalsWon', label: 'Finals won', source: 'finals',
    hint: 'Season Finals won. Equal to Season championships except where a title was awarded without a final.' },
  { key: 'finalsLost', label: 'Finals lost', source: 'finals',
    hint: 'Season Finals reached and lost.' },
]

const BY_KEY = new Map(STATISTICS.map((s) => [s.key, s]))

export const statistic = (key: string | null | undefined): StatDefinition | null =>
  (key ? BY_KEY.get(key) ?? null : null)

/** Statistics offered as a tie-break. Percentages are poor tie-breaks; counts separate cleanly. */
export const TIEBREAK_STATISTICS = STATISTICS.filter((s) => !s.isPercentage)

/* ─────────────────────────────────────────────────────────────────────── display format ───────── */

/** The only token the format may contain. */
export const FORMAT_TOKEN = '{value}'

/**
 * Whether a display format is safe to publish.
 *
 * Deliberately strict: exactly one `{value}`, no other braces, and a sane length. The format is
 * admin-authored text that ends up in the page, so anything that looks like a second token is
 * rejected rather than rendered literally — a card reading "{valeu} LOSSES" is a bug that reaches
 * the public site, and it is much easier to refuse at save time.
 */
export function validateFormat(format: string): { ok: true } | { ok: false; error: string } {
  const f = format.trim()
  if (!f) return { ok: false, error: 'A display format is required. Use {value} where the number goes.' }
  if (f.length > 60) return { ok: false, error: 'Keep the display format under 60 characters.' }
  const tokens = f.match(/\{[^}]*\}/g) ?? []
  if (tokens.length === 0) return { ok: false, error: 'The format must include {value}.' }
  if (tokens.length > 1) return { ok: false, error: 'Use {value} exactly once.' }
  if (tokens[0] !== FORMAT_TOKEN) {
    return { ok: false, error: `Unknown token ${tokens[0]}. The only supported token is {value}.` }
  }
  return { ok: true }
}

/** Substitute the computed figure into an already-validated format. */
export function applyFormat(format: string, value: string): string {
  return format.includes(FORMAT_TOKEN) ? format.split(FORMAT_TOKEN).join(value) : `${value} ${format}`.trim()
}

/** How a raw number is written before it goes into the format. */
export function formatValue(raw: number, def: StatDefinition | null): string {
  if (def?.isPercentage) return raw.toFixed(1)
  return Number.isInteger(raw) ? raw.toLocaleString() : raw.toFixed(1)
}
