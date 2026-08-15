/**
 * SINGLE source of truth for who may see playoff-bracket data, and for stripping it from a public
 * response. Reused by the tournament page (and any other consumer) so there is exactly one rule.
 *
 *  - Staff (Admin/Owner — `manage_competitions`) may always see the bracket, including an unpublished
 *    draft, through the authorized admin workspace (labeled "Unpublished").
 *  - Everyone else (regular members, logged-out visitors) may see the bracket ONLY after it is
 *    published (Tournament.playoffsStatus = 'PUBLISHED' / PlayoffMatch.published = true).
 *
 * The `redactPlayoffs` filter runs SERVER-SIDE before the data reaches a public render, so unpublished
 * seeds/matchups are never sent to the client and then hidden.
 */
import type { TournamentWorkspaceData } from '@/lib/tournaments/live'

export function canViewPlayoffs(opts: { isStaff: boolean; playoffsPublished: boolean }): boolean {
  return opts.isStaff || opts.playoffsPublished
}

/** True once the playoff bracket has been published (persistent DB state). */
export function playoffsArePublished(data: Pick<TournamentWorkspaceData, 'hasPublishedBracket'>): boolean {
  return data.hasPublishedBracket
}

/**
 * Return a copy of the workspace view with EVERY playoff/bracket field emptied when the viewer may not
 * see it. Groups, entrants, and tournament meta are preserved. No-op when `canView` is true.
 */
export function redactPlayoffs(data: TournamentWorkspaceData, canView: boolean): TournamentWorkspaceData {
  if (canView) return data
  return {
    ...data,
    matches: [],
    bracketRounds: [],
    hasBracket: false,
    hasPublishedBracket: false,
    hasResults: false,
    bracketStale: false,
  }
}

/**
 * Strip DRAFT group data from a non-staff response. Until the Admin publishes the groups, members
 * must not see draft assignments — only that registration is closed and groups are being prepared.
 * Published groups pass through untouched.
 */
export function redactDraftGroups(data: TournamentWorkspaceData): TournamentWorkspaceData {
  if (data.groupsPublished) return data
  return { ...data, groups: [], groupSetup: null }
}
