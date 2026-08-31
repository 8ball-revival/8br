import type { CompetitionPlatform } from '@prisma/client'
import type { ExplorerRow, RecordView } from './ladder-explorer'
import { DEFAULT_SCOPE, parseScope, type RankingScope } from './rankings-scope'

/**
 * The four record views.
 *
 * Declared here rather than beside the query that uses them, because this module is client-safe and
 * that one is `server-only`: the filter bar needs these labels in the browser, and reaching into the
 * server module for them drags the whole database stack along.
 */
export const RECORD_VIEWS: { id: RecordView; label: string; hint: string }[] = [
  { id: 'overall', label: 'Overall', hint: 'Every recorded match, Seasons and Tournaments together' },
  { id: 'group', label: 'Group Play', hint: 'Season group stages only' },
  { id: 'playoff', label: 'Playoffs', hint: 'Season playoff brackets only' },
  { id: 'tournament', label: 'Tournaments', hint: 'Standalone Tournaments only' },
]
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
    /*
      The whole Season record: group stage and playoffs together.

      Its two halves are `groupRecord` and `playoffRecord`, which stay available for a reader who
      wants the split. This is the figure most people mean by "how did they do in Seasons" - the
      question the two halves answer between them but neither answers alone - and it reads directly
      against the Tournament record beside it.

      The key was previously an alias for `groupRecord`, from a period when that column silently
      included the playoffs. It is a real column again, and it means what its name says.
    */
    key: 'seasonRecord', label: 'Season Record', short: 'Season W–L–D', group: 'match', align: 'right',
    tooltip: 'Every match inside completed, archived Seasons — group stage and playoffs together. The two halves are available separately as Group Record and Playoffs Record. Sorts by wins.',
    value: (r) => r.groupWins + r.playoffWins,
    format: (r) => record3(
      r.groupWins + r.playoffWins,
      r.groupLosses + r.playoffLosses,
      r.groupDraws + r.playoffDraws,
    ),
  },
  {
    key: 'tournamentsPlayed', label: 'Tournaments Played', short: 'Tournaments Played', group: 'match', align: 'right',
    tooltip: 'How many Tournaments this player took part in, counting an approved registration. A pending or rejected entry is a request to take part rather than taking part, so neither counts.',
    value: (r) => r.tournamentsPlayed,
    format: (r) => dash(r.tournamentsPlayed),
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
    tooltip: 'Eligible matches from completed, archived Tournaments only. Draws are possible where a Tournament format allows one, so the record is shown as W–L–D. Sorts by wins.',
    value: (r) => r.tournamentWins,
    /*
      Always three numbers, to read against the Season record beside it.

      It used to drop the draw unless there was one, on the reasoning that a permanent "–0" says
      nothing about most Tournaments. True on its own; but this column now sits directly beside a
      Season W–L–D, and a 2-4 next to an 8-1-0 reads as a different KIND of figure rather than the
      same figure for a different competition. Matching them is worth one predictable zero.
    */
    format: (r) => record3(r.tournamentWins, r.tournamentLosses, r.tournamentDraws),
  },
  {
    /*
     * The archive's championship column.
     *
     * Deliberately NOT `seasonTitles` under a different name. That column counts every Season
     * championship on the ladder in view; this one counts 8BRCAM championships specifically, which
     * is the question the Yahoo archive is asking. They agree today because every Yahoo Season is
     * 8BRCAM — and the day one is not, this column is the one that stays correct.
     *
     * The value is a SNAPSHOT, not a lifetime total: it is computed inside the same season scope as
     * every other figure on the row, so narrowing to 2012–2014 narrows this too.
     */
    key: 'brcamTitles',
    label: '8BRCAM Championships',
    // Two lines, stacked, so the header does not drag the column to the width of the phrase.
    short: '8BRCAM\nChampionships',
    group: 'titles',
    align: 'right',
    tooltip: '8BRCAM Season championships won inside the years and filters currently applied — not a lifetime total. Counts each Season once, from the champion recorded on it. Tournaments and runner-up finishes are not counted.',
    value: (r) => r.brcamSeasonTitles,
    format: (r) => dash(r.brcamSeasonTitles),
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
export function columnsForView(view: RecordView, profile: TableProfile = 'archive'): ColumnDef[] {
  const cols = COLUMNS.filter((c) => !c.views || c.views.includes(view))
  if (profile !== 'rankings') return cols
  return cols.map((c) => (LIVE_HEADERS[c.key] ? { ...c, short: LIVE_HEADERS[c.key] } : c))
}

/*
  Shorter headings on the live ladder, and only there.

  Abbreviating is spent where it costs least. The two counts are a bare number in a narrow column
  and their headings were the widest thing in them, so they become initials; the honours and record
  columns keep their names, because "Trophies" and "Cups" side by side do not tell a reader which
  is a count of wins and which is a win-loss record, and that pair genuinely confused the table.

  Nothing is lost but the width: the full name stays in the tooltip and in the spoken label.

  The archive is deliberately untouched - it is a different table with its own column list, and it
  reads the same today as it did before any of this.
*/
const LIVE_HEADERS: Record<string, string> = {
  // Stacked onto two lines: a header carrying a newline sets its own width from the longer HALF,
  // so "Tournament W–L–D" stops being the widest thing on the table without losing a word of it.
  seasonRecord: 'Season\nW–L–D',
  cupRecord: 'Tournament\nW–L–D',
  seasonsPlayed: 'S',
  tournamentsPlayed: 'T',
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
  /**
   * Which of the four current-ranking scopes is showing.
   *
   * The scope decides WHICH RESULTS the ladder is built from -- all current CueVerse results, one
   * competition series, or every tournament -- and the page recomputes the aggregate for it. It is
   * not a row filter over one shared table: switching scope changes the population, the records and
   * the order.
   */
  scope: RankingScope
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
   * Which ranking universe is being looked at. On this page, permanently CueVerse.
   *
   * The two universes are produced by separate replays that never see each other's matches, so there
   * is deliberately no "all platforms" value -- a combined rating would describe a career nobody had.
   * The Yahoo ladder moved to a page of its own, so nothing here can select it any more; the field
   * stays because the aggregate has to be told which replay to read.
   */
  platform: CompetitionPlatform
  /** Inclusive competition-year bounds. Defaults span the whole archive. */
  fromYear: number
  toYear: number
  /**
   * Which table this is: the live ladder, or the Yahoo archive.
   *
   * Optional so every existing caller keeps working unchanged and means `rankings`, which is what
   * they were. It is not read from the URL — it is a property of the PAGE, not of the reader's
   * filters, and a query parameter that could turn /rankings into the archive would be a way to
   * show live data under an archive's rules.
   */
  profile?: TableProfile
  expanded: string | null
}

/**
 * How far the year range may reach, per profile.
 *
 * The live ladder runs to the current year, read from the clock. The archive runs to the year it
 * closed — reaching past that offers years the archive has no data for, and the filter chip then
 * reads "2010–2026" over a table whose last match was played in 2014, which is a claim the page
 * should not be making.
 */
export interface YearBounds { min: number; max: number }

/**
 * Optional columns, in the order they appear. Rank, Player and Rating are absent on purpose: they
 * are permanent, and a list that could express hiding them would eventually be asked to.
 */
/*
  Every column the live ladder OFFERS, in the order it draws them.

  Offered is not the same as on: `DEFAULT_VISIBLE_COLUMN_KEYS` below decides which of them start
  ticked. Conflating the two dropped the group and playoff splits out of More Filters altogether
  and broke saved links that named them - a column somebody deliberately chose has to stay
  choosable.

  Honours sit beside the record they came from rather than at the far right, because the question a
  reader arrives with is "who is winning" and a trophy answers it.

  The archive has its own list - see `optionalColumnKeys` - and is not affected by this order.
*/
export const OPTIONAL_COLUMN_KEYS = [
  'record', 'matchWinPct', 'currentStreak',
  'seasonTitles', 'tournamentTitles',
  'seasonRecord', 'cupRecord',
  'seasonsPlayed', 'tournamentsPlayed',
  'groupRecord', 'playoffRecord',
] as const

/*
  Which of them start ticked on the live ladder.

  All nine at once is what pushed the table past a maximised window and produced the horizontal
  scrollbar. The group and playoff splits are the two withheld: each is a breakdown of the overall
  record standing beside it, so the table says the same thing without them, and either is one tick
  away under More Filters for a reader who wants the split.
*/
export const DEFAULT_VISIBLE_COLUMN_KEYS: readonly string[] = [
  'record', 'matchWinPct', 'currentStreak',
  'seasonTitles', 'tournamentTitles',
  'seasonRecord', 'cupRecord',
  'seasonsPlayed', 'tournamentsPlayed',
]

/**
 * Which table this state describes.
 *
 * `rankings` is the live ladder at /rankings. `archive` is the Yahoo table at /yahoo, which is the
 * SAME component over different rows — so the difference has to be carried in the state rather than
 * guessed from the URL or from the shape of the data.
 *
 * It drives exactly two things, both of them facts about the archive rather than preferences:
 * which columns are offered, and how far the year range may reach. Everything else is identical,
 * which is the point of the two pages sharing one component.
 */
export type TableProfile = 'rankings' | 'archive'

/**
 * The archive's championship column stands where the live table's Tournament record stands.
 *
 * A swap rather than an addition. The archive has three Tournaments in its whole history, so a
 * Tournament W–L column there is nine-tenths dashes; the championship count is the figure a reader
 * of a closed archive actually wants, and it costs the same width.
 */
const ARCHIVE_COLUMN_SWAPS: Record<string, string> = { cupRecord: 'brcamTitles' }

/** Every optional column key any table offers, for validating a device-wide preference. */
const KNOWN_COLUMN_KEYS = new Set<string>([...OPTIONAL_COLUMN_KEYS, ...Object.values(ARCHIVE_COLUMN_SWAPS)])

/**
 * How many championships a row has, under a given profile.
 *
 * ── Why this is a function and not two expressions ──────────────────────────────────────────────
 * The table column and the rail's "Most championships" panel are two renderings of one fact, six
 * inches apart, and both look authoritative. If they compute it separately they will eventually
 * disagree — the rail summed Season and Tournament titles while the archive's column counted 8BRCAM
 * Season championships, which on the archive are different numbers for the same player.
 *
 * So there is one function, and both call it. Making them agree is not a matter of remembering to.
 */
export function championshipsOf(
  row: { seasonTitles: number; tournamentTitles: number; brcamSeasonTitles: number },
  profile: TableProfile = 'rankings',
): number {
  // The archive asks a narrower question, and its column says so in its heading.
  return profile === 'archive'
    ? row.brcamSeasonTitles
    : row.seasonTitles + row.tournamentTitles
}

/** What the rail should call that number, so the panel's label matches the column's. */
export function championshipsLabel(profile: TableProfile = 'rankings'): string {
  return profile === 'archive' ? 'Most 8BRCAM championships' : 'Most championships'
}

/**
 * The optional columns offered under a profile, in the order they appear.
 *
 * ── Why the archive reorders as well as swaps ───────────────────────────────────────────────────
 * Left where the Tournament record sat — tenth of twelve — the championship column fell off the
 * right edge at 1440 and 1280, which are ordinary laptop widths. A column somebody has to go looking
 * for is a column most readers never find, and on a closed archive the championship count is the
 * headline honour rather than a footnote.
 *
 * So it moves up beside Seasons Played, where "how many did they enter, and how many did they win"
 * reads as one thought. The record columns follow it and the remaining honours stay at the end.
 */
export function optionalColumnKeys(profile: TableProfile): readonly string[] {
  if (profile !== 'archive') return OPTIONAL_COLUMN_KEYS
  return [
    'record', 'matchWinPct', 'currentStreak',
    'seasonsPlayed', 'brcamTitles',
    'groupRecord', 'playoffRecord',
    'seasonTitles', 'tournamentTitles',
  ]
}

/**
 * The columns this profile starts with ticked.
 *
 * Separate from `optionalColumnKeys` so "is this table filtered" can be asked against the opening
 * position rather than against every column that exists. Measured against the full offered set, a
 * ladder nobody had touched would report two hidden columns and light up the More badge - the same
 * phantom filter the year control used to report, which is what teaches a reader to ignore both.
 */
export function defaultVisibleColumns(profile: TableProfile): readonly string[] {
  return profile === 'archive' ? optionalColumnKeys('archive') : DEFAULT_VISIBLE_COLUMN_KEYS
}

/** Whether a column choice is still the one the table opened with. */
function isDefaultColumns(s: RankingsState): boolean {
  const want = defaultVisibleColumns(s.profile ?? 'rankings')
  return s.visibleColumns.length === want.length && want.every((k) => s.visibleColumns.includes(k))
}

/** Always rendered, never offered as a checkbox. */
export const PERMANENT_COLUMN_KEYS = ['rank', 'player', 'rating'] as const

export function defaultState(now: Date = new Date(), options: StateOptions = {}): RankingsState {
  const bounds = yearBoundsFor(options, now)
  return {
    scope: DEFAULT_SCOPE,
    sort: [],
    /*
      The archive opens with everything it offers; the live ladder opens with the set that fits.
      Both stay fully adjustable - this is the opening position, not the menu.
    */
    visibleColumns: [...defaultVisibleColumns(options.profile ?? 'rankings')],
    rowFilters: { ...EMPTY_ROW_FILTERS },
    competitionSeriesId: null,
    seasonId: null,
    tournamentId: null,
    division: null,
    eventType: 'all',
    platform: 'CUEVERSE',
    fromYear: bounds.min,
    toYear: bounds.max,
    profile: options.profile,
    expanded: null,
  }
}

/** What a caller may tell the state about the table it belongs to. */
export interface StateOptions {
  profile?: TableProfile
  /**
   * The real bounds of the data behind this table.
   *
   * Supplied by the page rather than assumed here, because only the page knows them — the archive
   * reads its first and last year from the seasons it actually holds. Absent, the live ladder's
   * clock-derived bounds are used, which is what every existing caller wants.
   */
  years?: Partial<YearBounds>
}

export function yearBoundsFor(options: StateOptions, now: Date = new Date()): YearBounds {
  return {
    min: options.years?.min ?? MIN_YEAR,
    max: options.years?.max ?? maxYear(now),
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
/*
 * Columns that mean nothing on the Yahoo archive, and are therefore not offered there.
 *
 * `currentStreak` is a live measure - an archive career ended years ago, so its "current" run is a
 * fact about 2014.
 *
 * The two tournament columns are here because the Yahoo era has no standalone Tournaments: every
 * row reads 0-0 and 0, which is two columns of nothing occupying the width the group and playoff
 * records need. They remain available on the CueVerse ladder, where tournaments actually happen.
 */
const LIVE_ONLY_COLUMN_KEYS: readonly string[] = ['currentStreak', 'cupRecord', 'tournamentTitles']

/** Whether a column is offered at all under this scope. */
export function columnAppliesTo(key: string, platform: RankingsState['platform']): boolean {
  return !(platform === 'YAHOO' && LIVE_ONLY_COLUMN_KEYS.includes(key))
}

/** The keys actually rendered, permanent columns first and optional ones in canonical order. */
export function visibleColumnKeys(s: RankingsState): string[] {
  /*
    A column swapped in by the profile is visible when the column it REPLACED is.

    Otherwise every reader who had ever touched the column checkboxes would find the archive's
    championship column missing, because their saved preference names a key that did not exist when
    they saved it. Inheriting the predecessor's visibility means an existing preference keeps
    meaning what it meant.
  */
  const swappedFrom = new Map(Object.entries(ARCHIVE_COLUMN_SWAPS).map(([from, to]) => [to, from]))
  const optional = optionalColumnKeys(s.profile ?? 'rankings')
    .filter((k) => s.visibleColumns.includes(k) || s.visibleColumns.includes(swappedFrom.get(k) ?? ''))
    .filter((k) => columnAppliesTo(k, s.platform))
  return ['rank', 'player', 'rating', ...optional]
}

/**
 * Clamp a year into the archive's range.
 *
 * A pasted 1066 or 3000 is a typo, not a request for an empty table, so it is pulled to the nearest
 * real bound rather than rejected.
 */
export function clampYear(value: unknown, now: Date = new Date(), bounds?: YearBounds): number | null {
  // Absent is not zero. `Number(null)` and `Number('')` are both 0, which is finite and would clamp
  // to the first archived year — turning "no year given" into "the earliest year", and quietly
  // rewriting the default upper bound to 2005 on every plain page load.
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const lo = bounds?.min ?? MIN_YEAR
  const hi = bounds?.max ?? maxYear(now)
  return Math.min(Math.max(Math.trunc(n), lo), hi)
}

// --------------------------------------------------------------------------- serialisation

/**
 * Serialise state to a query string.
 *
 * Defaults are omitted, so a plain /rankings link stays clean and the absence of a parameter means
 * exactly what its default value means. Parameters are written in one canonical order so the same
 * view always produces the same URL and two shared links can be compared by eye.
 */
/**
 * A namespace for these parameters, so two things can own the word "season" in one URL.
 *
 * The archive page carries its own `season` -- which historical Season is open -- and the ladder on
 * the same page carries a Season FILTER. They are different questions with the same natural name, so
 * the ladder's keys are prefixed there (`rseason`, `rfrom`, ...) and the page keeps the bare ones.
 * The Rankings page passes no prefix and its URLs are unchanged.
 */
export type StateKeyPrefix = string

export function encodeRankingsState(s: RankingsState, now: Date = new Date(), prefix: StateKeyPrefix = ''): string {
  const K = (k: string) => prefix + k
  const p = new URLSearchParams()
  const d = defaultState(now)

  if (s.rowFilters.search.trim()) p.set(K('q'), s.rowFilters.search.trim())
  // The scope rides in the URL, so a shared link opens the ladder it was read in. The default is
  // omitted, which keeps a bare /rankings link clean and makes "no parameters" mean All.
  if (s.scope !== DEFAULT_SCOPE) p.set(K('scope'), s.scope)
  if (s.fromYear !== d.fromYear) p.set(K('from'), String(s.fromYear))
  if (s.toYear !== d.toYear) p.set(K('to'), String(s.toYear))
  if (s.competitionSeriesId != null) p.set(K('comp'), String(s.competitionSeriesId))
  if (s.eventType !== d.eventType) p.set(K('event'), s.eventType)
  if (s.seasonId != null) p.set(K('season'), String(s.seasonId))
  if (s.tournamentId != null) p.set(K('cup'), String(s.tournamentId))
  if (s.division) p.set(K('division'), s.division)
  if (s.rowFilters.activeOnly) p.set(K('active'), '1')
  if (s.rowFilters.entrantType !== 'all') p.set(K('type'), s.rowFilters.entrantType)
  if (s.rowFilters.seasonChampionsOnly) p.set(K('sc'), '1')
  if (s.rowFilters.cupChampionsOnly) p.set(K('tc'), '1')
  if (s.rowFilters.minMatches > 0) p.set(K('min'), String(s.rowFilters.minMatches))

  /*
    Only written when the choice differs from the one the table opened with, so the common case
    adds nothing to the URL.

    Against THIS table's DEFAULT set - not against every column it offers. The archive's set is not
    the live ladder's, and the live ladder no longer starts with all of them, so either mismatch
    writes a cols= parameter into a URL where the reader changed nothing.
  */
  const dfltCols = defaultVisibleColumns(s.profile ?? 'rankings')
  const offered = optionalColumnKeys(s.profile ?? 'rankings')
  const cols = offered.filter((k) => s.visibleColumns.includes(k))
  const isDflt = cols.length === dfltCols.length && dfltCols.every((k) => cols.includes(k))
  if (!isDflt) p.set(K('cols'), cols.join(','))

  if (s.sort.length) p.set(K('sort'), s.sort.map((x) => `${x.key}:${x.dir}`).join(','))
  if (s.expanded) p.set(K('expand'), s.expanded)

  return p.toString()
}

/**
 * Parameters the redesign removed.
 *
 * Kept as an explicit list so an old bookmark is IGNORED rather than crashing the page, and so the
 * fact that they were deliberately dropped is written down somewhere. Silently tolerating unknown
 * parameters would do the same job but would not say why.
 */
export const OBSOLETE_PARAMS = ['view', 'mode', 'density', 'preset', 'pins', 'compare', 'era', 'year', 'platform'] as const

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
  prefix: StateKeyPrefix = '',
  options: StateOptions = {},
): RankingsState {
  const raw = typeof input === 'string' ? new URLSearchParams(input) : input
  // One indirection, so every read below is namespaced without repeating the prefix at each call.
  const p = { get: (k: string) => raw.get(prefix + k), has: (k: string) => raw.has(prefix + k) }
  const s = defaultState(now, options)
  const bounds = yearBoundsFor(options, now)

  s.rowFilters.search = p.get('q') ?? ''
  s.scope = parseScope(p.get('scope'))
  /*
   * Always CueVerse, whatever the URL says.
   *
   * `?platform=yahoo` used to switch this table to the archive. That ladder now lives at /yahoo, and
   * an old link carrying the parameter must land on the current rankings rather than half-open a
   * page that no longer exists here -- so the parameter is ignored rather than honoured, which is
   * why it joins the obsolete list above.
   */
  s.platform = 'CUEVERSE'

  /*
    Clamped to the table's OWN bounds.

    A pasted or stale `to=2026` on the archive is pulled back to the year the archive closed rather
    than honoured — otherwise the chip announces a range the data cannot fill, and the "all time"
    preset never matches because the applied upper bound sits past the newest year on record.
  */
  const from = clampYear(p.get('from'), now, bounds)
  const to = clampYear(p.get('to'), now, bounds)
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
    s.visibleColumns = optionalColumnKeys(options.profile ?? 'rankings').filter((k) => asked.includes(k))
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
  if (!isDefaultColumns(s)) groups.push('columns')
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
        /*
          Either table's column set is acceptable here.

          This is a DEVICE preference, and the same device visits both the live ladder and the
          archive. Filtering to one table's keys would discard the other's every time the reader
          crossed between them, and their column choices would keep resetting.
        */
        .filter((k) => KNOWN_COLUMN_KEYS.has(k))
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
  /*
    The years THIS table spans, when they are not the live ladder's.

    Without it the archive's own full range — 2005 to the year it closed — was compared against the
    live ladder's default, which runs to the current year, and so produced a "Years: 2005–2014" chip
    on a table nobody had filtered. A chip is a statement that something has been narrowed; one that
    appears on an untouched table teaches the reader to ignore chips.
  */
  bounds?: YearBounds,
): FilterChip[] {
  const d = defaultState(now, bounds ? { years: bounds } : {})
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

  /*
    One chip for the whole column choice, however many boxes moved.

    Counted against the columns the table opened with, not against every column that exists: a
    reader who turns the playoff split back ON has changed the table but hidden nothing, and
    "Columns: 1 hidden" would be a straightforwardly false description of what they did.
  */
  if (!isDefaultColumns(s)) {
    const dflt = defaultVisibleColumns(s.profile ?? 'rankings')
    const hidden = dflt.filter((k) => !s.visibleColumns.includes(k)).length
    chips.push({ key: 'cols', label: hidden > 0 ? `Columns: ${hidden} hidden` : 'Columns: changed' })
  }

  return chips
}

/**
 * Remove one filter, returning the state it leaves behind.
 *
 * Each chip resets exactly its own group to the default — never the whole table — so removing
 * "Division: B" cannot silently also drop the year range somebody set.
 */
export function removeChip(
  s: RankingsState,
  key: string,
  now: Date = new Date(),
  /** Same reason as `activeChips`: removing the year chip must restore THIS table's whole span. */
  bounds?: YearBounds,
): RankingsState {
  const d = defaultState(now, bounds ? { years: bounds } : {})
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
    // Clearing a filter restores the default, which for columns is the opening set - not all of them.
    case 'cols': next.visibleColumns = [...defaultVisibleColumns(s.profile ?? 'rankings')]; break
    default: break
  }
  return next
}

/** Whether anything at all differs from the default table. Drives Clear All. */
export function hasAnyFilter(s: RankingsState, now: Date = new Date()): boolean {
  return activeFilterGroups(s, now).length > 0 || s.rowFilters.search.trim() !== ''
}
