/**
 * Competition Year — the shared rules for the `competitionYear` field on Seasons and Tournaments.
 *
 * One module so the create forms, the server actions, the Prisma writes, the import/export paths
 * and the tests all agree on the same range, the same default, and the same sort order. Pure and
 * framework-free so scripts can import it too.
 */

/** Admin-facing label. Kept here so every form and column header spells it the same way. */
export const COMPETITION_YEAR_LABEL = 'Competition Year'

/** Supported range. Historical competitions and future scheduled ones are both allowed. */
export const COMPETITION_YEAR_MIN = 1900
export const COMPETITION_YEAR_MAX = 2100

/** Default for a new record: the current calendar year. */
export function currentCompetitionYear(): number {
  return new Date().getFullYear()
}

/**
 * Validate an incoming value. Returns the parsed year, or an error message suitable for showing
 * next to the field. Accepts a number or a numeric string (form posts arrive as strings).
 */
export function parseCompetitionYear(raw: unknown): { ok: true; year: number } | { ok: false; error: string } {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, error: `${COMPETITION_YEAR_LABEL} must be a whole number.` }
  }
  if (n < COMPETITION_YEAR_MIN || n > COMPETITION_YEAR_MAX) {
    return {
      ok: false,
      error: `${COMPETITION_YEAR_LABEL} must be between ${COMPETITION_YEAR_MIN} and ${COMPETITION_YEAR_MAX}.`,
    }
  }
  return { ok: true, year: n }
}

/** True when the value is a valid four-digit competition year. */
export function isValidCompetitionYear(raw: unknown): boolean {
  return parseCompetitionYear(raw).ok
}

/**
 * Default chronological ordering, newest first:
 *   1. competitionYear descending
 *   2. the competition's own start/event date descending, when it has one
 *   3. name/title, so equal years and missing dates still order stably
 *
 * Prisma sorts NULLs last on `desc` by default, which is what we want: a scheduled competition
 * with a real date outranks one that has none.
 */
export const SEASON_ORDER = [
  { competitionYear: 'desc' as const },
  { scheduledStartAt: 'desc' as const },
  { number: 'desc' as const },
]

export const TOURNAMENT_ORDER = [
  { competitionYear: 'desc' as const },
  { scheduledStartAt: 'desc' as const },
  { name: 'asc' as const },
]
