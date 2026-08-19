/** Deterministic date formatting (fixed locale) to avoid hydration mismatches. */
export function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(d)
}

/** Deterministic date + time (UTC), for admin/audit displays. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(d)
}

export function formatPct(value?: number): string {
  if (value == null) return '—'
  return `${Math.round(value * 100)}%`
}

/** "2005-s1" → "2005 · Tournament 1"; falls back to the raw id if it doesn't match. */
export function formatArchiveSeason(tournamentId: string): string {
  const m = /^(\d{4})-s(\d+)$/.exec(tournamentId)
  return m ? `${m[1]} · Cup ${m[2]}` : tournamentId
}

/** Divisions in the archive are e.g. "single", "A", "B". Present them tidily. */
export function formatDivision(division: string): string {
  if (!division || division.toLowerCase() === 'single') return 'Single division'
  return `Division ${division}`
}
