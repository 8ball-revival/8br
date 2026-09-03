import 'server-only'

import { getExplorer, type ExplorerRow } from '@/lib/stats/ladder-explorer'
import { aggregateFilters, decodeRankingsState, type RankingsState } from '@/lib/stats/rankings-columns'
import { getYahooYearBounds } from '@/lib/yahoo/archive'
import { YAHOO_PARAM_PREFIX } from '@/lib/yahoo/params'

/**
 * The archive ladder — one definition of it, for every surface that shows it.
 *
 * ── Why this was extracted ──────────────────────────────────────────────────────────────────────
 * The Yahoo ranking is not one call; it is four decisions made together. Which years the archive
 * spans, which prefix its URL parameters carry, that its state profile is `archive` rather than the
 * CueVerse default, and that its rows come from the all-time overall view of the YAHOO platform.
 * Get any one of them wrong and you get a ladder that is plausible and different — a top five whose
 * order almost matches the page it claims to summarise.
 *
 * The homepage's Yahoo Archives tile shows the top five of exactly this ladder. Writing those four
 * decisions out a second time there is how the two would eventually disagree, and it would disagree
 * silently: both lists would look like rankings. So the decisions live here and `/yahoo` reads them
 * from the same place the tile does.
 *
 * ── What is deliberately NOT here ───────────────────────────────────────────────────────────────
 * No rating, record, eligibility or ordering rule of its own. `getExplorer` computes the ladder and
 * assigns the official ranks; this module only says WHICH ladder. A second calculation is the thing
 * it exists to prevent.
 */

/**
 * The archive's rankings state, decoded from a URL.
 *
 * The year bounds matter more than they look. Without them the state defaults its upper bound to the
 * current year, so a plain load applies 2005–2026 — a range seventeen years past the last match in
 * the archive — and `aggregateFilters` then treats it as a NARROWED period rather than the whole
 * thing. A narrowed period is replayed from the standard initial rating, so every rating on the page
 * would be computed from a different starting point than the one the archive actually ranks on.
 */
export async function decodeYahooRankingsState(
  params: URLSearchParams,
  now: Date = new Date(),
): Promise<RankingsState> {
  const years = await getYahooYearBounds()
  return decodeRankingsState(params, now, YAHOO_PARAM_PREFIX, {
    profile: 'archive',
    years: { min: years.min ?? undefined, max: years.max ?? undefined },
  })
}

/** The archive ladder for a decoded state — all-time, overall, YAHOO. */
export async function getYahooLadder(state: RankingsState, now: Date = new Date()): Promise<ExplorerRow[]> {
  return getExplorer('all-time', 'overall', { ...aggregateFilters(state, now), platform: 'YAHOO' })
}

/**
 * The top of the archive ladder as a reader with no filters applied would see it.
 *
 * `decodeYahooRankingsState(new URLSearchParams())` rather than a hand-built default: an empty query
 * string is precisely what a first visit to /yahoo carries, so this is the same code path that page
 * takes, with the same defaults, rather than an assumption about what those defaults are.
 *
 * The rows keep their own `rank`, which is the ladder's official standing and not their position in
 * this slice — so a tie shown on /yahoo is shown here as the same tie.
 */
export async function getYahooTopPlayers(limit = 5, now: Date = new Date()): Promise<ExplorerRow[]> {
  const state = await decodeYahooRankingsState(new URLSearchParams(), now)
  const rows = await getYahooLadder(state, now)
  return rows.slice(0, Math.max(0, limit))
}
