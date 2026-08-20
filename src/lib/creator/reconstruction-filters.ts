/**
 * Filtering the historical reconstruction list.
 *
 * With 88 shells the Creator page stops being a list you read and becomes one you search, so this
 * decides what a filter means. Pure and dependency-free: the URL round trip is exactly the kind of
 * thing that quietly breaks on Back, and the only way to be sure is to test the encoding directly.
 *
 * ── Malformed input is not an error ──────────────────────────────────────────────────────────────
 * A URL is user input. Every parser here falls back to "no filter" rather than throwing, because a
 * hand-edited or stale query string should show an unfiltered list, not a crash.
 */

export type ProgressFilter =
  | 'not-started'
  | 'entrants-added'
  | 'groups-assigned'
  | 'results-partial'
  | 'ready-for-playoffs'
  | 'completed'

export type ArchiveFilter =
  | 'assignments-complete'
  | 'assignments-partial'
  | 'assignments-missing'
  | 'results-complete'
  | 'results-partial'
  | 'standings-only'
  | 'shared-source'
  | 'contradictions'

export const PROGRESS_OPTIONS: { id: ProgressFilter; label: string }[] = [
  { id: 'not-started', label: 'Not started' },
  { id: 'entrants-added', label: 'Entrants added' },
  { id: 'groups-assigned', label: 'Groups assigned' },
  { id: 'results-partial', label: 'Group results partial' },
  { id: 'ready-for-playoffs', label: 'Ready for playoffs' },
  { id: 'completed', label: 'Completed' },
]

export const ARCHIVE_OPTIONS: { id: ArchiveFilter; label: string }[] = [
  { id: 'assignments-complete', label: 'Complete group assignments' },
  { id: 'assignments-partial', label: 'Partial group assignments' },
  { id: 'assignments-missing', label: 'Missing group assignments' },
  { id: 'results-complete', label: 'Complete exact results' },
  { id: 'results-partial', label: 'Partial exact results' },
  { id: 'standings-only', label: 'Standings only' },
  { id: 'shared-source', label: 'Shared undivided source' },
  { id: 'contradictions', label: 'Source contradictions' },
]

export interface ReconstructionRow {
  id: number
  title: string
  year: number | null
  number: number | null
  division: string | null
  lifecycle: string
  href: string
  entrants: number
  groupsAssigned: number
  resultsEntered: number
  /** From the manifest: what the archive holds. */
  archiveParticipants: number
  archiveGroups: number
  archiveResults: number
  archiveAssignments: 'complete' | 'partial' | 'missing' | 'undivided-source'
  archiveExact: 'complete' | 'partial' | 'missing'
  sharedStage: boolean
  sharedStageMessage: string | null
  unresolvedCount: number
  ambiguousCount: number
  standingsOnly: boolean
}

export interface ReconstructionQuery {
  year: number | null
  division: 'A' | 'B' | null
  /** Matches the title or the Season number. */
  q: string | null
  progress: ProgressFilter | null
  archive: ArchiveFilter | null
}

export const EMPTY_QUERY: ReconstructionQuery = {
  year: null, division: null, q: null, progress: null, archive: null,
}

const one = (v: string | string[] | undefined): string | undefined =>
  typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined

/** Read a query from URL parameters, ignoring anything it does not recognise. */
export function parseQuery(params: Record<string, string | string[] | undefined>): ReconstructionQuery {
  const rawYear = one(params.year)
  const year = rawYear && /^\d{4}$/.test(rawYear) ? Number(rawYear) : null

  const rawDiv = (one(params.division) ?? '').toUpperCase()
  const division = rawDiv === 'A' || rawDiv === 'B' ? (rawDiv as 'A' | 'B') : null

  const q = (one(params.q) ?? '').trim() || null

  const rawProgress = one(params.progress)
  const progress = PROGRESS_OPTIONS.some((o) => o.id === rawProgress)
    ? (rawProgress as ProgressFilter)
    : null

  const rawArchive = one(params.archive)
  const archive = ARCHIVE_OPTIONS.some((o) => o.id === rawArchive)
    ? (rawArchive as ArchiveFilter)
    : null

  return { year, division, q, progress, archive }
}

/**
 * Turn a query back into a query string.
 *
 * Defaults are omitted, so an unfiltered list has a clean URL and the Back button does not walk
 * through a series of identical-looking states.
 */
export function encodeQuery(q: ReconstructionQuery): string {
  const p = new URLSearchParams()
  if (q.year != null) p.set('year', String(q.year))
  if (q.division) p.set('division', q.division)
  if (q.q) p.set('q', q.q)
  if (q.progress) p.set('progress', q.progress)
  if (q.archive) p.set('archive', q.archive)
  return p.toString()
}

export const hasAnyFilter = (q: ReconstructionQuery): boolean =>
  q.year != null || q.division != null || !!q.q || !!q.progress || !!q.archive

/**
 * Which progress step a shell has reached.
 *
 * Derived from what has actually been entered, never from the archive — a Season with a complete
 * template and no entrants has not started, however much source data exists behind it.
 */
export function progressOf(row: ReconstructionRow): ProgressFilter {
  if (row.lifecycle === 'COMPLETED') return 'completed'
  if (row.lifecycle === 'PLAYOFF_SETUP' || row.lifecycle === 'PLAYOFFS_LIVE' || row.lifecycle === 'GROUPS_CLOSED') {
    return 'ready-for-playoffs'
  }
  if (row.entrants === 0) return 'not-started'
  if (row.groupsAssigned === 0) return 'entrants-added'
  if (row.resultsEntered === 0) return 'groups-assigned'
  return 'results-partial'
}

function matchesArchive(row: ReconstructionRow, f: ArchiveFilter): boolean {
  switch (f) {
    case 'assignments-complete': return row.archiveAssignments === 'complete'
    case 'assignments-partial': return row.archiveAssignments === 'partial'
    case 'assignments-missing': return row.archiveAssignments === 'missing'
    case 'results-complete': return row.archiveExact === 'complete'
    case 'results-partial': return row.archiveExact === 'partial'
    case 'standings-only': return row.standingsOnly
    case 'shared-source': return row.sharedStage
    case 'contradictions': return row.ambiguousCount > 0
    default: return true
  }
}

export function applyQuery(rows: ReconstructionRow[], q: ReconstructionQuery): ReconstructionRow[] {
  const needle = q.q?.toLowerCase() ?? null
  return rows.filter((r) => {
    if (q.year != null && r.year !== q.year) return false
    if (q.division && r.division !== q.division) return false
    if (q.progress && progressOf(r) !== q.progress) return false
    if (q.archive && !matchesArchive(r, q.archive)) return false
    if (needle) {
      // The number matches on its own, so "5" finds Season 5 without typing the whole title.
      const hay = `${r.title} ${r.number ?? ''} ${r.year ?? ''}`.toLowerCase()
      if (!hay.includes(needle)) return false
    }
    return true
  })
}

/** The compact progress line shown on each row. */
export function progressSummary(row: ReconstructionRow): string[] {
  const out: string[] = []
  out.push(`${row.entrants} / ${row.archiveParticipants || '?'} entrants added`)

  out.push(
    row.sharedStage ? 'Shared group stage — Auto Assign unavailable'
    : row.archiveAssignments === 'complete' ? 'Archive groups ready'
    : row.archiveAssignments === 'partial' ? 'Archive groups partial'
    : 'No archive groups',
  )

  if (!row.sharedStage) {
    out.push(row.standingsOnly
      ? 'Standings only — no match scores'
      : `${row.resultsEntered} / ${row.archiveResults} group results entered`)
  }

  if (row.unresolvedCount > 0) {
    out.push(`${row.unresolvedCount} unresolved ${row.unresolvedCount === 1 ? 'handle' : 'handles'}`)
  }
  return out
}
