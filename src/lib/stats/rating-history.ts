import 'server-only'

import { ELO_START, ELO_K, expectedScore } from '@/lib/stats/elo'

/**
 * One rating replay, for every surface that shows a rating.
 *
 * ── The bug this exists to end ───────────────────────────────────────────────────────────────────
 * Two readers computed the Current ladder from the same ledger and disagreed by a point for three
 * players. Neither was "wrong" in isolation; they rounded at different moments.
 *
 * The ledger writer keeps a FRACTIONAL running rating and rounds only when it stores a row
 * (`postRating: Math.round(pre + delta)`), so the fraction carries forward into the next match. The
 * ladder replayed the window with an INTEGER running rating, rounding each delta before adding it.
 * Over a few hundred matches those two accumulate differently, and the difference surfaces as ±1 on
 * whoever happens to sit near a rounding boundary.
 *
 * A tolerance would have hidden it. Picking a reader would have made the other one wrong. The only
 * answer that stays true is one replay, used by both — so this module is the single definition of
 * "what is this player's rating", and `getLadder` and the Rankings table both call it.
 *
 * ── The rule it implements ───────────────────────────────────────────────────────────────────────
 * Carry the running rating unrounded, exactly as the ledger writer does, and round once at the end
 * for display. That way the replay reproduces the stored `postRating` values instead of drifting
 * away from them, and All-Time read from storage and Current read by replay agree by construction.
 */

export interface RatingRow {
  playerId: string
  playerName: string
  matchKey: string
  sequence: number
  /** A ledger row belongs to exactly one of these; the other is null. */
  tournamentId: number | null
  seasonId: number | null
  completedAt: Date
  actual: number
  result: string
  isForfeit: boolean
  isTeamMatch: boolean
  teamName: string | null
  ratingChange: number
  postRating: number
}

export interface RatingPoint {
  rating: number
  highestRating: number
}

/** Fixed movement for a team match — see `TEAM_DELTA` in the ledger writer for why it is not Elo. */
export const TEAM_DELTA = 2

/**
 * Replay a set of ledger rows into a rating per player.
 *
 * `rows` must already be filtered to the scope being asked about; this function does not decide what
 * counts, only what the arithmetic produces. Ordering is by `sequence`, which the ledger assigns in
 * completion order — the same order the writer used, so the replay follows the same path.
 *
 * Ties on `sequence` cannot happen: it is a strictly increasing counter over the rebuild. `matchKey`
 * groups the two (or more) rows belonging to one match so both sides move together.
 */
export function replayRatings(rows: readonly RatingRow[]): Map<string, RatingPoint> {
  const byMatch = new Map<string, RatingRow[]>()
  for (const r of rows) {
    const list = byMatch.get(r.matchKey)
    if (list) list.push(r)
    else byMatch.set(r.matchKey, [r])
  }
  const matches = [...byMatch.values()].sort((a, b) => a[0].sequence - b[0].sequence)

  /** Unrounded, exactly as the ledger writer carries it. Rounded once, at the end. */
  const rating = new Map<string, number>()
  const peak = new Map<string, number>()
  const cur = (id: string) => rating.get(id) ?? ELO_START

  for (const m of matches) {
    const isTeam = m[0].isTeamMatch
    const sides = isTeam
      ? [...new Set(m.map((r) => r.teamName))].map((tn) => m.filter((r) => r.teamName === tn))
      : m.map((r) => [r])
    if (sides.length !== 2) continue

    const [A, B] = sides
    const forfeit = m[0].isForfeit
    const actualA = A[0].actual

    /*
     * A forfeit moves nobody. A team match moves everyone on a roster by the same fixed amount.
     * Anything else is Elo over the two sides' current ratings, unrounded.
     */
    let dA: number
    if (forfeit) dA = 0
    else if (isTeam) dA = actualA === 1 ? TEAM_DELTA : -TEAM_DELTA
    else {
      const avg = (side: RatingRow[]) => side.reduce((s, r) => s + cur(r.playerId), 0) / side.length
      dA = ELO_K * (actualA - expectedScore(avg(A), avg(B)))
    }

    const apply = (side: RatingRow[], delta: number) => {
      for (const r of side) {
        const next = cur(r.playerId) + delta
        rating.set(r.playerId, next)
        peak.set(r.playerId, Math.max(peak.get(r.playerId) ?? ELO_START, next))
      }
    }
    apply(A, dA)
    apply(B, -dA)
  }

  const out = new Map<string, RatingPoint>()
  for (const [pid, r] of rating) {
    out.set(pid, { rating: Math.round(r), highestRating: Math.round(peak.get(pid) ?? ELO_START) })
  }
  return out
}

/**
 * The All-Time rating: what the ledger already stores.
 *
 * No replay, because the stored `postRating` IS the all-time running rating — recomputing it would
 * be asking the same question twice and inviting the two answers to differ, which is the whole
 * problem this module exists to solve.
 */
export function storedRatings(rows: readonly RatingRow[]): Map<string, RatingPoint> {
  const byPlayer = new Map<string, RatingRow[]>()
  for (const r of rows) {
    const list = byPlayer.get(r.playerId)
    if (list) list.push(r)
    else byPlayer.set(r.playerId, [r])
  }
  const out = new Map<string, RatingPoint>()
  for (const [pid, prs] of byPlayer) {
    prs.sort((a, b) => a.sequence - b.sequence)
    out.set(pid, {
      rating: prs[prs.length - 1].postRating,
      highestRating: Math.max(ELO_START, ...prs.map((r) => r.postRating)),
    })
  }
  return out
}

/**
 * The rolling window's lower bound.
 *
 * Inclusive: a match completed exactly on the boundary is inside the window. Compared as absolute
 * instants (both sides are UTC `Date`s from the database), so no timezone reinterpretation happens
 * anywhere — a match does not enter or leave the window because of where the reader is sitting.
 */
export const WINDOW_DAYS = 365
const DAY_MS = 86_400_000
export const windowCutoff = (now: Date): Date => new Date(now.getTime() - WINDOW_DAYS * DAY_MS)
export const inWindow = (completedAt: Date, cutoff: Date): boolean => completedAt >= cutoff

/**
 * The canonical rating for one scope. Both the ladder and the Rankings table call exactly this.
 *
 * ── The upper bound is a different thing from the window ─────────────────────────────────────────
 * `cutoff` is the rolling window's floor and only applies to Current. `toYear` is the Rankings
 * table's "as at the end of this year" bound, and it applies to BOTH scopes: an end-of-2007
 * snapshot must not know about a match played in 2008. Without it the table would print today's
 * rating under a historical heading.
 *
 * When `toYear` is set, All-Time is replayed rather than read from storage — the stored
 * `postRating` is the rating after every match ever played, which is exactly the figure a historical
 * snapshot must not use.
 */
export function ratingsForScope(
  rows: readonly RatingRow[],
  scope: 'current' | 'all-time',
  cutoff: Date,
  opts: { toYear?: number | null; yearOf?: (row: RatingRow) => number | null } = {},
): Map<string, RatingPoint> {
  const { toYear, yearOf } = opts
  let scoped = rows
  if (toYear != null && yearOf) {
    scoped = scoped.filter((r) => {
      const y = yearOf(r)
      return y == null || y <= toYear
    })
  }
  if (scope === 'current') return replayRatings(scoped.filter((r) => inWindow(r.completedAt, cutoff)))
  // A bounded All-Time is a replay: the stored figure knows about matches after the bound.
  return toYear != null ? replayRatings(scoped) : storedRatings(scoped)
}
