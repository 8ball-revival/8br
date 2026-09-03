import { SEASON_QUALIFIERS_PER_GROUP } from './group-stage'

/**
 * How many players advance from each group.
 *
 * ── The conflict, now resolved ──────────────────────────────────────────────────────────────────
 * This used to return a module constant, and documented that the codebase gave three different
 * answers. It now reads `Season.qualifiersPerGroup`, a real per-season column, because the count is
 * a fact about the season that was played rather than a property of the software.
 *
 * That distinction turned out to matter. All 50 seasons in the database — the Yahoo archive runs
 * back to 2005 — shared the one constant, so moving the live competition to a top-four cutoff by
 * editing it would have redrawn the gold line on 49 COMPLETED seasons and rewritten their
 * `SeasonStanding.qualified` flags on the next recompute. Existing seasons were backfilled with the
 * 3 they played; new ones default to 4.
 *
 * What has NOT changed: `enterSeasonPlayoffSetup` still puts every eligible entrant into the
 * playoff field for staff to curate, so the bracket a Season produces is still a curated list
 * rather than "the top N of each group" — which is deliberate, because it has to reconstruct
 * archived seasons whose brackets followed no modern rule. This number decides the cutoff line, the
 * clinch target and the `qualified` flag; it does not decide the bracket.
 */
export interface AdvancementConfig {
  /** Players advancing from each group. */
  perGroup: number
  /** Where the number came from, so a reader can tell configuration from fallback. */
  source: 'season-column'
}

/**
 * @param perGroup `Season.qualifiersPerGroup`. Falls back to the legacy constant only when a caller
 *   genuinely has no season to hand, which no current caller does.
 */
export function seasonAdvancement(perGroup?: number | null): AdvancementConfig {
  return { perGroup: perGroup ?? SEASON_QUALIFIERS_PER_GROUP, source: 'season-column' }
}

/**
 * The advancing count for one group, never larger than the group itself.
 *
 * A group of two in an archived Season would otherwise be told that its top three advance, and the
 * cutoff line would be drawn past the end of the table.
 */
export function advancingInGroup(groupSize: number, perGroup?: number | null): number {
  return Math.max(0, Math.min(groupSize, seasonAdvancement(perGroup).perGroup))
}
