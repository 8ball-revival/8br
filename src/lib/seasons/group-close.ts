import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * What closing the group stage is about to do, and what it must refuse to do.
 *
 * ── Two different kinds of "not finished" ────────────────────────────────────────────────────────
 * An UNRESOLVED match is one nobody played. That is ordinary: a Season ends with a few fixtures
 * never contested, and closing turns them into No Contest — no points, no W/L/D, no rating, no game
 * differential, no streak. The operator is told how many and what that means, and may proceed.
 *
 * A MALFORMED match is one that was half-entered: a row claiming a result it does not actually hold,
 * or holding a result it does not claim. That is not a competition outcome, it is damage, and
 * sweeping it into No Contest would silently convert somebody's lost score into "never played".
 * So it blocks, by name, until it is corrected or explicitly cleared.
 *
 * The distinction is the whole point of this module. Rolling them together — which is what a plain
 * `status = SCHEDULED` sweep does — makes the destructive case invisible inside the routine one.
 *
 * ── Where malformed rows come from ───────────────────────────────────────────────────────────────
 * Not from the save path: `saveSeasonGroupResults` rejects every invalid entry before it writes, so
 * a row cannot become malformed by being typed. They come from imports, from archive fills that were
 * interrupted, and from earlier code that wrote a status without its accompanying fields. That is
 * exactly why the check reads the DATABASE rather than trusting that the only writer is the form.
 */

export type MalformedReason =
  | 'half-entered'
  | 'result-without-scores'
  | 'winner-disagrees-with-scores'
  | 'draw-with-a-winner'
  | 'forfeit-without-a-forfeiter'

export interface MalformedMatch {
  matchId: number
  groupId: number | null
  home: string
  away: string
  reason: MalformedReason
  /** Plain language, for a person who has to decide what to do about it. */
  detail: string
}

export interface CloseGroupsPreflight {
  /** Never played. Closing makes these No Contest. */
  unresolved: number
  unresolvedMatchups: { home: string; away: string }[]
  /** Half-entered or self-contradictory. These block closing. */
  malformed: MalformedMatch[]
  canClose: boolean
}

const DETAIL: Record<MalformedReason, string> = {
  'half-entered': 'One player has a game total and the other does not.',
  'result-without-scores': 'Recorded as a completed result, but the game totals are missing.',
  'winner-disagrees-with-scores': 'The recorded winner is not the player with more games.',
  'draw-with-a-winner': 'The game totals are level, but a winner is recorded.',
  'forfeit-without-a-forfeiter': 'Recorded as a forfeit, but nobody is marked as forfeiting.',
}

/** Everything wrong with one match, or null when it is fine. */
function inspect(m: {
  id: number; groupId: number | null; status: string
  homeGames: number | null; awayGames: number | null
  homeEntrantId: number; awayEntrantId: number
  winnerEntrantId: number | null; forfeitEntrantId: number | null
  homeUsername: string; awayUsername: string
}): MalformedMatch | null {
  const of = (reason: MalformedReason): MalformedMatch => ({
    matchId: m.id, groupId: m.groupId, home: m.homeUsername, away: m.awayUsername,
    reason, detail: DETAIL[reason],
  })
  const hasHome = m.homeGames != null
  const hasAway = m.awayGames != null

  if (m.status === 'SCHEDULED' || m.status === 'NO_CONTEST') {
    // Unplayed means unplayed. A lone score on an unplayed row is a lost result, not an absence.
    if (hasHome !== hasAway) return of('half-entered')
    return null
  }

  if (m.status === 'COMPLETED') {
    if (!hasHome || !hasAway) return of('result-without-scores')
    const level = m.homeGames === m.awayGames
    if (level && m.winnerEntrantId != null) return of('draw-with-a-winner')
    if (!level) {
      const shouldWin = m.homeGames! > m.awayGames! ? m.homeEntrantId : m.awayEntrantId
      // A missing winner on a decided score is as wrong as the wrong winner: the standings read the
      // winner column, so the score on screen and the points in the table would disagree.
      if (m.winnerEntrantId !== shouldWin) return of('winner-disagrees-with-scores')
    }
    return null
  }

  if (m.status === 'FORFEIT' && m.forfeitEntrantId == null) return of('forfeit-without-a-forfeiter')

  // VOID is legacy kick-out state and carries no score by design.
  return null
}

export async function closeGroupsPreflight(seasonId: number): Promise<CloseGroupsPreflight> {
  const matches = await prisma.seasonMatch.findMany({
    where: { seasonId },
    select: {
      id: true, groupId: true, status: true, homeGames: true, awayGames: true,
      homeEntrantId: true, awayEntrantId: true, winnerEntrantId: true, forfeitEntrantId: true,
      homeUsername: true, awayUsername: true,
    },
    orderBy: { id: 'asc' },
  })

  const malformed: MalformedMatch[] = []
  const unresolvedMatchups: { home: string; away: string }[] = []
  for (const m of matches) {
    const bad = inspect(m)
    if (bad) { malformed.push(bad); continue }
    // Only a clean SCHEDULED row is genuinely "never played".
    if (m.status === 'SCHEDULED') unresolvedMatchups.push({ home: m.homeUsername, away: m.awayUsername })
  }

  return {
    unresolved: unresolvedMatchups.length,
    unresolvedMatchups,
    malformed,
    canClose: malformed.length === 0,
  }
}

/**
 * What reopening would put back in question.
 *
 * Reopening changes standings, and standings are what the playoff field and its seeds were built
 * from. The bracket is NOT deleted for that — a draft somebody arranged by hand is real work, and
 * discarding it to spare them a review is the expensive way to be helpful. This describes what to
 * look at; the caller decides.
 */
export interface ReopenImpact {
  draftPlayoffMatches: number
  publishedPlayoffMatches: number
  selectedEntrants: number
  /** One line per thing a person has to go and check. Empty means reopening changes nothing else. */
  requiresReview: string[]
}

export async function reopenGroupsImpact(seasonId: number): Promise<ReopenImpact> {
  const [draftPlayoffMatches, publishedPlayoffMatches, selectedEntrants, decided] = await Promise.all([
    prisma.seasonPlayoffMatch.count({ where: { seasonId, published: false } }),
    prisma.seasonPlayoffMatch.count({ where: { seasonId, published: true } }),
    prisma.seasonEntrant.count({ where: { seasonId, playoffIncluded: true } }),
    prisma.seasonPlayoffMatch.count({ where: { seasonId, winnerEntrantId: { not: null } } }),
  ])

  const requiresReview: string[] = []
  if (selectedEntrants > 0) {
    requiresReview.push(
      `${selectedEntrants} entrant${selectedEntrants === 1 ? ' is' : 's are'} already selected for the playoffs. `
      + 'Changing a group result can change who qualifies, so the selection needs checking.',
    )
  }
  if (draftPlayoffMatches > 0) {
    requiresReview.push(
      `A private playoff bracket draft of ${draftPlayoffMatches} match${draftPlayoffMatches === 1 ? '' : 'es'} exists. `
      + 'It is kept as it is — seeds drawn from the old standings may no longer be right.',
    )
  }
  if (publishedPlayoffMatches > 0) {
    requiresReview.push(
      `${publishedPlayoffMatches} playoff match${publishedPlayoffMatches === 1 ? ' has' : 'es have'} already been published. `
      + 'Those are public results and are not touched here.',
    )
  }
  if (decided > 0) {
    requiresReview.push(
      `${decided} playoff match${decided === 1 ? ' has' : 'es have'} a recorded winner. Reopening the groups does not undo them.`,
    )
  }

  return { draftPlayoffMatches, publishedPlayoffMatches, selectedEntrants, requiresReview }
}
