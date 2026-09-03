import { SEASON_QUALIFIERS_PER_GROUP } from './group-stage'

/**
 * How many players advance from each group — asked in one place, because the codebase currently
 * gives three different answers.
 *
 * ── The conflict, stated rather than resolved ───────────────────────────────────────────────────
 * This was investigated because the group board has to draw a playoff cutoff line and decide who is
 * mathematically clinched, and both need an authoritative number. There isn't one:
 *
 *   1. `SEASON_QUALIFIERS_PER_GROUP = 3` in `group-stage.ts`. A module constant, not a column. It is
 *      passed to `computeStandings`, so it is the number that actually writes
 *      `SeasonStanding.qualified` for every Season in the database. This is the only advancement
 *      count that has any effect on stored data today.
 *
 *   2. `Tournament.qualifiersPerGroup` (default 2) — a real, per-competition column, but on the
 *      TOURNAMENT model. `Season` has no equivalent field at all.
 *
 *   3. `enterSeasonPlayoffSetup` puts EVERY eligible entrant into the playoff field and expects
 *      staff to untick the ones who did not play. So the bracket a Season actually produces is a
 *      curated list, not "the top N of each group" — which is deliberate, because it has to be able
 *      to reconstruct archived seasons whose brackets followed no modern rule.
 *
 * The redesign brief's mockup says "TOP 4 ADVANCE". That matches none of the three.
 *
 * ── What this returns, and why ──────────────────────────────────────────────────────────────────
 * (1), because it is the only one of the three that is causally connected to the data: change it and
 * `SeasonStanding.qualified` changes. Drawing the cutoff anywhere else would put a line on the page
 * that disagrees with the `qualified` flag on the very rows it is drawn between.
 *
 * The brief says to report the conflict rather than guess, and that is what this comment is for. If
 * a per-Season advancement count is wanted, the change is a `qualifiersPerGroup` column on `Season`
 * mirroring the Tournament one, defaulted from this constant, and read here — every caller already
 * goes through this function, so nothing else would need to change.
 */
export interface AdvancementConfig {
  /** Players advancing from each group. */
  perGroup: number
  /** Where the number came from, so a reader can tell configuration from fallback. */
  source: 'season-constant'
}

export function seasonAdvancement(): AdvancementConfig {
  return { perGroup: SEASON_QUALIFIERS_PER_GROUP, source: 'season-constant' }
}

/**
 * The advancing count for one group, never larger than the group itself.
 *
 * A group of two in an archived Season would otherwise be told that its top three advance, and the
 * cutoff line would be drawn past the end of the table.
 */
export function advancingInGroup(groupSize: number): number {
  return Math.max(0, Math.min(groupSize, seasonAdvancement().perGroup))
}
