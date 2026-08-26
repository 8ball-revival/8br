import type { CompetitionPlatform } from '@prisma/client'
import type { ExplorerRow, RecordView } from './ladder-explorer'
import { UNASSIGNED_DIVISION } from './rankings-facts'

/**
 * Columns, density, sorting, row filtering and URL state for the Rankings table.
 *
 * Pure, and free of `server-only` and Prisma, because the table is interactive and this module is
 * imported by a client component. Keeping the rules here rather than inside the component is what
 * makes the sort cycle, the presets, the filters and the whole query-string round trip testable
 * without rendering anything.
 */

export { UNASSIGNED_DIVISION }


export type ColumnGroup =
  | 'identity' | 'match' | 'game' | 'rating' | 'highest' | 'titles' | 'group' | 'activity'

export const COLUMN_GROUPS: { id: ColumnGroup; label: string }[] = [
  { id: 'identity', label: 'Player' },
  { id: 'match', label: 'Match record' },
  { id: 'game', label: 'Game record' },
  { id: 'rating', label: 'Rating' },
  { id: 'highest', label: 'Highest achieved' },
  { id: 'titles', label: 'Honours' },
  { id: 'group', label: 'Group play' },
  { id: 'activity', label: 'Activity' },
]

export interface ColumnDef {
  key: string
  /** Full header text, used in the column picker, the CSV and the accessible name. */
  label: string
  /** Abbreviated header shown in the table when the full label would crowd the row. */
  short?: string
  group: ColumnGroup
  align: 'left' | 'right'
  /** Explains the column, including how it is derived. Reachable by keyboard, never hover-only. */
  tooltip: string
  /** Value for sorting and export. Null means "not applicable", which always sorts last. */
  value: (r: ExplorerRow) => number | string | null
  /** Rendered text. Defaults to the value. */
  format?: (r: ExplorerRow) => string
  /** Views where the column carries meaning. Omitted means every view. */
  views?: RecordView[]
  /** Rank and Player are frozen: always shown, always first, never hidden. */
  locked?: boolean
}

const pctText = (n: number) => `${n.toFixed(1)}%`
const signed = (n: number) => (n > 0 ? `+${n}` : String(n))
const dash = (n: number | null) => (n == null || n === 0 ? '—' : String(n))
/**
 * A record in one cell.
 *
 * Every number always, including zeros: a column that drops the draw when there is none reads as
 * two different columns down the page, and a reader scanning for draws cannot tell "none" from
 * "not shown".
 *
 * The divider matches the header's, so "W–L–D" sits directly above "15–2–0" and needs no explaining.
 */
const record3 = (w: number, l: number, d: number) => `${w}–${l}–${d}`
const record2 = (w: number, l: number) => `${w}–${l}`

export const COLUMNS: ColumnDef[] = [
  {
    key: 'rank', label: 'Rank', group: 'identity', align: 'right', locked: true,
    tooltip: 'Official standing for the selected scope and record view. Sorting the table by another column never changes it.',
    value: (r) => r.rank,
  },
  {
    key: 'player', label: 'Player', group: 'identity', align: 'left', locked: true,
    tooltip: 'Preferred name over CueVerse ID. Both belong to one canonical player account, so changing a CueVerse ID updates every season, Tournament and match that player appears in.',
    value: (r) => r.preferredName || r.cueverseId || '',
  },
  {
    key: 'rating', label: 'Rating', group: 'rating', align: 'right',
    tooltip: 'Elo rating after the most recent match in scope. The same figure in every record view — a rating is a rating, not "your rating counting only playoff matches".',
    value: (r) => r.rating,
  },
  {
    key: 'record', label: 'Overall Record', short: 'W–L–D', group: 'match', align: 'right',
    tooltip: 'W–L–D — every eligible match from completed, archived Seasons and Tournaments: wins, losses and draws. A draw is possible in group play and never in a knockout. Sorts by wins.',
    value: (r) => r.wins,
    format: (r) => record3(r.wins, r.losses, r.draws),
  },
  {
    key: 'matchWinPct', label: 'Win %', group: 'match', align: 'right',
    tooltip: 'Matches won as a share of matches with a recorded result.',
    value: (r) => r.matchWinPct,
    format: (r) => pctText(r.matchWinPct),
  },
  {
    key: 'currentStreak', label: 'Current Streak', short: 'Streak', group: 'rating', align: 'right',
    tooltip: 'Current unbroken run, signed: +3 is three consecutive wins, −2 two consecutive losses. A tie neither extends nor breaks a run — it is skipped over. A run of three or more is marked: green with a flame for wins, red with a snowflake for losses.',
    value: (r) => r.currentStreak,
    format: (r) => (r.currentStreak === 0 ? '—' : signed(r.currentStreak)),
  },
  {
    key: 'seasonsPlayed', label: 'Seasons Played', short: 'Seasons Played', group: 'match', align: 'right',
    tooltip: 'How many Seasons this player took part in. Counts each Season once — a divisional pair is one Season, not two — and does not count a Season they withdrew from before it started.',
    value: (r) => r.seasonsPlayed,
    format: (r) => dash(r.seasonsPlayed),
  },
  {
    key: 'groupRecord', label: 'Group Record', short: 'Groups W–L–D', group: 'match', align: 'right',
    /*
     * GROUP PLAY ONLY.
     *
     * It used to add the playoff record in as well, which made it the sum of itself and the column
     * immediately to its right — two figures side by side where one contained the other, and no
     * way to read a player's group form on its own. Playoffs have their own column; this one is the
     * group stage.
     */
    tooltip: 'Group-stage matches inside a completed, archived Season. Playoffs are counted separately in the next column. Sorts by wins.',
    value: (r) => r.groupWins,
    format: (r) => record3(r.groupWins, r.groupLosses, r.groupDraws),
  },
  {
    key: 'playoffRecord', label: 'Playoffs Record', short: 'Playoffs W–L', group: 'match', align: 'right',
    tooltip: 'Playoff matches inside completed, archived Seasons only — a subset of the Season record. A knockout cannot be drawn, so there is no draw column. Sorts by wins.',
    value: (r) => r.playoffWins,
    format: (r) => record2(r.playoffWins, r.playoffLosses),
  },
  {
    key: 'cupRecord', label: 'Tournament Record', short: 'Tournament W–L', group: 'match', align: 'right',
    tooltip: 'Eligible matches from completed, archived Tournaments only. Draws are counted where a Tournament format genuinely allows one and are shown as a third number when any exist. Sorts by wins.',
    value: (r) => r.tournamentWins,
    // A Tournament draw is possible in a group or round-robin format. The third number appears only
    // when there IS one, rather than a permanent "–0" that says nothing about most Tournaments.
    format: (r) => (r.tournamentDraws > 0
      ? record3(r.tournamentWins, r.tournamentLosses, r.tournamentDraws)
      : record2(r.tournamentWins, r.tournamentLosses)),
  },
  {
    key: 'seasonTitles', label: 'Season Championships', short: 'Season Championships', group: 'titles', align: 'right',
    tooltip: 'Season Championships — Seasons this player won, from the champion recorded on each completed, archived Season. Click a count to see which ones.',
    value: (r) => r.seasonTitles,
    format: (r) => dash(r.seasonTitles),
  },
  {
    key: 'tournamentTitles', label: 'Tournament Titles', short: 'Tournament Titles', group: 'titles', align: 'right',
    tooltip: 'Tournament Titles — Tournaments this player won, from the titleholder recorded on each completed, archived Tournament. Click a count to see which ones.',
    value: (r) => r.tournamentTitles,
    format: (r) => dash(r.tournamentTitles),
  },
  {
    key: 'played', label: 'Matches Played', short: 'MP', group: 'match', align: 'right',
    tooltip: 'Matches Played — matches with a recorded result. Forfeits count as matches played.',
    value: (r) => r.played,
  },
  {
    key: 'finalsAppearances', label: 'Finals Reached', short: 'Finals', group: 'titles', align: 'right',
    tooltip: 'Competitions where the player reached the final, counted from the round label stored on each match. Click to see which ones.',
    value: (r) => r.finalsAppearances,
    format: (r) => dash(r.finalsAppearances),
  },
  {
    key: 'runnerUps', label: 'Runner-up Finishes', short: 'R/U', group: 'titles', align: 'right',
    tooltip: 'Losing finalist finishes, from the runner-up recorded on each completed Season.',
    value: (r) => r.runnerUps,
    format: (r) => dash(r.runnerUps),
  },
  {
    key: 'semifinalAppearances', label: 'Semifinals Reached', short: 'Semis', group: 'titles', align: 'right',
    tooltip: 'Competitions where the player reached a semifinal.',
    value: (r) => r.semifinalAppearances,
    format: (r) => dash(r.semifinalAppearances),
  },
  {
    key: 'playoffAppearances', label: 'Playoffs Reached', short: 'Playoffs', group: 'titles', align: 'right',
    tooltip: 'Competitions where the player played at least one playoff match.',
    value: (r) => r.playoffAppearances,
    format: (r) => dash(r.playoffAppearances),
  },
  {
    key: 'games', label: 'Games Won – Games Lost', short: 'GW–GL', group: 'game', align: 'right',
    tooltip: 'Games Won – Games Lost, counting individual frames rather than matches. Forfeits contribute no games because none were played, and some archived seasons record the match result without the frames — see the completeness marker on the row.',
    value: (r) => r.gamesWon,
    // Games have no draw — a frame is won or it is not — so this pair stays two numbers.
    format: (r) => record2(r.gamesWon, r.gamesLost),
  },
  {
    key: 'gameDiff', label: 'Game Differential', short: 'Diff', group: 'game', align: 'right',
    tooltip: 'Game Differential — games won minus games lost. Only as complete as the frame-level data behind it.',
    value: (r) => r.gameDiff,
    format: (r) => signed(r.gameDiff),
  },
  {
    key: 'gameWinPct', label: 'Game Win %', short: 'Game %', group: 'game', align: 'right',
    tooltip: 'Games won as a share of games played.',
    value: (r) => r.gameWinPct,
    format: (r) => pctText(r.gameWinPct),
  },
  {
    key: 'peakRating', label: 'Peak Rating', short: 'Peak', group: 'highest', align: 'right',
    tooltip: 'Highest rating actually reached within the selected scope, read from the rating ledger. A real measurement, not a reconstruction of where someone once stood.',
    value: (r) => r.peakRating,
  },
  {
    key: 'longestStreak', label: 'Longest Winning Run', short: 'Best run', group: 'highest', align: 'right',
    tooltip: 'Longest unbroken run of wins within the selected scope.',
    value: (r) => r.longestStreak,
    format: (r) => (r.longestStreak === 0 ? '—' : `W${r.longestStreak}`),
  },
  {
    key: 'groupPoints', label: 'Group Points', short: 'Pts', group: 'group', align: 'right',
    views: ['overall', 'group'],
    tooltip: 'Group Points — the sum of the standings points this player was awarded across every group stage they entered, read from the stored standings rather than recalculated. Group scoring is 3 points for a win, 1 for a draw, 0 for a loss. Hidden in the Playoffs and Tournaments views, where no standings points exist.',
    value: (r) => r.groupPoints,
    format: (r) => (r.groupPoints == null ? '—' : String(r.groupPoints)),
  },
  {
    key: 'groupsEntered', label: 'Group Stages Entered', short: 'Groups', group: 'group', align: 'right',
    views: ['overall', 'group'],
    tooltip: 'Group stages entered.',
    value: (r) => r.groupsEntered,
    format: (r) => (r.groupsEntered == null ? '—' : String(r.groupsEntered)),
  },
  {
    key: 'groupFirstPlaces', label: 'Group Stages Won', short: '1st', group: 'group', align: 'right',
    views: ['overall', 'group'],
    tooltip: 'Group stages finished in first place.',
    value: (r) => r.groupFirstPlaces,
    format: (r) => (r.groupFirstPlaces == null ? '—' : String(r.groupFirstPlaces)),
  },
  {
    key: 'perfectGroupStages', label: 'Perfect Group Stages', short: 'Perfect', group: 'group', align: 'right',
    views: ['overall', 'group'],
    tooltip: 'Group stages completed without losing a match.',
    value: (r) => r.perfectGroupStages,
    format: (r) => (r.perfectGroupStages == null ? '—' : String(r.perfectGroupStages)),
  },
  {
    key: 'qualificationPct', label: 'Qualification %', short: 'Qual %', group: 'group', align: 'right',
    views: ['overall', 'group'],
    tooltip: 'Share of Seasons entered where the player qualified for the playoffs.',
    value: (r) => r.qualificationPct,
    format: (r) => (r.qualificationPct == null ? '—' : pctText(r.qualificationPct)),
  },
  {
    key: 'competitionsEntered', label: 'Competitions', short: 'Comps', group: 'activity', align: 'right',
    tooltip: 'Distinct Seasons and Tournaments with at least one recorded match in scope.',
    value: (r) => r.competitionsEntered,
  },
  {
    key: 'forfeits', label: 'Forfeits', short: 'FF', group: 'activity', align: 'right',
    tooltip: 'Matches decided by forfeit. They count as matches played and are excluded from game totals and from the rating, because no frames were contested.',
    value: (r) => r.forfeits,
    format: (r) => dash(r.forfeits),
  },
  {
    key: 'idleDays', label: 'Last Played', short: 'Last seen', group: 'activity', align: 'right',
    tooltip: 'Days since the most recent recorded match.',
    value: (r) => r.idleDays,
    format: (r) => (r.idleDays == null ? '—' : r.idleDays === 0 ? 'today' : `${r.idleDays}d`),
  },
]

export const COLUMN_BY_KEY: Record<string, ColumnDef> =
  Object.fromEntries(COLUMNS.map((c) => [c.key, c]))

/** Columns that carry meaning in a given record view. */
export function columnsForView(view: RecordView): ColumnDef[] {
  return COLUMNS.filter((c) => !c.views || c.views.includes(view))
}

/**
 * Columns that have been renamed.
 *
 * A shared link or a saved device preference may still name the old key. Mapping it costs one line
 * and keeps somebody's bookmark working; dropping it loses a column they deliberately chose.
 */
export const LEGACY_COLUMN_KEYS: Record<string, string> = {
  titles: 'seasonTitles',
  draws: 'record',
  // Renamed when it stopped double-counting the playoffs: it was never a whole-Season record.
  seasonRecord: 'groupRecord',
}

// --------------------------------------------------------------------------- sorting

export type SortDirection = 'asc' | 'desc'
export interface SortSpec { key: string; dir: SortDirection }

/**
 * Advance one column through desc → asc → off.
 *
 * `additive` (Shift-click) appends the column as a secondary key instead of replacing the sort, so
 * a reader can order by titles and break ties by rating. A column cycling off is removed entirely
 * rather than left at a neutral direction, so the third click genuinely restores official order.
 */
export function cycleSort(current: SortSpec[], key: string, additive: boolean): SortSpec[] {
  const existing = current.find((s) => s.key === key)
  if (!existing) {
    const next: SortSpec = { key, dir: 'desc' }
    return additive ? [...current, next] : [next]
  }
  if (existing.dir === 'desc') {
    const flipped = current.map((s) => (s.key === key ? { ...s, dir: 'asc' as const } : s))
    return additive ? flipped : flipped.filter((s) => s.key === key)
  }
  const without = current.filter((s) => s.key !== key)
  return additive ? without : []
}

/**
 * ── Tie-breaking, stated once ────────────────────────────────────────────────────────────────────
 *
 * OFFICIAL RANK (assigned in the aggregate, never here): rating, then match wins, then the player's
 * public label. The label is a stable identifier rather than a quality judgement — it exists so two
 * players who are genuinely level are ordered the same way on every request instead of arriving in
 * whatever order the database happened to return.
 *
 * DISPLAY SORT (this function): the selected columns in order, then official rank ascending as the
 * final comparator. Because official rank is itself total, the display sort is total too: two rows
 * that tie on every selected column never swap between renders.
 *
 * Database row order is never a tie-breaker at either level.
 */
export function sortRows(
  rows: ExplorerRow[],
  sort: SortSpec[],
): ExplorerRow[] {
  const out = [...rows]
  if (sort.length === 0) return out.sort((a, b) => a.rank - b.rank)

  out.sort((a, b) => {
    for (const { key, dir } of sort) {
      const col = COLUMN_BY_KEY[key]
      if (!col) continue
      const av = col.value(a)
      const bv = col.value(b)

      // Null is "not applicable" and always sorts last, whichever direction is active — a blank
      // cell rising to the top on an ascending sort would read as a zero.
      if (av == null && bv == null) continue
      if (av == null) return 1
      if (bv == null) return -1

      const cmp = (typeof av === 'string' || typeof bv === 'string')
        ? String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' })
        : av - bv
      if (cmp !== 0) return dir === 'asc' ? cmp : -cmp
    }
    return a.rank - b.rank
  })
  return out
}

// --------------------------------------------------------------------------- row filters

/**
 * Filters that select which players appear without changing any figure.
 *
 * Contrast `ExplorerFilters` in the service, which changes which MATCHES count and therefore has to
 * be applied in the aggregate: narrowing to one Season must recompute every record from that Season
 * alone, or the table would show career figures under a Season heading.
 */
export interface RowFilters {
  search: string
  minMatches: number
  /** Season Championships and Tournament Titles are separate questions, so they are separate filters. */
  seasonChampionsOnly: boolean
  cupChampionsOnly: boolean
  /** 'all' | 'singles' | 'teams' */
  entrantType: 'all' | 'singles' | 'teams'
  activeOnly: boolean
}

export const EMPTY_ROW_FILTERS: RowFilters = {
  search: '',
  minMatches: 0,
  seasonChampionsOnly: false,
  cupChampionsOnly: false,
  entrantType: 'all',
  activeOnly: false,
}

/**
 * Does this query match the player?
 *
 * Matches the preferred name, the current CueVerse ID, and every recorded historical alias — so an
 * old Yahoo handle from 2007 still finds the person who used it, under whatever name they go by
 * now. All three belong to one canonical Player record; none of them is a second account.
 */
export function matchesQuery(row: ExplorerRow, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (row.preferredName.toLowerCase().includes(q)) return true
  if ((row.cueverseId ?? '').toLowerCase().includes(q)) return true
  return row.aliases.some((a) => a.toLowerCase().includes(q))
}

/**
 * ── What the SC / TC control does, now that both counts are columns ──────────────────────────────
 *
 * It no longer chooses which championship column appears — both do, always. It selects which KIND
 * of championship the "Champions only" filter means, and which count the expanded row leads with.
 * That is the part of the question a control can still usefully answer.
 */

/**
 * Does this row meet the qualification threshold?
 *
 * Separate from filtering because the two are different questions. A player below the threshold is
 * not disqualified from having a record — they are excluded from being RANKED against it, which is
 * why the table can show them marked rather than hide them.
 */
export function isQualified(row: ExplorerRow, minMatches: number): boolean {
  return row.played >= minMatches
}

export function filterRows(
  rows: ExplorerRow[],
  f: RowFilters,
): ExplorerRow[] {
  return rows.filter((r) => {
    if (!matchesQuery(r, f.search)) return false
    if (!isQualified(r, f.minMatches)) return false
    // Both boxes checked means BOTH, stated in the drawer's helper text. An OR here would quietly
    // widen the result the moment somebody ticked a second box expecting it to narrow.
    if (f.seasonChampionsOnly && r.seasonTitles === 0) return false
    if (f.cupChampionsOnly && r.tournamentTitles === 0) return false
    if (f.entrantType === 'singles' && r.isTeamPlayer) return false
    if (f.entrantType === 'teams' && !r.isTeamPlayer) return false
    if (f.activeOnly && !r.active) return false
    return true
  })
}

export function hasActiveRowFilters(f: RowFilters): boolean {
  return f.search.trim() !== ''
    || f.minMatches > 0
    || f.seasonChampionsOnly
    || f.cupChampionsOnly
    || f.entrantType !== 'all'
    || f.activeOnly
}

// --------------------------------------------------------------------------- URL state

/**
 * The earliest competition year the archive holds. Nothing before this exists to rank.
 */
export const MIN_YEAR = 2005

/**
 * The latest year a filter may reach.
 *
 * Read from the clock rather than written down, so the range keeps working next January without
 * anybody remembering to edit it. A hard-coded upper bound is a bug with a delayed fuse.
 */
export function maxYear(now: Date = new Date()): number {
  return now.getFullYear()
}

export type EventType = 'all' | 'seasons' | 'cups'

/**
 * Everything a reader can change about the table.
 *
 * Scope and record view are gone: the page is permanently the official ALL-TIME OVERALL rankings,
 * which is the question people actually arrive with. The old Current/All-Time and
 * Overall/Group/Playoffs/Tournaments switches produced four ways to answer a question nobody was asking
 * and pushed the table itself below the fold.
 *
 * Columns are an explicit visible set rather than a density preset. A preset is a promise that some
 * named group of columns belongs together, and it drifted from the truth every time a column was
 * added; a checkbox list cannot drift.
 */
export interface RankingsState {
  sort: SortSpec[]
  /** Optional columns currently shown. Permanent columns are never listed — they cannot be hidden. */
  visibleColumns: string[]
  rowFilters: RowFilters
  competitionSeriesId: number | null
  seasonId: number | null
  tournamentId: number | null
  division: string | null
  eventType: EventType
  /**
   * Which ranking universe is being looked at.
   *
   * Not a filter over one ladder: the two are produced by separate replays that never see each
   * other's matches. There is deliberately no "all platforms" value, because a combined rating would
   * describe a career nobody had.
   */
  platform: CompetitionPlatform
  /** Inclusive competition-year bounds. Defaults span the whole archive. */
  fromYear: number
  toYear: number
  expanded: string | null
}

/**
 * Optional columns, in the order they appear. Rank, Player and Rating are absent on purpose: they
 * are permanent, and a list that could express hiding them would eventually be asked to.
 */
export const OPTIONAL_COLUMN_KEYS = [
  'record', 'matchWinPct', 'currentStreak',
  'seasonsPlayed',
  'groupRecord', 'playoffRecord', 'cupRecord',
  'seasonTitles', 'tournamentTitles',
] as const

/** Always rendered, never offered as a checkbox. */
export const PERMANENT_COLUMN_KEYS = ['rank', 'player', 'rating'] as const

export function defaultState(now: Date = new Date()): RankingsState {
  return {
    sort: [],
    visibleColumns: [...OPTIONAL_COLUMN_KEYS],
    rowFilters: { ...EMPTY_ROW_FILTERS },
    competitionSeriesId: null,
    seasonId: null,
    tournamentId: null,
    division: null,
    eventType: 'all',
    platform: 'CUEVERSE',
    fromYear: MIN_YEAR,
    toYear: maxYear(now),
    expanded: null,
  }
}

/**
 * Optional columns that only mean something on a live ladder.
 *
 * A streak is a statement about form — what this player is doing lately. The Yahoo archive closed in
 * 2014, so every streak in it is frozen at whatever the last recorded match happened to be, and a
 * column of stale "+3"s reads as current when nothing about it is. It is withheld rather than blanked
 * so the table does not carry a column of dashes.
 */
const LIVE_ONLY_COLUMN_KEYS: readonly string[] = ['currentStreak']

/** Whether a column is offered at all under this scope. */
export function columnAppliesTo(key: string, platform: RankingsState['platform']): boolean {
  return !(platform === 'YAHOO' && LIVE_ONLY_COLUMN_KEYS.includes(key))
}

/** The keys actually rendered, permanent columns first and optional ones in canonical order. */
export function visibleColumnKeys(s: RankingsState): string[] {
  const optional = OPTIONAL_COLUMN_KEYS
    .filter((k) => s.visibleColumns.includes(k))
    .filter((k) => columnAppliesTo(k, s.platform))
  return ['rank', 'player', 'rating', ...optional]
}

/**
 * Clamp a year into the archive's range.
 *
 * A pasted 1066 or 3000 is a typo, not a request for an empty table, so it is pulled to the nearest
 * real bound rather than rejected.
 */
export function clampYear(value: unknown, now: Date = new Date()): number | null {
  // Absent is not zero. `Number(null)` and `Number('')` are both 0, which is finite and would clamp
  // to the first archived year — turning "no year given" into "the earliest year", and quietly
  // rewriting the default upper bound to 2005 on every plain page load.
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.min(Math.max(Math.trunc(n), MIN_YEAR), maxYear(now))
}

// --------------------------------------------------------------------------- serialisation

/**
 * Serialise state to a query string.
 *
 * Defaults are omitted, so a plain /rankings link stays clean and the absence of a parameter means
 * exactly what its default value means. Parameters are written in one canonical order so the same
 * view always produces the same URL and two shared links can be compared by eye.
 */
export function encodeRankingsState(s: RankingsState, now: Date = new Date()): string {
  // Platform rides in the URL so a link carries the universe it was read in.
  const p = new URLSearchParams()
  const d = defaultState(now)

  if (s.rowFilters.search.trim()) p.set('q', s.rowFilters.search.trim())
  // The universe rides in the URL, so a shared link opens the ladder it was read in.
  if (s.platform === 'YAHOO') p.set('platform', 'yahoo')
  if (s.fromYear !== d.fromYear) p.set('from', String(s.fromYear))
  if (s.toYear !== d.toYear) p.set('to', String(s.toYear))
  if (s.competitionSeriesId != null) p.set('comp', String(s.competitionSeriesId))
  if (s.eventType !== d.eventType) p.set('event', s.eventType)
  if (s.seasonId != null) p.set('season', String(s.seasonId))
  if (s.tournamentId != null) p.set('cup', String(s.tournamentId))
  if (s.division) p.set('division', s.division)
  if (s.rowFilters.activeOnly) p.set('active', '1')
  if (s.rowFilters.entrantType !== 'all') p.set('type', s.rowFilters.entrantType)
  if (s.rowFilters.seasonChampionsOnly) p.set('sc', '1')
  if (s.rowFilters.cupChampionsOnly) p.set('tc', '1')
  if (s.rowFilters.minMatches > 0) p.set('min', String(s.rowFilters.minMatches))

  // Only written when it differs from "all optional columns", so the common case adds nothing.
  const cols = OPTIONAL_COLUMN_KEYS.filter((k) => s.visibleColumns.includes(k))
  if (cols.length !== OPTIONAL_COLUMN_KEYS.length) p.set('cols', cols.join(','))

  if (s.sort.length) p.set('sort', s.sort.map((x) => `${x.key}:${x.dir}`).join(','))
  if (s.expanded) p.set('expand', s.expanded)

  return p.toString()
}

/**
 * Parameters the redesign removed.
 *
 * Kept as an explicit list so an old bookmark is IGNORED rather than crashing the page, and so the
 * fact that they were deliberately dropped is written down somewhere. Silently tolerating unknown
 * parameters would do the same job but would not say why.
 */
export const OBSOLETE_PARAMS = ['scope', 'view', 'mode', 'density', 'preset', 'pins', 'compare', 'era', 'year'] as const

/**
 * Read state out of a query string.
 *
 * Every value is validated against what actually exists, and anything unrecognised is dropped or
 * clamped rather than carried. A stale link, a truncated paste or a hand-edited parameter must
 * degrade to the default table — a malformed public query string is not a server error.
 */
export function decodeRankingsState(
  input: URLSearchParams | string,
  now: Date = new Date(),
): RankingsState {
  const p = typeof input === 'string' ? new URLSearchParams(input) : input
  const s = defaultState(now)

  s.rowFilters.search = p.get('q') ?? ''
  // Yahoo only when it is asked for by name; anything else, including nonsense, is CueVerse.
  s.platform = p.get('platform')?.toUpperCase() === 'YAHOO' ? 'YAHOO' : 'CUEVERSE'

  const from = clampYear(p.get('from'), now)
  const to = clampYear(p.get('to'), now)
  if (from != null) s.fromYear = from
  if (to != null) s.toYear = to
  // A reversed range is a typo, not a request for zero rows. Reading it the way the reader clearly
  // meant beats rendering an empty table with no explanation.
  if (s.fromYear > s.toYear) { const swap = s.fromYear; s.fromYear = s.toYear; s.toYear = swap }

  const int = (k: string): number | null => {
    const raw = p.get(k)
    if (raw == null || raw.trim() === '') return null
    const v = Number(raw)
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : null
  }
  s.competitionSeriesId = int('comp')
  s.seasonId = int('season')
  s.tournamentId = int('cup')

  const event = p.get('event')
  if (event === 'seasons' || event === 'cups') s.eventType = event

  const division = p.get('division')?.trim()
  if (division && (division === UNASSIGNED_DIVISION || division.length <= 8)) s.division = division

  s.rowFilters.activeOnly = p.get('active') === '1'
  const type = p.get('type')
  if (type === 'singles' || type === 'teams') s.rowFilters.entrantType = type
  s.rowFilters.seasonChampionsOnly = p.get('sc') === '1'
  s.rowFilters.cupChampionsOnly = p.get('tc') === '1'

  const min = Number(p.get('min'))
  s.rowFilters.minMatches = Number.isFinite(min) && min > 0 ? Math.floor(min) : 0

  const cols = p.get('cols')
  if (cols != null) {
    // An empty value is a real choice — every optional column hidden — so it is honoured rather
    // than treated as absent. Renamed keys are mapped, not dropped, or a shared link quietly loses
    // a column somebody chose.
    const asked = cols.split(',').map((k) => k.trim()).filter(Boolean)
      .map((k) => LEGACY_COLUMN_KEYS[k] ?? k)
    s.visibleColumns = OPTIONAL_COLUMN_KEYS.filter((k) => asked.includes(k))
  }

  const sort = p.get('sort')
  if (sort) {
    s.sort = sort.split(',')
      .map((chunk) => {
        const [key, dir] = chunk.split(':')
        return { key: LEGACY_COLUMN_KEYS[key] ?? key, dir: dir === 'asc' ? 'asc' as const : 'desc' as const }
      })
      .filter((x) => !!COLUMN_BY_KEY[x.key])
  }

  s.expanded = p.get('expand')?.trim() || null

  return s
}

/** Whether anything differs from the default table. Drives the chips and the More Filters badge. */
export function activeFilterGroups(s: RankingsState, now: Date = new Date()): string[] {
  const d = defaultState(now)
  const groups: string[] = []
  if (s.fromYear !== d.fromYear || s.toYear !== d.toYear) groups.push('years')
  if (s.competitionSeriesId != null) groups.push('competition')
  if (s.eventType !== d.eventType) groups.push('event')
  if (s.seasonId != null) groups.push('season')
  if (s.tournamentId != null) groups.push('cup')
  if (s.division) groups.push('division')
  if (s.rowFilters.activeOnly) groups.push('status')
  if (s.rowFilters.entrantType !== 'all') groups.push('entry')
  if (s.rowFilters.seasonChampionsOnly || s.rowFilters.cupChampionsOnly) groups.push('achievements')
  if (s.rowFilters.minMatches > 0) groups.push('minMatches')
  // Hiding columns is ONE change however many columns it hides — a badge reading "4" because
  // somebody unchecked four boxes would overstate how filtered the table is.
  if (OPTIONAL_COLUMN_KEYS.some((k) => !s.visibleColumns.includes(k))) groups.push('columns')
  return groups
}

/** The subset of state the server aggregate needs. Everything else is applied to the returned rows. */
export function aggregateFilters(s: RankingsState, now: Date = new Date()) {
  const d = defaultState(now)
  return {
    competitionSeriesId: s.competitionSeriesId,
    seasonId: s.seasonId,
    tournamentId: s.tournamentId,
    division: s.division,
    eventType: s.eventType,
    // Never null: a ranking always belongs to exactly one platform.
    platform: s.platform,
    // Null when the range is the whole archive, so the aggregate can take its unfiltered fast path
    // and the rating snapshot is not needlessly bounded.
    fromYear: s.fromYear === d.fromYear ? null : s.fromYear,
    toYear: s.toYear === d.toYear ? null : s.toYear,
  }
}

// --------------------------------------------------------------------------- saved views

/**
 * Keys for the two things stored on the device rather than on the account: the preferred column
 * layout, and pinned players.
 *
 * Both are personal view preferences, not competition data. Storing them server-side would put a
 * reader's UI choices into records that describe what happened in a pool hall, and this project has
 * no existing per-account preference system to hang them off.
 *
 * URL state always wins over these — a shared link has to reproduce what the sender saw.
 */
export const PREF_KEY = '8br.rankings.prefs'

export interface DevicePrefs {
  /** Optional columns this device last chose to show. */
  columns: string[] | null
}

export function readDevicePrefs(storage: Pick<Storage, 'getItem'> | null | undefined): DevicePrefs | null {
  try {
    const raw = storage?.getItem(PREF_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<DevicePrefs>
    // Renamed keys are migrated rather than dropped, or a device preference quietly loses a column.
    const columns = Array.isArray(parsed.columns)
      ? [...new Set(parsed.columns
          .filter((k): k is string => typeof k === 'string')
          .map((k) => LEGACY_COLUMN_KEYS[k] ?? k))]
        .filter((k) => (OPTIONAL_COLUMN_KEYS as readonly string[]).includes(k))
      : null
    return { columns }
  } catch {
    // A corrupt or foreign value is not worth a broken page.
    return null
  }
}


// --------------------------------------------------------------------------- applied filter chips

export interface FilterChip {
  /** Which filter this chip removes. Also the accessible identity of its remove button. */
  key: string
  label: string
}

/**
 * The applied non-default filters, as removable chips.
 *
 * Default values produce NO chip. A chip that says "Years: 2005–2026" on an unfiltered table is
 * noise pretending to be information, and it would make Clear All look permanently relevant.
 *
 * Names are passed in rather than looked up here, because this module has no database and a chip
 * reading "Competition 4" tells nobody anything.
 */
export function activeChips(
  s: RankingsState,
  names: { competition?: string | null; season?: string | null; cup?: string | null } = {},
  now: Date = new Date(),
): FilterChip[] {
  const d = defaultState(now)
  const chips: FilterChip[] = []

  if (s.fromYear !== d.fromYear || s.toYear !== d.toYear) {
    chips.push({
      key: 'years',
      label: s.fromYear === s.toYear ? `Year: ${s.fromYear}` : `Years: ${s.fromYear}–${s.toYear}`,
    })
  }
  if (s.competitionSeriesId != null) {
    chips.push({ key: 'comp', label: `Competition: ${names.competition ?? s.competitionSeriesId}` })
  }
  if (s.eventType !== d.eventType) {
    chips.push({ key: 'event', label: `Event: ${s.eventType === 'seasons' ? 'Seasons' : 'Tournaments'}` })
  }
  if (s.seasonId != null) chips.push({ key: 'season', label: `Season: ${names.season ?? s.seasonId}` })
  if (s.tournamentId != null) chips.push({ key: 'cup', label: `Tournament: ${names.cup ?? s.tournamentId}` })
  if (s.division) {
    chips.push({ key: 'division', label: `Division: ${s.division === UNASSIGNED_DIVISION ? 'Unassigned' : s.division}` })
  }
  if (s.rowFilters.activeOnly) chips.push({ key: 'active', label: 'Active players' })
  if (s.rowFilters.entrantType !== 'all') {
    chips.push({ key: 'type', label: s.rowFilters.entrantType === 'singles' ? 'Singles' : 'Teams' })
  }
  if (s.rowFilters.seasonChampionsOnly) chips.push({ key: 'sc', label: 'Season Champions' })
  if (s.rowFilters.cupChampionsOnly) chips.push({ key: 'tc', label: 'Tournament Titleholders' })
  if (s.rowFilters.minMatches > 0) {
    chips.push({ key: 'min', label: `Minimum Matches: ${s.rowFilters.minMatches}` })
  }

  // One chip for the whole column choice, however many boxes were unchecked.
  const hidden = OPTIONAL_COLUMN_KEYS.filter((k) => !s.visibleColumns.includes(k)).length
  if (hidden > 0) chips.push({ key: 'cols', label: `Columns: ${hidden} hidden` })

  return chips
}

/**
 * Remove one filter, returning the state it leaves behind.
 *
 * Each chip resets exactly its own group to the default — never the whole table — so removing
 * "Division: B" cannot silently also drop the year range somebody set.
 */
export function removeChip(s: RankingsState, key: string, now: Date = new Date()): RankingsState {
  const d = defaultState(now)
  const next: RankingsState = { ...s, rowFilters: { ...s.rowFilters } }
  switch (key) {
    case 'years': next.fromYear = d.fromYear; next.toYear = d.toYear; break
    // A Season or Tournament belongs to a Competition, so dropping the Competition drops them too rather
    // than leaving a selection that its own filter no longer permits.
    case 'comp': next.competitionSeriesId = null; next.seasonId = null; next.tournamentId = null; break
    case 'event': next.eventType = 'all'; next.seasonId = null; next.tournamentId = null; break
    case 'season': next.seasonId = null; break
    case 'cup': next.tournamentId = null; break
    case 'division': next.division = null; break
    case 'active': next.rowFilters.activeOnly = false; break
    case 'type': next.rowFilters.entrantType = 'all'; break
    case 'sc': next.rowFilters.seasonChampionsOnly = false; break
    case 'tc': next.rowFilters.cupChampionsOnly = false; break
    case 'min': next.rowFilters.minMatches = 0; break
    case 'cols': next.visibleColumns = [...OPTIONAL_COLUMN_KEYS]; break
    default: break
  }
  return next
}

/** Whether anything at all differs from the default table. Drives Clear All. */
export function hasAnyFilter(s: RankingsState, now: Date = new Date()): boolean {
  return activeFilterGroups(s, now).length > 0 || s.rowFilters.search.trim() !== ''
}
