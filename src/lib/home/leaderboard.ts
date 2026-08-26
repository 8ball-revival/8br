import 'server-only'

import { getExplorer, type ExplorerRow } from '@/lib/stats/ladder-explorer'
import type { CompetitionPlatform } from '@prisma/client'

/**
 * The homepage Top 10.
 *
 * ── It reads the exact service the Rankings page reads ───────────────────────────────────────────
 * `getExplorer('all-time', 'overall', …)` is what /rankings is built from, so the homepage table is
 * literally the first ten rows of the Rankings table. That is not a stylistic preference — it is the
 * only way the two cannot disagree.
 *
 * The first version of this called `getLadder` instead, which looked equivalent and was not: the two
 * services define win percentage differently. `getLadder` computes wins/(wins+losses), excluding
 * draws; the explorer computes wins/played, including them. For the top-ranked player that is 86.7%
 * against 83.2% — the same person, two numbers, on two pages that link to each other. Reading one
 * service removes the question.
 *
 * (The underlying divergence between those two definitions is real and still there. It is a wider
 * problem than the homepage and is deliberately not being "fixed" from here, because quietly
 * changing what `getLadder` reports would move figures on the profile pages and the rankings rail
 * as a side effect of a homepage rebuild.)
 *
 * ── Trend ────────────────────────────────────────────────────────────────────────────────────────
 * Nothing records where a player stood last month, so rank movement cannot be computed and is not
 * claimed. `currentStreak` is a real, measured run of consecutive results, so that is what the last
 * column shows, and it is headed Form rather than Trend.
 */

export interface LeaderRow {
  rank: number
  playerId: string
  cueverseId: string | null
  preferredName: string
  slug: string | null
  wins: number
  losses: number
  /** 0–100. Computed by the explorer over played matches, draws included. */
  winPct: number
  rating: number
  /** Signed run of results. Positive is unbeaten, negative a losing run, 0 neither. */
  streak: number
  titles: number
}

const shape = (r: ExplorerRow): LeaderRow => ({
  rank: r.rank,
  playerId: r.playerId,
  cueverseId: r.cueverseId,
  preferredName: r.preferredName,
  slug: r.slug,
  wins: r.wins,
  losses: r.losses,
  winPct: r.matchWinPct,
  rating: r.rating,
  streak: r.currentStreak,
  titles: r.seasonTitles + r.tournamentTitles,
})

/**
 * The ladder to show, and which one it turned out to be.
 *
 * Returned together from one pass, because the panel has to label which archive it is displaying and
 * asking twice would mean two chances to disagree about the answer.
 *
 * The homepage should never show an empty leaderboard: a site whose live platform has no ranked
 * matches yet still has an archive worth leading with, so an empty CueVerse ladder falls back to
 * Yahoo rather than to an empty state — and the panel says which it is.
 */
export async function getHomeLeaderboard(limit = 10): Promise<{
  rows: LeaderRow[]
  platform: CompetitionPlatform
}> {
  const cueverse = await getExplorer('all-time', 'overall', { platform: 'CUEVERSE' })
  if (cueverse.length > 0) {
    return { rows: cueverse.slice(0, limit).map(shape), platform: 'CUEVERSE' }
  }
  const yahoo = await getExplorer('all-time', 'overall', { platform: 'YAHOO' })
  return { rows: yahoo.slice(0, limit).map(shape), platform: 'YAHOO' }
}
