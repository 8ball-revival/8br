import type { ExplorerRow } from './ladder-explorer'
import { completenessOf } from './rankings-facts'
import {
  COLUMN_BY_KEY, visibleColumnKeys, sortRows, filterRows, defaultState,
  type RankingsState,
} from './rankings-columns'

/**
 * CSV export of the Rankings table.
 *
 * Built from the same canonical rows the page renders, never from the DOM: scraping the table would
 * export whatever happened to be painted — the visible page of a long list, the formatted strings
 * rather than the values, and nothing at all for a column the reader had switched off.
 *
 * Pure, so the escaping rules can be tested without a request.
 */

/**
 * Escape one field for CSV, and defuse it as a spreadsheet formula.
 *
 * Two separate problems, and only the first is about CSV:
 *
 *   1. Quoting. A field containing a comma, a quote or a newline is wrapped in quotes with its own
 *      quotes doubled. Unicode needs nothing special beyond a BOM on the file so Excel reads UTF-8.
 *
 *   2. Formula injection. Excel, LibreOffice and Sheets execute a cell beginning `=`, `+`, `-`, `@`,
 *      tab or carriage return. A player whose chosen handle is `=cmd|'/c calc'!A1` is not
 *      necessarily an attacker, but the spreadsheet cannot tell, so the value is prefixed with a
 *      single quote — the standard "treat as text" marker, which every spreadsheet honours and
 *      which leaves the original text intact and readable.
 */
export function csvField(value: string | number | null | undefined): string {
  if (value == null) return ''
  let text = String(value)

  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`

  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function csvRow(fields: (string | number | null | undefined)[]): string {
  return fields.map(csvField).join(',')
}

/** Column headings that always appear, before whichever statistic columns are selected. */
const IDENTITY_HEADERS = ['Rank', 'Preferred Name', 'CueVerse ID', 'Historical Aliases', 'Data Completeness']

const COMPLETENESS_TEXT: Record<ReturnType<typeof completenessOf>, string> = {
  complete: 'Complete — match and game data',
  partial: 'Partial — some matches have no game score',
  'match-only': 'Match results only — no game scores',
  none: 'No recorded matches',
}

export interface CsvOptions {
  rows: ExplorerRow[]
  state: RankingsState
  /** Human-readable description of what was filtered, written into the file as a comment row. */
  filterSummary?: string
}

/**
 * Render the export.
 *
 * Preferred Name and CueVerse ID are separate columns rather than one formatted label, because a
 * spreadsheet is where someone sorts and matches on them. Historical aliases come along so an old
 * handle can still be reconciled against the current identity.
 *
 * Only public ranking statistics are included. Email, authentication fields, moderation state,
 * internal notes and staff-only data are not part of `ExplorerRow` at all, so they cannot leak here
 * by someone adding a column later.
 */
export function buildRankingsCsv({ rows, state, filterSummary }: CsvOptions): string {
  // Exactly the columns the reader had on screen. Rank and Player are dropped here because the
  // identity columns already carry them, in a form a spreadsheet can sort on.
  const keys = visibleColumnKeys(state).filter((k) => k !== 'rank' && k !== 'player')

  const filtered = filterRows(rows, state.rowFilters)
  const ordered = sortRows(filtered, state.sort)

  const lines: string[] = []

  // A provenance header, so a file that outlives this conversation still says what it is.
  lines.push(csvRow([`8 Ball Registry — Rankings export`]))
  const d = defaultState()
  const wholeArchive = state.fromYear === d.fromYear && state.toYear === d.toYear
  lines.push(csvRow([`Years`, wholeArchive ? `All time (${state.fromYear}–${state.toYear})` : `${state.fromYear}–${state.toYear}`]))
  if (filterSummary) lines.push(csvRow([`Filters`, filterSummary]))
  lines.push(csvRow([
    `Sort`,
    state.sort.length
      ? state.sort.map((s) => `${COLUMN_BY_KEY[s.key]?.label ?? s.key} ${s.dir}`).join(', ')
      : 'Official rank',
  ]))
  lines.push('')

  lines.push(csvRow([...IDENTITY_HEADERS, ...keys.map((k) => COLUMN_BY_KEY[k]?.label ?? k)]))

  for (const r of ordered) {
    lines.push(csvRow([
      r.rank,
      r.preferredName,
      r.cueverseId ?? '',
      r.aliases.join('; '),
      COMPLETENESS_TEXT[completenessOf(r)],
      ...keys.map((k) => {
        const col = COLUMN_BY_KEY[k]
        if (!col) return ''
        const v = col.value(r)
        return v == null ? '' : v
      }),
    ]))
  }

  return lines.join('\r\n')
}

/**
 * A filename that says what the file contains, so a folder of exports stays legible.
 * Restricted to characters every filesystem accepts.
 */
export function csvFilename(state: RankingsState, stamp: string): string {
  // The year range is in the name, so an all-time export and a 2010–2012 export do not arrive in
  // the same folder as two files nobody can tell apart.
  const d = defaultState()
  const wholeArchive = state.fromYear === d.fromYear && state.toYear === d.toYear
  const parts = ['8-ball-registry-rankings', wholeArchive ? 'all-time' : `${state.fromYear}-${state.toYear}`]
  if (state.eventType !== 'all') parts.push(state.eventType)
  if (state.competitionSeriesId != null) parts.push(`comp-${state.competitionSeriesId}`)
  if (state.division) parts.push(`division-${state.division}`)
  if (state.seasonId != null) parts.push(`season-${state.seasonId}`)
  if (state.tournamentId != null) parts.push(`cup-${state.tournamentId}`)
  parts.push(stamp)
  return `${parts.join('-').replace(/[^a-zA-Z0-9._-]/g, '-')}.csv`
}
