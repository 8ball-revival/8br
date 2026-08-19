/**
 * Facts about the rankings data that BOTH the server aggregate and the browser table need.
 *
 * Deliberately dependency-free — no `server-only`, no Prisma, no React. The aggregate is server-only
 * and the table is a client component, so anything they share has to live somewhere neither of them
 * poisons: a client module that value-imports from a `server-only` file fails the build, and
 * duplicating these rules on both sides is how the two halves come to disagree.
 */

/**
 * The division filter value meaning "no division recorded".
 *
 * A real value rather than null, because null in a query string is indistinguishable from the
 * filter being switched off. Every Season currently predates the division field, so this is what
 * anything other than "All divisions" will match until the archive import assigns them.
 */
export const UNASSIGNED_DIVISION = 'unassigned'

export type Completeness = 'complete' | 'partial' | 'match-only' | 'none'

/** The fields completeness is derived from. */
export interface CompletenessInput {
  played: number
  forfeits: number
  matchesWithGameData: number
}

/**
 * How complete a row's underlying data is, derived from the fields themselves rather than assumed.
 *
 * Forfeits are excluded from the denominator because a forfeit legitimately has no frames: counting
 * one as missing data would mark a perfectly recorded season incomplete.
 */
export function completenessOf(row: CompletenessInput): Completeness {
  const scorable = row.played - row.forfeits
  if (row.played === 0) return 'none'
  if (scorable === 0) return 'match-only'
  if (row.matchesWithGameData >= scorable) return 'complete'
  if (row.matchesWithGameData > 0) return 'partial'
  return 'match-only'
}
