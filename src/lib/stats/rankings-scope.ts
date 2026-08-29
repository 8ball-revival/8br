import type { EventType } from './rankings-columns'

/**
 * The four scopes of the CURRENT rankings.
 *
 * ── Current means CueVerse, always ───────────────────────────────────────────────────────────────
 * Every scope below is CueVerse, and none of them can be widened by a query parameter. The Yahoo era
 * is a separate ladder with its own replay and its own page at /yahoo; a combined figure would
 * describe a career nobody had, and mixing 2008 results into a 2026 ladder would misrepresent both.
 * There is deliberately no Yahoo scope here and no fallback to one -- a page that quietly showed the
 * archive when the current ladder was empty is exactly what this replaces.
 *
 * ── Why the scopes are filters and not new formulas ──────────────────────────────────────────────
 * A scope narrows WHICH RESULTS are counted; the records, the population and the ordering are
 * recomputed from that narrowed set. It does not define a new rating: see the note on the Rating
 * column in `computeExplorer`, which is deliberately read from the player's whole running history
 * rather than restarted at the edge of a filter.
 *
 * This module is pure and client-safe on purpose. The tab strip needs the labels and the empty-state
 * copy, and the server needs the same list to validate `?scope=`; two copies would drift.
 */
export const RANKING_SCOPES = ['all', '8brcam', 'wcc', 'tournaments'] as const
export type RankingScope = (typeof RANKING_SCOPES)[number]

export const DEFAULT_SCOPE: RankingScope = 'all'

/** Anything unrecognised is the default rather than an error: a bad link should still open a page. */
export function parseScope(raw: string | null | undefined): RankingScope {
  const v = (raw ?? '').trim().toLowerCase()
  return (RANKING_SCOPES as readonly string[]).includes(v) ? (v as RankingScope) : DEFAULT_SCOPE
}

export interface ScopeDefinition {
  key: RankingScope
  label: string
  /** One line under the tab strip, describing what this ladder is counting. */
  blurb: string
  /**
   * Shown INSTEAD of a table when the scope has no rated results.
   *
   * Written per scope rather than shared, because "nothing here yet" is not the same statement in
   * each: one is waiting on a season being finalised, one on a competition that has not begun. A
   * single generic line would tell a reader the page was broken.
   */
  emptyTitle: string
  emptyBody: string
}

export const SCOPE_DEFINITIONS: Record<RankingScope, ScopeDefinition> = {
  all: {
    key: 'all',
    label: 'All',
    blurb: 'Every eligible current CueVerse result — 8BRCAM, WCC and tournaments together.',
    emptyTitle: 'No current rankings yet',
    emptyBody: 'Current CueVerse rankings will appear after the first eligible competition is finalized.',
  },
  '8brcam': {
    key: '8brcam',
    label: '8BRCAM',
    blurb: 'Current CueVerse 8BRCAM seasons only. The Yahoo era of 8BRCAM is in the archive.',
    emptyTitle: 'No 8BRCAM rankings yet',
    emptyBody: 'Rankings will appear once CueVerse 8BRCAM Season 1 is verified and formally finalized in the Registry.',
  },
  wcc: {
    key: 'wcc',
    label: 'WCC',
    blurb: 'World Cue Championships seasons only.',
    emptyTitle: 'WCC has not started yet',
    emptyBody: 'WCC Season 1 is starting soon. Rankings will appear after its first completed season.',
  },
  tournaments: {
    key: 'tournaments',
    label: 'Tournaments',
    blurb: 'Every eligible tournament under one ladder — individual, team, 2v2 and every format alike.',
    emptyTitle: 'No tournament rankings yet',
    emptyBody: 'Tournament rankings will appear after the first eligible tournament is finalized.',
  },
}

/** Competition-series slugs the season-based scopes are pinned to. Resolved to ids on the server. */
export const SCOPE_SERIES_SLUG: Partial<Record<RankingScope, string>> = { '8brcam': '8brcam', wcc: 'wcc' }

export interface ScopeOverlay {
  platform: 'CUEVERSE'
  eventType?: EventType
  competitionSeriesId?: number
}

/**
 * What a scope forces on top of whatever else the reader has filtered.
 *
 * `seriesId` is passed in rather than looked up here so this stays usable on both sides of the
 * network. `null` for a scope that needs one means the series does not exist in this database, and
 * the overlay pins `-1` -- an id nothing matches -- so the scope comes back EMPTY rather than
 * silently unfiltered. An unfiltered WCC tab would show every player on the site under a heading
 * saying they had played in the WCC.
 */
export function scopeOverlay(scope: RankingScope, seriesId: number | null): ScopeOverlay {
  /*
   * All pins the platform and NOTHING else. It is the unnarrowed current ladder, so the reader's own
   * competition and event-type filters have to survive it; overwriting them with "all" here would
   * make every filter in the drawer silently revert on the way to the query.
   */
  if (scope === 'all') return { platform: 'CUEVERSE' }
  if (scope === 'tournaments') return { platform: 'CUEVERSE', eventType: 'cups' }
  return { platform: 'CUEVERSE', eventType: 'seasons', competitionSeriesId: seriesId ?? -1 }
}

/** Whether this scope already decides the competition and event-type filters for the reader. */
export function scopePinsCompetition(scope: RankingScope): boolean {
  return scope !== 'all'
}
