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

export type ChampionshipMode = 'SC' | 'TC'

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
  value: (r: ExplorerRow, mode: ChampionshipMode) => number | string | null
  /** Rendered text. Defaults to the value. */
  format?: (r: ExplorerRow, mode: ChampionshipMode) => string
  /** Views where the column carries meaning. Omitted means every view. */
  views?: RecordView[]
  /** Rank and Player are frozen: always shown, always first, never hidden. */
  locked?: boolean
}

const pctText = (n: number) => `${n.toFixed(1)}%`
const signed = (n: number) => (n > 0 ? `+${n}` : String(n))
const dash = (n: number | null) => (n == null || n === 0 ? '—' : String(n))
/**
 * A full record in one cell: wins, losses, ties.
 *
 * All three numbers, always — including a zero. A column that drops the tie when there is none
 * reads as two different columns down the page, and a reader scanning for draws cannot tell "none"
 * from "not shown".
 *
 * The divider matches the header's, so "Win | Loss | Tie" sits directly above "15 | 2 | 0" and the
 * mapping needs no explaining.
 */
const record = (w: number, l: number, t: number) => `${w} | ${l} | ${t}`

export const COLUMNS: ColumnDef[] = [
  {
    key: 'rank', label: 'Rank', group: 'identity', align: 'right', locked: true,
    tooltip: 'Official standing for the selected scope and record view. Sorting the table by another column never changes it.',
    value: (r) => r.rank,
  },
  {
    key: 'player', label: 'Player', group: 'identity', align: 'left', locked: true,
    tooltip: 'Preferred name over CueVerse ID. Both belong to one canonical player account, so changing a CueVerse ID updates every season, tournament and match that player appears in.',
    value: (r) => r.preferredName || r.cueverseId || '',
  },
  {
    key: 'rating', label: 'Rating', group: 'rating', align: 'right',
    tooltip: 'Elo rating after the most recent match in scope. The same figure in every record view — a rating is a rating, not "your rating counting only playoff matches".',
    value: (r) => r.rating,
  },
  {
    key: 'played', label: 'Matches Played', short: 'MP', group: 'match', align: 'right',
    tooltip: 'Matches Played — matches with a recorded result. Forfeits count as matches played.',
    value: (r) => r.played,
  },
  {
    // Spelled out: there is room for it, and three initials over three numbers is a puzzle the
    // reader has to solve every time they look at the column.
    key: 'record', label: 'Match Record', short: 'Win | Loss | Tie', group: 'match', align: 'right',
    tooltip: 'Match Record — matches won, lost and tied. Ties are possible in group play and never in a knockout. Sorts by wins.',
    value: (r) => r.wins,
    format: (r) => record(r.wins, r.losses, r.draws),
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
    key: 'seasonTitles', label: 'Season Championships', short: 'SC', group: 'titles', align: 'right',
    tooltip: 'Season Championships — Seasons this player won, from the champion recorded on each completed Season. Click a count to see which ones.',
    value: (r) => r.seasonTitles,
    format: (r) => dash(r.seasonTitles),
  },
  {
    key: 'tournamentTitles', label: 'Tournament Championships', short: 'TC', group: 'titles', align: 'right',
    tooltip: 'Tournament Championships — standalone Tournaments this player won, from the champion recorded on each Tournament. Click a count to see which ones.',
    value: (r) => r.tournamentTitles,
    format: (r) => dash(r.tournamentTitles),
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
    // Games have no tie — a frame is won or it is not — so this pair stays two numbers.
    format: (r) => `${r.gamesWon}–${r.gamesLost}`,
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

// --------------------------------------------------------------------------- density presets

export type Density = 'compact' | 'standard' | 'full' | 'custom'

export const DENSITIES: { id: Density; label: string; hint: string }[] = [
  { id: 'compact', label: 'Compact', hint: 'Identity, record, win rate, rating and titles' },
  { id: 'standard', label: 'Standard', hint: 'The figures most readers want while browsing' },
  { id: 'full', label: 'Full', hint: 'Every statistic with real data behind it' },
  { id: 'custom', label: 'Custom', hint: 'Choose the columns yourself' },
]

/**
 * What each preset shows.
 *
 * Written as ordered key lists rather than flags on the column definitions, because a preset is a
 * decision about which figures belong together — that reads better in one place than as `compact:
 * true` scattered across twenty-five definitions.
 *
 * Full is derived rather than listed: it is every column that applies to the view, so a new column
 * cannot be added and then quietly missing from the preset that promises all of them.
 */
const COMPACT_KEYS = [
  'rank', 'player', 'rating', 'record', 'matchWinPct', 'seasonTitles', 'tournamentTitles',
]

/**
 * The default table.
 *
 * Rating · Match record · Win % · Streak · Season Championships · Tournament Championships —
 * the six figures a reader actually scans, in that order. Both championship counts are shown at
 * once rather than swapped by a control, because "how many Seasons AND how many Tournaments" is one
 * question about a player, not two views of the same number.
 *
 * Games, differential, finals, points and the rest are real and stay available under Full and
 * Custom; they are simply not what the default is for.
 */
const STANDARD_KEYS = [
  'rank', 'player', 'rating', 'record', 'matchWinPct', 'currentStreak',
  'seasonTitles', 'tournamentTitles',
]

export function keysForDensity(density: Density, view: RecordView): string[] {
  const available = columnsForView(view)
  const has = (k: string) => available.some((c) => c.key === k)
  switch (density) {
    case 'compact': return COMPACT_KEYS.filter(has)
    case 'full': return available.map((c) => c.key)
    // 'custom' with no explicit selection falls back to Standard, which is what a reader sees
    // before they have chosen anything.
    default: return STANDARD_KEYS.filter(has)
  }
}

export const DEFAULT_DENSITY: Density = 'standard'

/** The keys actually rendered, given a density and any explicit custom selection. */
export function visibleKeys(
  density: Density,
  view: RecordView,
  custom: string[] | null,
): string[] {
  const available = columnsForView(view)
  const order = available.map((c) => c.key)
  const chosen = density === 'custom' && custom?.length
    ? custom.filter((k) => order.includes(k))
    : keysForDensity(density, view)
  // Locked columns are always present and always first, whatever the selection says, and the rest
  // follow the canonical column order rather than the order they were switched on.
  const locked = available.filter((c) => c.locked).map((c) => c.key)
  const set = new Set([...locked, ...chosen])
  return order.filter((k) => set.has(k))
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
  mode: ChampionshipMode,
): ExplorerRow[] {
  const out = [...rows]
  if (sort.length === 0) return out.sort((a, b) => a.rank - b.rank)

  out.sort((a, b) => {
    for (const { key, dir } of sort) {
      const col = COLUMN_BY_KEY[key]
      if (!col) continue
      const av = col.value(a, mode)
      const bv = col.value(b, mode)

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
  championsOnly: boolean
  /** 'all' | 'singles' | 'teams' */
  entrantType: 'all' | 'singles' | 'teams'
  activeOnly: boolean
}

export const EMPTY_ROW_FILTERS: RowFilters = {
  search: '',
  minMatches: 0,
  championsOnly: false,
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
  mode: ChampionshipMode,
): ExplorerRow[] {
  return rows.filter((r) => {
    if (!matchesQuery(r, f.search)) return false
    if (!isQualified(r, f.minMatches)) return false
    if (f.championsOnly && (mode === 'SC' ? r.seasonTitles : r.tournamentTitles) === 0) return false
    if (f.entrantType === 'singles' && r.isTeamPlayer) return false
    if (f.entrantType === 'teams' && !r.isTeamPlayer) return false
    if (f.activeOnly && !r.active) return false
    return true
  })
}

export function hasActiveRowFilters(f: RowFilters): boolean {
  return f.search.trim() !== ''
    || f.minMatches > 0
    || f.championsOnly
    || f.entrantType !== 'all'
    || f.activeOnly
}

// --------------------------------------------------------------------------- URL state

export type Scope = 'current' | 'all-time'

export interface RankingsState {
  scope: Scope
  view: RecordView
  mode: ChampionshipMode
  sort: SortSpec[]
  density: Density
  /** Explicit column selection. Only meaningful with density 'custom'. */
  columns: string[] | null
  rowFilters: RowFilters
  competitionSeriesId: number | null
  year: number | null
  seasonId: number | null
  tournamentId: number | null
  division: string | null
  fromYear: number | null
  toYear: number | null
  /** Canonical era id. Always null until era metadata exists — see ExplorerFacets.eras. */
  era: string | null
  expanded: string | null
  /** Players selected for comparison, at most three. */
  compare: string[]
  /** Which saved view produced this state, when one did. */
  savedView: string | null
}

export function defaultState(): RankingsState {
  return {
    scope: 'current',
    view: 'overall',
    mode: 'SC',
    sort: [],
    density: DEFAULT_DENSITY,
    columns: null,
    rowFilters: { ...EMPTY_ROW_FILTERS },
    competitionSeriesId: null,
    year: null,
    seasonId: null,
    tournamentId: null,
    division: null,
    fromYear: null,
    toYear: null,
    era: null,
    expanded: null,
    compare: [],
    savedView: null,
  }
}

const VIEWS: RecordView[] = ['overall', 'group', 'playoff', 'tournament']
const DENSITY_IDS: Density[] = ['compact', 'standard', 'full', 'custom']

/** The most players the comparison panel will hold. */
export const MAX_COMPARE = 3

/**
 * Serialise state to a query string.
 *
 * Defaults are omitted rather than written out, so a plain /rankings link stays clean and the
 * absence of a parameter and its default value mean exactly the same thing.
 */
export function encodeRankingsState(s: RankingsState): string {
  const p = new URLSearchParams()
  const d = defaultState()

  if (s.scope !== d.scope) p.set('scope', s.scope)
  if (s.view !== d.view) p.set('view', s.view)
  if (s.mode !== d.mode) p.set('mode', s.mode)
  // "rating:desc,titles:asc" — compact and readable in a shared link.
  if (s.sort.length) p.set('sort', s.sort.map((x) => `${x.key}:${x.dir}`).join(','))
  if (s.density !== d.density) p.set('density', s.density)
  if (s.density === 'custom' && s.columns?.length) p.set('cols', s.columns.join(','))
  if (s.rowFilters.search.trim()) p.set('q', s.rowFilters.search.trim())
  if (s.rowFilters.minMatches > 0) p.set('min', String(s.rowFilters.minMatches))
  if (s.rowFilters.championsOnly) p.set('champs', '1')
  if (s.rowFilters.entrantType !== 'all') p.set('type', s.rowFilters.entrantType)
  if (s.rowFilters.activeOnly) p.set('active', '1')
  if (s.competitionSeriesId != null) p.set('comp', String(s.competitionSeriesId))
  if (s.year != null) p.set('year', String(s.year))
  if (s.seasonId != null) p.set('season', String(s.seasonId))
  if (s.tournamentId != null) p.set('tournament', String(s.tournamentId))
  if (s.division) p.set('division', s.division)
  if (s.fromYear != null) p.set('from', String(s.fromYear))
  if (s.toYear != null) p.set('to', String(s.toYear))
  if (s.era) p.set('era', s.era)
  if (s.expanded) p.set('expand', s.expanded)
  if (s.compare.length) p.set('compare', s.compare.join(','))
  if (s.savedView) p.set('preset', s.savedView)

  return p.toString()
}

/**
 * Read state out of a query string.
 *
 * Every value is validated against what actually exists, and anything unrecognised is DROPPED
 * rather than carried: a stale link, a truncated paste or a hand-edited parameter degrades to the
 * default table instead of rendering a broken one or throwing during a server render.
 */
export function decodeRankingsState(input: URLSearchParams | string): RankingsState {
  const p = typeof input === 'string' ? new URLSearchParams(input) : input
  const s = defaultState()

  if (p.get('scope') === 'all-time') s.scope = 'all-time'
  const view = p.get('view')
  if (view && (VIEWS as string[]).includes(view)) s.view = view as RecordView
  if (p.get('mode') === 'TC') s.mode = 'TC'

  const sort = p.get('sort')
  if (sort) {
    s.sort = sort.split(',')
      .map((chunk) => {
        const [key, dir] = chunk.split(':')
        return { key, dir: dir === 'asc' ? 'asc' as const : 'desc' as const }
      })
      .filter((x) => !!COLUMN_BY_KEY[x.key])
  }

  const density = p.get('density')
  if (density && (DENSITY_IDS as string[]).includes(density)) s.density = density as Density

  const cols = p.get('cols')
  if (cols) {
    const valid = cols.split(',').filter((k) => !!COLUMN_BY_KEY[k])
    if (valid.length) {
      s.columns = valid
      // A shared link that names columns is asking for those columns, whether or not it also said
      // density=custom. Honouring the columns without switching the mode would silently discard them.
      s.density = 'custom'
    }
  }

  s.rowFilters.search = p.get('q') ?? ''
  const min = Number(p.get('min'))
  s.rowFilters.minMatches = Number.isFinite(min) && min > 0 ? Math.floor(min) : 0
  s.rowFilters.championsOnly = p.get('champs') === '1'
  const type = p.get('type')
  if (type === 'singles' || type === 'teams') s.rowFilters.entrantType = type
  s.rowFilters.activeOnly = p.get('active') === '1'

  const int = (k: string): number | null => {
    const raw = p.get(k)
    if (raw == null || raw.trim() === '') return null
    const v = Number(raw)
    return Number.isFinite(v) ? Math.floor(v) : null
  }
  s.competitionSeriesId = int('comp')
  s.year = int('year')
  s.seasonId = int('season')
  s.tournamentId = int('tournament')

  const division = p.get('division')?.trim()
  // A short code or the unassigned sentinel. Anything longer is not a division and is dropped
  // rather than passed into the aggregate.
  if (division && (division === UNASSIGNED_DIVISION || division.length <= 8)) s.division = division

  s.fromYear = int('from')
  s.toYear = int('to')
  // A reversed range is a typo, not a request for zero rows. Reading it in the order the reader
  // clearly meant beats rendering an empty table with no explanation.
  if (s.fromYear != null && s.toYear != null && s.fromYear > s.toYear) {
    const swap = s.fromYear; s.fromYear = s.toYear; s.toYear = swap
  }

  // Eras are only honoured once canonical era metadata exists; until then the parameter is parsed
  // and carried but matches nothing, which is why the filter is not offered in the UI.
  s.era = p.get('era')?.trim() || null

  s.expanded = p.get('expand')?.trim() || null

  const compare = p.get('compare')
  if (compare) {
    s.compare = [...new Set(compare.split(',').map((v) => v.trim()).filter(Boolean))].slice(0, MAX_COMPARE)
  }

  const preset = p.get('preset')?.trim()
  if (preset && SAVED_VIEWS.some((v) => v.id === preset)) s.savedView = preset

  return s
}

/** The subset of state the server aggregate needs. Everything else is applied to the returned rows. */
export function aggregateFilters(s: RankingsState) {
  return {
    competitionSeriesId: s.competitionSeriesId,
    year: s.year,
    seasonId: s.seasonId,
    tournamentId: s.tournamentId,
    division: s.division,
    fromYear: s.fromYear,
    toYear: s.toYear,
  }
}

// --------------------------------------------------------------------------- saved views

/**
 * Named starting points, each of which is nothing more than a set of filters and a sort.
 *
 * Deliberately no hidden logic: a saved view is defined here as a patch over the default state, it
 * writes those values into the URL like any other control, and Reset clears it the same way. If a
 * preset could rank differently from the controls it sets, it would be a second ranking system.
 */
export interface SavedView {
  id: string
  label: string
  hint: string
  patch: Partial<RankingsState>
  /** Only offered when the data can support it. */
  available?: (ctx: { divisions: string[] }) => boolean
}

export const SAVED_VIEWS: SavedView[] = [
  {
    id: 'all-time-champions',
    label: 'All-Time Champions',
    hint: 'Every player with at least one championship, over all recorded competitions',
    patch: {
      scope: 'all-time',
      view: 'overall',
      rowFilters: { ...EMPTY_ROW_FILTERS, championsOnly: true },
      sort: [{ key: 'titles', dir: 'desc' }],
    },
  },
  {
    id: 'best-playoff-records',
    label: 'Best Playoff Records',
    hint: 'Playoff matches only, ordered by win rate, with a floor of five matches',
    patch: {
      scope: 'all-time',
      view: 'playoff',
      rowFilters: { ...EMPTY_ROW_FILTERS, minMatches: 5 },
      sort: [{ key: 'matchWinPct', dir: 'desc' }],
    },
  },
  {
    id: 'active-players',
    label: 'Active Players',
    hint: 'Current ladder, active profiles only',
    patch: {
      scope: 'current',
      view: 'overall',
      rowFilters: { ...EMPTY_ROW_FILTERS, activeOnly: true },
      sort: [],
    },
  },
  {
    id: 'division-a',
    label: 'Division A',
    hint: 'Seasons recorded as Division A',
    patch: { scope: 'all-time', division: 'A' },
    available: ({ divisions }) => divisions.includes('A'),
  },
  {
    id: 'division-b',
    label: 'Division B',
    hint: 'Seasons recorded as Division B',
    patch: { scope: 'all-time', division: 'B' },
    available: ({ divisions }) => divisions.includes('B'),
  },
]

/** Saved views the current data can actually support. */
export function availableSavedViews(divisions: string[]): SavedView[] {
  return SAVED_VIEWS.filter((v) => !v.available || v.available({ divisions }))
}

export function applySavedView(view: SavedView): RankingsState {
  return { ...defaultState(), ...view.patch, savedView: view.id }
}

// --------------------------------------------------------------------------- active filter chips

export interface FilterChip { key: string; label: string }

/** What is currently narrowing the table, and therefore whether Reset Filters is offered. */
export function activeChips(
  s: RankingsState,
  names: {
    competition?: string | null
    season?: string | null
    tournament?: string | null
  } = {},
): FilterChip[] {
  const chips: FilterChip[] = []
  if (s.competitionSeriesId != null) chips.push({ key: 'comp', label: names.competition ?? 'Competition' })
  if (s.year != null) chips.push({ key: 'year', label: String(s.year) })
  if (s.seasonId != null) chips.push({ key: 'season', label: names.season ?? 'Season' })
  if (s.tournamentId != null) chips.push({ key: 'tournament', label: names.tournament ?? 'Tournament' })
  if (s.division) {
    chips.push({
      key: 'division',
      label: s.division === UNASSIGNED_DIVISION ? 'Division unassigned' : `Division ${s.division}`,
    })
  }
  if (s.fromYear != null || s.toYear != null) {
    chips.push({
      key: 'range',
      label: s.fromYear != null && s.toYear != null ? `${s.fromYear}–${s.toYear}`
        : s.fromYear != null ? `from ${s.fromYear}` : `to ${s.toYear}`,
    })
  }
  if (s.rowFilters.search.trim()) chips.push({ key: 'q', label: `“${s.rowFilters.search.trim()}”` })
  if (s.rowFilters.minMatches > 0) chips.push({ key: 'min', label: `${s.rowFilters.minMatches}+ matches` })
  if (s.rowFilters.championsOnly) chips.push({ key: 'champs', label: 'Champions only' })
  if (s.rowFilters.entrantType !== 'all') {
    chips.push({ key: 'type', label: s.rowFilters.entrantType === 'teams' ? 'Teams' : 'Singles' })
  }
  if (s.rowFilters.activeOnly) chips.push({ key: 'active', label: 'Active only' })
  return chips
}

/** True when anything other than scope, view, mode or sort is narrowing the table. */
export function hasAnyFilter(s: RankingsState): boolean {
  return activeChips(s).length > 0
}

// --------------------------------------------------------------------------- local device prefs

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
export const PINS_KEY = '8br.rankings.pins'

export interface DevicePrefs {
  density: Density
  columns: string[] | null
}

export function readDevicePrefs(storage: Pick<Storage, 'getItem'> | null | undefined): DevicePrefs | null {
  try {
    const raw = storage?.getItem(PREF_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<DevicePrefs>
    const density = (DENSITY_IDS as string[]).includes(String(parsed.density))
      ? parsed.density as Density
      : DEFAULT_DENSITY
    const columns = Array.isArray(parsed.columns)
      ? parsed.columns.filter((k): k is string => typeof k === 'string' && !!COLUMN_BY_KEY[k])
      : null
    return { density, columns: columns?.length ? columns : null }
  } catch {
    // A corrupt or foreign value is not worth a broken page.
    return null
  }
}

export function readPins(storage: Pick<Storage, 'getItem'> | null | undefined): string[] {
  try {
    const raw = storage?.getItem(PINS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

/**
 * Split rows into pinned and the rest, WITHOUT renumbering anything.
 *
 * The pinned rows keep the exact `rank` they were assigned by the aggregate. Pinning is a reading
 * aid; if it could change a number on the row it would be a ranking system, and a private one at
 * that.
 */
export function partitionPinned<T extends { playerId: string }>(
  rows: T[],
  pins: string[],
): { pinned: T[]; rest: T[] } {
  if (!pins.length) return { pinned: [], rest: rows }
  const set = new Set(pins)
  const pinned: T[] = []
  const rest: T[] = []
  for (const r of rows) (set.has(r.playerId) ? pinned : rest).push(r)
  return { pinned, rest }
}
