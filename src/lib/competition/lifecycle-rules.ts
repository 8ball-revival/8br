/**
 * THE canonical rule for where a competition may appear, and whether it counts.
 *
 * Live, Archives and Rankings all ask a version of the same question — "is this finished?" — and
 * before this file they each answered it themselves. That is how a Season comes to sit in an
 * archive while contributing nothing to the rankings, or to disappear from Live a deploy after it
 * finished. One rule, three readers.
 *
 * ── The boundary ─────────────────────────────────────────────────────────────────────────────────
 * COMPLETION is the boundary, and completion means two things together: the lifecycle says the
 * competition is over, AND its eligible results were finalised into the ranking record. A record
 * that claims the first without the second is NOT archive-eligible and NOT ranking-eligible — it is
 * a completion that failed halfway, and showing it as finished would publish a lie about who won.
 *
 * ── What this file must never do ─────────────────────────────────────────────────────────────────
 * It must never decide eligibility from what renders. Archives is a view of this rule, not its
 * source; asking "does it appear in the archive?" to decide whether it counts would make the
 * ranking a function of a page.
 *
 * Deliberately dependency-free (no Prisma, no `server-only`) so the same predicates run in a query
 * builder, in a server component, and in a test that hands them a plain object.
 */

// ── Season ───────────────────────────────────────────────────────────────────────────────────────

/** Every Season lifecycle state, in the order a Season passes through them. */
export const SEASON_STATES = [
  'REGISTRATION_SCHEDULED',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'GROUP_SETUP',
  'GROUP_STAGE_LIVE',
  'GROUPS_CLOSED',
  'PLAYOFF_SETUP',
  'PLAYOFFS_LIVE',
  'COMPLETED',
] as const

export type SeasonState = (typeof SEASON_STATES)[number]

/** The subset of a Season this module needs. Kept narrow so callers select only what they use. */
export interface SeasonFacts {
  lifecycleState: SeasonState | string
  /** Set when close finalised the eligible results into the ranking record. */
  ladderAppliedAt: Date | string | null
  /**
   * Historical reconstruction: built in Creator, never publicly Live while it is being entered.
   * Null on records that predate the flag, which are treated as live competitions.
   */
  reconstruction?: boolean | null
  /** Set while an authorised administrator has reopened a completed Season for correction. */
  reopenedAt?: Date | string | null
  cancelledAt?: Date | string | null
  deletedAt?: Date | string | null
}

// ── Tournament ───────────────────────────────────────────────────────────────────────────────────

export const TOURNAMENT_STATES = [
  'DRAFT',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'GROUPS_IN_PROGRESS',
  'BRACKET_GENERATED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const

export type TournamentState = (typeof TOURNAMENT_STATES)[number]

export interface TournamentFacts {
  lifecycleState: TournamentState | string | null
  /** The older run state, still present on legacy rows. Used only when lifecycleState is absent. */
  status?: string | null
  /** Set when the tournament's results were finalised into the ranking record. */
  archivedAt?: Date | string | null
  championHandle?: string | null
  reconstruction?: boolean | null
  reopenedAt?: Date | string | null
}

// ── Shared predicates ────────────────────────────────────────────────────────────────────────────

const present = (v: Date | string | null | undefined): boolean => v != null

/**
 * States in which a Season is genuinely under way: registration is open, or play has begun, and it
 * has not finished.
 *
 * PLAYOFF_SETUP is deliberately included. The bracket is private while it is being arranged, but the
 * Season itself is still running and its groups are still on screen — dropping it out of Live at
 * that moment would make a competition vanish mid-flight from a reader's point of view.
 */
const SEASON_RUNNING: readonly string[] = [
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'GROUP_SETUP',
  'GROUP_STAGE_LIVE',
  'GROUPS_CLOSED',
  'PLAYOFF_SETUP',
  'PLAYOFFS_LIVE',
]

/**
 * REGISTRATION_SCHEDULED is NOT running. It is an announced future competition, which belongs in
 * the homepage's Upcoming area — surfacing it under Live would tell a reader something is happening
 * now when nothing has opened.
 */
const SEASON_SCHEDULED = 'REGISTRATION_SCHEDULED'

const TOURNAMENT_RUNNING: readonly string[] = [
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'GROUPS_IN_PROGRESS',
  'BRACKET_GENERATED',
  'IN_PROGRESS',
]

/** Where a record may be shown. Exactly one applies. */
export type Surface = 'live' | 'archives' | 'creator-only'

// ── Season rules ─────────────────────────────────────────────────────────────────────────────────

export function seasonIsCancelledOrDeleted(s: SeasonFacts): boolean {
  return present(s.cancelledAt) || present(s.deletedAt)
}

/**
 * Archive-eligible, and therefore ranking-eligible.
 *
 * Both halves are required. `ladderAppliedAt` is the receipt that finalisation actually happened;
 * without it a COMPLETED row is a completion that did not finish, and it stays in Creator where
 * somebody can look at it.
 */
export function seasonIsArchived(s: SeasonFacts): boolean {
  if (seasonIsCancelledOrDeleted(s)) return false
  if (present(s.reopenedAt)) return false
  return s.lifecycleState === 'COMPLETED' && present(s.ladderAppliedAt)
}

/**
 * Publicly Live.
 *
 * `publiclyVisible` is passed in rather than read from the record because visibility is a different
 * concern from lifecycle: a Season can be running and still be a private reconstruction, and a
 * published Season can be finished. Both have to be true.
 */
export function seasonIsLive(s: SeasonFacts, publiclyVisible: boolean): boolean {
  if (!publiclyVisible) return false
  if (s.reconstruction === true) return false
  if (seasonIsCancelledOrDeleted(s)) return false
  if (present(s.reopenedAt)) return false
  return SEASON_RUNNING.includes(String(s.lifecycleState))
}

/** Announced, not yet open. Belongs in Upcoming, never in Live. */
export function seasonIsUpcoming(s: SeasonFacts, publiclyVisible: boolean): boolean {
  return publiclyVisible
    && s.reconstruction !== true
    && !seasonIsCancelledOrDeleted(s)
    && String(s.lifecycleState) === SEASON_SCHEDULED
}

export function seasonSurface(s: SeasonFacts, publiclyVisible: boolean): Surface {
  if (seasonIsArchived(s)) return 'archives'
  if (seasonIsLive(s, publiclyVisible)) return 'live'
  return 'creator-only'
}

// ── Tournament rules ─────────────────────────────────────────────────────────────────────────────

/** The lifecycle to read: the explicit column when set, the legacy run state otherwise. */
export function tournamentState(t: TournamentFacts): string {
  if (t.lifecycleState) return String(t.lifecycleState)
  // Legacy rows carry only TournamentRunState. ACTIVE maps to "under way"; the finished and
  // not-yet-started ends map to themselves.
  const legacy = String(t.status ?? '')
  if (legacy === 'COMPLETED') return 'COMPLETED'
  if (legacy === 'ACTIVE') return 'IN_PROGRESS'
  return 'DRAFT'
}

export function tournamentIsArchived(t: TournamentFacts): boolean {
  if (tournamentState(t) === 'CANCELLED') return false
  if (present(t.reopenedAt)) return false
  // `archivedAt` is the tournament's finalisation receipt, the counterpart of ladderAppliedAt.
  return tournamentState(t) === 'COMPLETED' && present(t.archivedAt)
}

export function tournamentIsLive(t: TournamentFacts, publiclyVisible: boolean): boolean {
  if (!publiclyVisible) return false
  if (t.reconstruction === true) return false
  if (present(t.reopenedAt)) return false
  return TOURNAMENT_RUNNING.includes(tournamentState(t))
}

export function tournamentSurface(t: TournamentFacts, publiclyVisible: boolean): Surface {
  if (tournamentIsArchived(t)) return 'archives'
  if (tournamentIsLive(t, publiclyVisible)) return 'live'
  return 'creator-only'
}

// ── Ranking eligibility ──────────────────────────────────────────────────────────────────────────

/**
 * May this competition's results count towards the rankings?
 *
 * The SAME predicate as archive eligibility, deliberately — not a similar one. If the two could
 * differ, a reader could find a competition in the archive whose results are missing from the
 * ranking, or a ranking built on a competition nobody can look up. Reopening a record therefore
 * removes it from both at once.
 */
export const seasonCountsForRankings = seasonIsArchived
export const tournamentCountsForRankings = tournamentIsArchived

/**
 * Individual results are excluded on top of the competition-level rule.
 *
 * These are the cases where the ranking record must not treat a row as a contest: a bye (nobody
 * played), an administrative advancement (nobody played), and a forfeit (a real result, but no
 * frames were contested, so it moves no rating).
 */
export interface ResultFacts {
  isBye?: boolean | null
  isAdministrative?: boolean | null
  isForfeit?: boolean | null
  /** A result recorded with no score at all, on a historical record where the winner is known. */
  scoreUnknown?: boolean | null
}

export function resultCountsForRating(r: ResultFacts): boolean {
  if (r.isBye) return false
  if (r.isAdministrative) return false
  if (r.isForfeit) return false
  return true
}

/**
 * A result may count towards a RECORD (won/lost) while not moving the rating.
 *
 * A forfeit is the case that separates the two: it is an official win and an official loss, so it
 * belongs in a win-loss record, but no frames were played so it must not move a rating. A bye and
 * an administrative advancement are not results at all and count for neither.
 */
export function resultCountsForRecord(r: ResultFacts): boolean {
  if (r.isBye) return false
  if (r.isAdministrative) return false
  return true
}

// ── Data completeness ────────────────────────────────────────────────────────────────────────────

/**
 * How much of a historical record survived.
 *
 * `partial` is a claim about the SOURCE, not about the entry: it means the archive this was rebuilt
 * from did not preserve everything, and the gaps were left as gaps. It exists so a reconstruction
 * can be published honestly instead of being padded with invented scores to look finished.
 */
export type DataCompleteness = 'full' | 'partial'

export const COMPLETENESS_LABEL: Record<DataCompleteness, string> = {
  full: 'Complete record',
  partial: 'Partial historical data',
}

export const COMPLETENESS_NOTE: Record<DataCompleteness, string> = {
  full: 'Every match, result and score for this competition is on record.',
  partial: 'Some of this competition’s matches, scores or dates were not preserved. What is missing has been left missing rather than filled in, and only verified results count towards the rankings.',
}
