import type { ExplorerRow, RecordView } from './ladder-explorer'

/**
 * Column definitions, sorting and row filtering for the Ladder explorer.
 *
 * Deliberately pure and free of `server-only` or Prisma: the table is interactive, so this module is
 * imported by a client component. Keeping the logic here rather than inside the component is what makes
 * the sort cycle and the filter rules testable without rendering anything.
 */

export type ChampionshipMode = 'SC' | 'TC'

export type ColumnGroup = 'identity' | 'match' | 'game' | 'rating' | 'highest' | 'titles' | 'group' | 'activity'

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
  /** Full header text. */
  label: string
  /** Abbreviated header, used when the full label would crowd the row. */
  short?: string
  group: ColumnGroup
  align: 'left' | 'right'
  /** Explains the column, including how it is derived where that is not obvious. */
  tooltip: string
  /** Value for sorting and display. Null means "not applicable", which sorts last either way. */
  value: (r: ExplorerRow, mode: ChampionshipMode) => number | string | null
  /** Rendered text. Defaults to the value. */
  format?: (r: ExplorerRow, mode: ChampionshipMode) => string
  /** Views where the column carries meaning. Omitted means every view. */
  views?: RecordView[]
  defaultVisible: boolean
  /** Rank and Player are frozen: always shown, always first, never hidden. */
  locked?: boolean
}

const pctText = (n: number) => `${n.toFixed(1)}%`
const signed = (n: number) => (n > 0 ? `+${n}` : String(n))

/** A win-loss pair as one cell, which reads faster than two columns. */
const record = (w: number, l: number) => `${w}–${l}`

export const COLUMNS: ColumnDef[] = [
  {
    key: 'rank', label: 'Rank', group: 'identity', align: 'right', locked: true, defaultVisible: true,
    tooltip: 'Official standing for the selected scope and view. Sorting the table never changes it.',
    value: (r) => r.rank,
  },
  {
    key: 'player', label: 'Player', group: 'identity', align: 'left', locked: true, defaultVisible: true,
    tooltip: 'CueVerse ID, with the preferred name in brackets where one is set.',
    value: (r) => r.label,
  },

  // ── Match record
  {
    key: 'played', label: 'Played', short: 'P', group: 'match', align: 'right', defaultVisible: true,
    tooltip: 'Matches with a recorded result. Forfeits count as matches.',
    value: (r) => r.played,
  },
  {
    key: 'record', label: 'W–L', group: 'match', align: 'right', defaultVisible: true,
    tooltip: 'Wins and losses. Sorts by wins.',
    value: (r) => r.wins,
    format: (r) => record(r.wins, r.losses),
  },
  {
    key: 'draws', label: 'Draws', short: 'D', group: 'match', align: 'right', defaultVisible: false,
    tooltip: 'Drawn matches. Possible in group play, never in a knockout.',
    value: (r) => r.draws,
  },
  {
    key: 'matchWinPct', label: 'Win %', group: 'match', align: 'right', defaultVisible: true,
    tooltip: 'Wins as a share of matches with a result.',
    value: (r) => r.matchWinPct,
    format: (r) => pctText(r.matchWinPct),
  },

  // ── Game record
  {
    key: 'games', label: 'Games', group: 'game', align: 'right', defaultVisible: true,
    tooltip: 'Games won and lost. Forfeits contribute no games, because none were played.',
    value: (r) => r.gamesWon,
    format: (r) => record(r.gamesWon, r.gamesLost),
  },
  {
    key: 'gameDiff', label: 'Diff', group: 'game', align: 'right', defaultVisible: true,
    tooltip: 'Games won minus games lost.',
    value: (r) => r.gameDiff,
    format: (r) => signed(r.gameDiff),
  },
  {
    key: 'gameWinPct', label: 'Game %', group: 'game', align: 'right', defaultVisible: false,
    tooltip: 'Games won as a share of games played.',
    value: (r) => r.gameWinPct,
    format: (r) => pctText(r.gameWinPct),
  },

  // ── Rating
  {
    key: 'rating', label: 'Rating', group: 'rating', align: 'right', defaultVisible: true,
    tooltip: 'Elo rating after the most recent match in scope. The same figure in every view — a rating is not per-stage.',
    value: (r) => r.rating,
  },
  {
    key: 'peakRating', label: 'Peak rating', short: 'Peak', group: 'highest', align: 'right', defaultVisible: false,
    tooltip: 'Highest rating actually reached in scope. A real measurement from the ledger, not a reconstructed historical position.',
    value: (r) => r.peakRating,
  },
  {
    key: 'currentStreak', label: 'Streak', group: 'rating', align: 'right', defaultVisible: true,
    tooltip: 'Current unbroken run. Positive is wins, negative is losses.',
    value: (r) => r.currentStreak,
    format: (r) => (r.currentStreak === 0 ? '—'
      : `${r.currentStreak > 0 ? 'W' : 'L'}${Math.abs(r.currentStreak)}`),
  },
  {
    key: 'longestStreak', label: 'Best run', group: 'highest', align: 'right', defaultVisible: false,
    tooltip: 'Longest winning run in scope.',
    value: (r) => r.longestStreak,
    format: (r) => (r.longestStreak === 0 ? '—' : `W${r.longestStreak}`),
  },

  // ── Honours
  {
    key: 'titles', label: 'Titles', group: 'titles', align: 'right', defaultVisible: true,
    tooltip: 'Championships won. The SC / TC control chooses Season or Tournament titles.',
    value: (r, mode) => (mode === 'SC' ? r.seasonTitles : r.tournamentTitles),
    format: (r, mode) => {
      const n = mode === 'SC' ? r.seasonTitles : r.tournamentTitles
      return n === 0 ? '—' : String(n)
    },
  },
  {
    key: 'runnerUps', label: 'Runner-up', short: 'R/U', group: 'titles', align: 'right', defaultVisible: false,
    tooltip: 'Losing finalist finishes.',
    value: (r) => r.runnerUps,
    format: (r) => (r.runnerUps === 0 ? '—' : String(r.runnerUps)),
  },
  {
    key: 'finalsAppearances', label: 'Finals', group: 'titles', align: 'right', defaultVisible: true,
    tooltip: 'Competitions where the player reached the final, from the stored round label.',
    value: (r) => r.finalsAppearances,
    format: (r) => (r.finalsAppearances === 0 ? '—' : String(r.finalsAppearances)),
  },
  {
    key: 'semifinalAppearances', label: 'Semis', group: 'titles', align: 'right', defaultVisible: false,
    tooltip: 'Competitions where the player reached a semifinal.',
    value: (r) => r.semifinalAppearances,
    format: (r) => (r.semifinalAppearances === 0 ? '—' : String(r.semifinalAppearances)),
  },
  {
    key: 'playoffAppearances', label: 'Playoffs', group: 'titles', align: 'right', defaultVisible: false,
    tooltip: 'Competitions where the player played at least one playoff match.',
    value: (r) => r.playoffAppearances,
    format: (r) => (r.playoffAppearances === 0 ? '—' : String(r.playoffAppearances)),
  },

  // ── Group play. Career figures from the stored standings, so they are shown where they inform the
  //    view rather than on the knockout-only tab.
  {
    key: 'groupPoints', label: 'Points', short: 'Pts', group: 'group', align: 'right',
    views: ['overall', 'group'], defaultVisible: true,
    tooltip: 'Standings points across every group stage entered, from the stored standings.',
    value: (r) => r.groupPoints,
    format: (r) => (r.groupPoints == null ? '—' : String(r.groupPoints)),
  },
  {
    key: 'groupsEntered', label: 'Groups', group: 'group', align: 'right',
    views: ['overall', 'group'], defaultVisible: false,
    tooltip: 'Group stages entered.',
    value: (r) => r.groupsEntered,
    format: (r) => (r.groupsEntered == null ? '—' : String(r.groupsEntered)),
  },
  {
    key: 'groupFirstPlaces', label: 'Group wins', short: '1st', group: 'group', align: 'right',
    views: ['overall', 'group'], defaultVisible: false,
    tooltip: 'Group stages finished in first place.',
    value: (r) => r.groupFirstPlaces,
    format: (r) => (r.groupFirstPlaces == null ? '—' : String(r.groupFirstPlaces)),
  },
  {
    key: 'perfectGroupStages', label: 'Perfect', group: 'group', align: 'right',
    views: ['overall', 'group'], defaultVisible: false,
    tooltip: 'Group stages completed without losing a match.',
    value: (r) => r.perfectGroupStages,
    format: (r) => (r.perfectGroupStages == null ? '—' : String(r.perfectGroupStages)),
  },
  {
    key: 'qualificationPct', label: 'Qual %', group: 'group', align: 'right',
    views: ['overall', 'group'], defaultVisible: false,
    tooltip: 'Share of Seasons entered where the player qualified for the playoffs.',
    value: (r) => r.qualificationPct,
    format: (r) => (r.qualificationPct == null ? '—' : pctText(r.qualificationPct)),
  },

  // ── Activity
  {
    key: 'competitionsEntered', label: 'Comps', group: 'activity', align: 'right', defaultVisible: false,
    tooltip: 'Distinct competitions with at least one recorded match in scope.',
    value: (r) => r.competitionsEntered,
  },
  {
    key: 'forfeits', label: 'FF', group: 'activity', align: 'right', defaultVisible: false,
    tooltip: 'Matches decided by forfeit. Counted as matches, excluded from games.',
    value: (r) => r.forfeits,
    format: (r) => (r.forfeits === 0 ? '—' : String(r.forfeits)),
  },
  {
    key: 'idleDays', label: 'Last seen', group: 'activity', align: 'right', defaultVisible: false,
    tooltip: 'Days since the most recent recorded match.',
    value: (r) => r.idleDays,
    format: (r) => (r.idleDays == null ? '—' : r.idleDays === 0 ? 'today' : `${r.idleDays}d`),
  },
]

export const COLUMN_BY_KEY: Record<string, ColumnDef> =
  Object.fromEntries(COLUMNS.map((c) => [c.key, c]))

/** Columns that carry meaning in a given view. */
export function columnsForView(view: RecordView): ColumnDef[] {
  return COLUMNS.filter((c) => !c.views || c.views.includes(view))
}

export function defaultVisibleKeys(view: RecordView): string[] {
  return columnsForView(view).filter((c) => c.locked || c.defaultVisible).map((c) => c.key)
}

// --------------------------------------------------------------------------- sorting

export type SortDirection = 'asc' | 'desc'
export interface SortSpec { key: string; dir: SortDirection }

/**
 * Advance one column through desc → asc → off.
 *
 * `additive` (Shift-click) appends the column as a secondary key instead of replacing the sort, so a
 * reader can order by titles and then break ties by rating. A column cycling off is removed entirely
 * rather than left at a neutral direction, so the third click genuinely restores the default order.
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
  // Was ascending: drop it. With no keys left the table returns to official order.
  const without = current.filter((s) => s.key !== key)
  return additive ? without : []
}

/**
 * Sort rows for display.
 *
 * Official rank is never recomputed here — it is a value on the row. When no sort is active the table
 * shows official order; otherwise rank ascending is appended as the final comparator so the order is
 * total and stable, and two players who tie on every selected column never swap between renders.
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

      // Null is "not applicable" and always sorts last, whichever direction is active — a blank cell
      // rising to the top on an ascending sort would look like a zero.
      if (av == null && bv == null) continue
      if (av == null) return 1
      if (bv == null) return -1

      let cmp: number
      if (typeof av === 'string' || typeof bv === 'string') {
        cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' })
      } else {
        cmp = av - bv
      }
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
 * Contrast `ExplorerFilters` in the service, which changes which matches count and therefore has to be
 * applied in the aggregate.
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

export function filterRows(
  rows: ExplorerRow[],
  f: RowFilters,
  mode: ChampionshipMode,
): ExplorerRow[] {
  const q = f.search.trim().toLowerCase()
  return rows.filter((r) => {
    // Search matches either half of the identity, so a preferred name finds a player whose ID differs.
    if (q && !(r.cueverseId ?? '').toLowerCase().includes(q)
           && !r.preferredName.toLowerCase().includes(q)) return false
    if (r.played < f.minMatches) return false
    if (f.championsOnly && (mode === 'SC' ? r.seasonTitles : r.tournamentTitles) === 0) return false
    if (f.entrantType === 'singles' && r.isTeamPlayer) return false
    if (f.entrantType === 'teams' && !r.isTeamPlayer) return false
    if (f.activeOnly && !r.active) return false
    return true
  })
}

/** Whether anything is narrowing the table, which is what decides if Reset is offered. */
export function hasActiveRowFilters(f: RowFilters): boolean {
  return f.search.trim() !== ''
    || f.minMatches > 0
    || f.championsOnly
    || f.entrantType !== 'all'
    || f.activeOnly
}

// --------------------------------------------------------------------------- URL state

/**
 * The complete table configuration, and its round trip through a query string.
 *
 * Every control is represented so a configured table can be linked or reloaded. Defaults are omitted
 * from the output rather than written out, which keeps a plain /rankings link clean and means the
 * absence of a parameter and its default value are the same thing.
 */
export interface ExplorerState {
  scope: 'current' | 'all-time'
  view: RecordView
  mode: ChampionshipMode
  sort: SortSpec[]
  columns: string[] | null
  rowFilters: RowFilters
  competitionSeriesId: number | null
  year: number | null
  seasonId: number | null
  tournamentId: number | null
  expanded: string | null
}

export function defaultState(): ExplorerState {
  return {
    scope: 'current',
    view: 'overall',
    mode: 'SC',
    sort: [],
    columns: null,
    rowFilters: { ...EMPTY_ROW_FILTERS },
    competitionSeriesId: null,
    year: null,
    seasonId: null,
    tournamentId: null,
    expanded: null,
  }
}

const VIEWS: RecordView[] = ['overall', 'group', 'playoff', 'tournament']

export function encodeExplorerState(s: ExplorerState): string {
  const p = new URLSearchParams()
  const d = defaultState()

  if (s.scope !== d.scope) p.set('scope', s.scope)
  if (s.view !== d.view) p.set('view', s.view)
  if (s.mode !== d.mode) p.set('mode', s.mode)
  // "rating:desc,titles:asc" — compact and readable in a shared link.
  if (s.sort.length) p.set('sort', s.sort.map((x) => `${x.key}:${x.dir}`).join(','))
  if (s.columns) p.set('cols', s.columns.join(','))
  if (s.rowFilters.search.trim()) p.set('q', s.rowFilters.search.trim())
  if (s.rowFilters.minMatches > 0) p.set('min', String(s.rowFilters.minMatches))
  if (s.rowFilters.championsOnly) p.set('champs', '1')
  if (s.rowFilters.entrantType !== 'all') p.set('type', s.rowFilters.entrantType)
  if (s.rowFilters.activeOnly) p.set('active', '1')
  if (s.competitionSeriesId != null) p.set('comp', String(s.competitionSeriesId))
  if (s.year != null) p.set('year', String(s.year))
  if (s.seasonId != null) p.set('season', String(s.seasonId))
  if (s.tournamentId != null) p.set('tournament', String(s.tournamentId))

  return p.toString()
}

/**
 * Read a configuration out of a query string.
 *
 * Every value is validated against what actually exists. An unknown column key or sort key is dropped
 * rather than carried, so a stale or hand-edited link degrades to the default table instead of
 * rendering a broken one.
 */
export function decodeExplorerState(input: URLSearchParams | string): ExplorerState {
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

  const cols = p.get('cols')
  if (cols) {
    const valid = cols.split(',').filter((k) => !!COLUMN_BY_KEY[k])
    if (valid.length) s.columns = valid
  }

  s.rowFilters.search = p.get('q') ?? ''
  const min = Number(p.get('min'))
  s.rowFilters.minMatches = Number.isFinite(min) && min > 0 ? Math.floor(min) : 0
  s.rowFilters.championsOnly = p.get('champs') === '1'
  const type = p.get('type')
  if (type === 'singles' || type === 'teams') s.rowFilters.entrantType = type
  s.rowFilters.activeOnly = p.get('active') === '1'

  const int = (k: string): number | null => {
    const v = Number(p.get(k))
    return p.get(k) != null && Number.isFinite(v) ? Math.floor(v) : null
  }
  s.competitionSeriesId = int('comp')
  s.year = int('year')
  s.seasonId = int('season')
  s.tournamentId = int('tournament')

  return s
}

/** Filter chips: what is currently narrowing the table, and how to clear each one. */
export interface FilterChip { key: string; label: string }

export function activeChips(
  s: ExplorerState,
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
  if (s.rowFilters.search.trim()) chips.push({ key: 'q', label: `"${s.rowFilters.search.trim()}"` })
  if (s.rowFilters.minMatches > 0) chips.push({ key: 'min', label: `${s.rowFilters.minMatches}+ matches` })
  if (s.rowFilters.championsOnly) chips.push({ key: 'champs', label: 'Champions only' })
  if (s.rowFilters.entrantType !== 'all') {
    chips.push({ key: 'type', label: s.rowFilters.entrantType === 'teams' ? 'Teams' : 'Singles' })
  }
  if (s.rowFilters.activeOnly) chips.push({ key: 'active', label: 'Active only' })
  return chips
}
