import { foldForSort } from '@/lib/staff/member-order'

/**
 * The order the Season Progress panel puts one Season's entrants in — the whole rule, in one place.
 *
 * ── Why this rule is written here at all ────────────────────────────────────────────────────────
 * `computeStandings` already ranks a group, and it is authoritative WITHIN one: it can use the
 * head-to-head result between two tied players because, inside a group, everybody has played
 * everybody. Across groups that tiebreaker does not exist — two players tied on points may never
 * meet — so a group's `rank` cannot be compared with another group's.
 *
 * The only cross-group ordering the codebase has is `orderQualifiers`, and it is not a performance
 * comparator: it snake-drafts by group letter for BRACKET SEEDING, so group A's runner-up outranks
 * group B's by virtue of the letter. Using it here would order a standings table alphabetically by
 * group and call it a ranking.
 *
 * So this is a genuinely new decision, and it is centralised and tested rather than inlined into a
 * component. What it must NOT do is re-derive any figure: points, wins, draws and games all arrive
 * from the persisted `SeasonStanding` rows that `recomputeSeasonStandings` wrote. This decides the
 * ORDER of official numbers; it never computes one.
 *
 * ── The order ───────────────────────────────────────────────────────────────────────────────────
 * Played before unplayed, because a table whose top row has played nothing is not a standings
 * table. Then, among the played:
 *
 *   1. Official points, descending — the competition's own measure of who is ahead.
 *   2. Set win percentage, descending — separates 3–0 from 3–2 at equal points.
 *   3. Individual-game differential, descending.
 *   4. Individual games won, descending.
 *   5. Ladder rank, ascending — the deterministic tiebreak when the season cannot separate them.
 *   6. CueVerse ID — so the order is total, and identical on every machine.
 *
 * Among the unplayed there is no season performance to compare, so ladder rank leads: it is the only
 * evidence available about who is likely to be near the top. An entrant with no ladder rank has
 * never played a ranked match, so they sort after everyone who has, alphabetically.
 */
export interface OrderableRow {
  played: number
  wins: number
  losses: number
  draws: number
  gamesWon: number
  gamesLost: number
  points: number
  /** Current ladder rank, or null for an entrant the ladder has never ranked. */
  ladderRank: number | null
  /** The only identity this panel shows, and its final tiebreak. */
  handle: string
}

/** Sets won as a share of sets played. Zero when nothing has been played, which never gets compared. */
function setWinPct(r: OrderableRow): number {
  const played = r.wins + r.losses + r.draws
  return played > 0 ? r.wins / played : 0
}

/**
 * Ladder rank, ascending, with "unranked" sorting last rather than first.
 *
 * A null rank compared as 0 would put every entrant the ladder has never seen above the world
 * number one, which is the opposite of what "unranked" means.
 */
function byLadderRank(a: OrderableRow, b: OrderableRow): number {
  if (a.ladderRank == null && b.ladderRank == null) return 0
  if (a.ladderRank == null) return 1
  if (b.ladderRank == null) return -1
  return a.ladderRank - b.ladderRank
}

/*
  Codepoint order over a case-folded handle, not `localeCompare`.

  The same reasoning as `lib/staff/member-order.ts`, which this borrows its folding from: an
  unspecified locale asks the RUNTIME what alphabet it is using, so a list can order differently in
  development than in production. Reusing `foldForSort` also means a handle sorts the same way here
  as it does in the members list and the players directory.
*/
function byHandle(a: OrderableRow, b: OrderableRow): number {
  const x = foldForSort(a.handle)
  const y = foldForSort(b.handle)
  return x < y ? -1 : x > y ? 1 : 0
}

export function compareSeasonProgress(a: OrderableRow, b: OrderableRow): number {
  // Played before unplayed. Nothing below this line can promote an entrant who has played nothing.
  const aPlayed = a.played > 0
  const bPlayed = b.played > 0
  if (aPlayed !== bPlayed) return aPlayed ? -1 : 1

  if (aPlayed) {
    if (b.points !== a.points) return b.points - a.points

    const setPct = setWinPct(b) - setWinPct(a)
    if (Math.abs(setPct) > 1e-9) return setPct

    const diff = (b.gamesWon - b.gamesLost) - (a.gamesWon - a.gamesLost)
    if (diff !== 0) return diff

    if (b.gamesWon !== a.gamesWon) return b.gamesWon - a.gamesWon
  }

  // Reached by the unplayed immediately, and by the played only when the season cannot separate them.
  const ladder = byLadderRank(a, b)
  if (ladder !== 0) return ladder

  return byHandle(a, b)
}

/** Game wins as a share of games played, or null when no numeric game score has been recorded. */
export function gameWinPct(gamesWon: number, gamesLost: number): number | null {
  const total = gamesWon + gamesLost
  return total > 0 ? (gamesWon / total) * 100 : null
}

/**
 * A percentage for display: whole where it is whole, one decimal where it is not.
 *
 * `88%` rather than `88.0%`, and `83.3%` rather than `83%`, because rounding 5/6 to a whole number
 * loses the only thing that distinguishes it from 5/6 of something else. An em dash rather than
 * `0%` when nothing has been played: zero percent is a claim about games that were played and lost.
 */
export function formatPct(pct: number | null): string {
  if (pct == null) return '—'
  const rounded = Math.round(pct * 10) / 10
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`
}
