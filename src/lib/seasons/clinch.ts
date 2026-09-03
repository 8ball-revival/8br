/**
 * Mathematical clinching: has this player GUARANTEED a top-N finish in their group?
 *
 * ── The one rule that matters ───────────────────────────────────────────────────────────────────
 * A clinch is a claim that no sequence of remaining results can push the player out. Being top of
 * the table with three games left is not a clinch; it is a lead. So every bound below is taken
 * against the player and in favour of their rivals, and the answer is "not clinched" whenever the
 * arithmetic is close enough to be arguable.
 *
 * Announcing a qualification that later evaporates is far worse than announcing one late, so where
 * a sharper analysis would clinch somebody earlier, this deliberately does not attempt it — see
 * "What is knowingly left on the table" below.
 *
 * ── Pure, and separately testable ───────────────────────────────────────────────────────────────
 * No database, no Prisma, no season lookup: it takes rows and remaining fixtures and returns a
 * verdict per player. That is what lets the suite throw adversarial fixtures at it — a rival who
 * wins everything, a rival who cannot be caught, ties on every tiebreak — without building a season
 * for each one.
 */

/** One competitor's current, RECORDED position. Every figure comes from the persisted standings. */
export interface ClinchRow {
  entrantId: number
  points: number
  wins: number
  losses: number
  draws: number
  played: number
  gamesWon: number
  gamesLost: number
  /** Scheduled sets not yet resolved. Counted from fixtures, never inferred from the record. */
  remaining: number
  /**
   * The engine's applied rank within the group.
   *
   * Only consulted once NOTHING remains to be played. At that point the table is final and its
   * tiebreaks — head-to-head included — have already been resolved by `computeStandings`, so rank
   * is the answer rather than a guess about one.
   */
  rank: number
}

export interface ClinchInput {
  rows: ClinchRow[]
  /** How many advance from this group. From `advancingInGroup`, never a literal. */
  advancing: number
  /** Points for a win under this Season's rules. */
  pointsForWin: number
  /** Points for a draw. */
  pointsForDraw: number
  /**
   * The bonus for completing every scheduled set, and the slate length that earns it.
   *
   * Needed in both directions: a rival can still collect it (so it raises their ceiling), and a
   * player who has NOT yet completed their slate cannot be assumed to collect it (so it does not
   * raise their floor).
   */
  completionBonus: number
  fullSlate: number
}

export type ClinchStatus =
  /** Nothing decided. */
  | 'none'
  /** Currently inside the advancing positions, but catchable. NOT a clinch. */
  | 'above-line'
  /** Cannot finish outside the advancing positions, whatever happens. */
  | 'clinched'
  /** Cannot finish anywhere except their exact current position. */
  | 'seed-locked'

export interface ClinchVerdict {
  entrantId: number
  status: ClinchStatus
  /** The floor and ceiling used, so a verdict can be explained rather than just asserted. */
  floor: number
  ceiling: number
  /** How many rivals could still finish above them. Below `advancing` is what clinches. */
  rivalsAbove: number
}

/**
 * The worst final points total a player can still end on.
 *
 * Zero from every remaining set, and NO completion bonus unless it is already banked — a set can be
 * closed out as a no contest, which leaves the slate incomplete, so a player who has not finished
 * theirs cannot count on it.
 */
function floorPoints(r: ClinchRow, i: ClinchInput): number {
  const banked = r.played >= i.fullSlate && i.fullSlate > 0 ? i.completionBonus : 0
  return r.points - alreadyCountedBonus(r, i) + banked
}

/**
 * The best final points total a player can still reach.
 *
 * Every remaining set won, plus the completion bonus if finishing the slate is still possible.
 */
function ceilingPoints(r: ClinchRow, i: ClinchInput): number {
  const base = r.points - alreadyCountedBonus(r, i)
  const canComplete = i.fullSlate > 0 && r.played + r.remaining >= i.fullSlate
  return base + r.remaining * i.pointsForWin + (canComplete ? i.completionBonus : 0)
}

/**
 * The completion bonus already inside `points`, so the bounds do not add it twice.
 *
 * `computeStandings` folds the bonus into the stored total the moment the slate is complete. Both
 * bounds rebuild a total from scratch, so the banked bonus has to come back out first.
 */
function alreadyCountedBonus(r: ClinchRow, i: ClinchInput): number {
  return i.fullSlate > 0 && r.played >= i.fullSlate ? i.completionBonus : 0
}

/**
 * Could `rival` still finish at or above `player`?
 *
 * "At or above" rather than "above": equal points go to a tiebreaker, and the tiebreakers include
 * head-to-head results that have not been played yet. A tie is therefore unresolvable in advance
 * and counts against the clinch.
 */
function couldOvertake(player: ClinchRow, rival: ClinchRow, i: ClinchInput): boolean {
  /*
    A finished group is not a forecast.

    With no sets left anywhere between the two, neither total can move and the tie-breaks have
    already been applied — so "could this rival still finish above" becomes "did they". Without this
    a completed season showed its top three as merely above the line: three players level on points
    each counted as able to overtake the others, for ever, because a tie is unresolvable only while
    there is still a match that might resolve it.
  */
  if (player.remaining === 0 && rival.remaining === 0) {
    return rival.points > player.points
      || (rival.points === player.points && rival.rank < player.rank)
  }
  return ceilingPoints(rival, i) >= floorPoints(player, i)
}

export function computeClinches(input: ClinchInput): ClinchVerdict[] {
  const { rows, advancing } = input

  return rows.map((r) => {
    const floor = floorPoints(r, input)
    const ceiling = ceilingPoints(r, input)
    const rivals = rows.filter((o) => o.entrantId !== r.entrantId)
    const rivalsAbove = rivals.filter((o) => couldOvertake(r, o, input)).length

    /*
      The clinch test, in one line: if fewer rivals than there are places can still reach you, you
      are in — because even if every one of them does, they fill fewer than the available seats.

      Note this counts rivals INDEPENDENTLY. Two rivals who still have to play each other cannot
      both take maximum points from that match, so the true number who can pass is sometimes lower
      than this. Ignoring that makes the test strictly harder to satisfy, never easier, which is the
      direction an error is allowed to point in.
    */
    const clinched = advancing > 0 && rivalsAbove < advancing

    if (!clinched) {
      const currentlyAbove = currentPosition(rows, r, input) <= advancing && advancing > 0
      return { entrantId: r.entrantId, status: currentlyAbove ? 'above-line' : 'none', floor, ceiling, rivalsAbove }
    }

    /*
      A seed is locked when nobody can move past you in EITHER direction: every other player is
      already decided relative to you. That is a stronger claim than clinching, and it is what lets
      the board distinguish "you are in" from "you are in, third, and it cannot change".
    */
    const separated = rivals.every((o) => {
      const oCeil = ceilingPoints(o, input)
      const oFloor = floorPoints(o, input)
      return oCeil < floor || oFloor > ceiling
    })
    return { entrantId: r.entrantId, status: separated ? 'seed-locked' : 'clinched', floor, ceiling, rivalsAbove }
  })
}

/**
 * Where a player sits right now, by recorded points alone.
 *
 * Only used to tell "above the line" from "nothing decided" — a presentational distinction. The
 * clinch test never consults it, because a current position is exactly the thing that can change.
 */
function currentPosition(rows: ClinchRow[], r: ClinchRow, i: ClinchInput): number {
  void i
  const better = rows.filter((o) => o.points > r.points).length
  return better + 1
}

/** Whether a verdict is one the board marks with a lock. */
export function isClinched(status: ClinchStatus): boolean {
  return status === 'clinched' || status === 'seed-locked'
}

/*
  ── What is knowingly left on the table ───────────────────────────────────────────────────────────

  Three refinements would clinch some players earlier, and all three are omitted on purpose:

    · Rivals who still play each other cannot all reach their ceilings, because one of those matches
      hands out at most one win. Modelling that needs the remaining FIXTURE LIST per pair, not just a
      count, and the gain is a clinch one or two rounds sooner.
    · Tiebreakers are treated as unresolvable, so an equal ceiling always counts against. In practice
      a large game-difference lead often settles it.
    · No search over completions. An exhaustive check would be exact, but a group of eight with
      twenty sets left is three-to-the-twenty scenarios.

  Every one of these makes the test more conservative than perfect play requires. None can produce a
  false clinch, which is the only error that matters here.
*/
