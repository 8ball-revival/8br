/** Normalization helpers. Raw values are always preserved separately; these only
 *  produce comparison/normalized forms — never mutate the source. */

export function toInt(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null
  const n = Number.parseInt(String(v), 10)
  return Number.isNaN(n) ? null : n
}

export function toFloat(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null
  const n = Number.parseFloat(String(v))
  return Number.isNaN(n) ? null : n
}

export function toBool(v) {
  return String(v).trim().toLowerCase() === 'true'
}

export function orNull(v) {
  const s = v == null ? '' : String(v).trim()
  return s === '' ? null : s
}

/** Lowercase, decode/strip HTML-entity artifacts, collapse whitespace — for MATCHING only. */
export function normalizeAlias(v) {
  if (v == null) return ''
  return String(v)
    .toLowerCase()
    .replace(/&#\d+;?/g, '') // numeric HTML entities e.g. &#174;
    .replace(/&[a-z]+;?/g, '') // named HTML entities e.g. &reg;
    .replace(/\s+/g, ' ')
    .trim()
}

/** Looser key for detecting near-duplicate display names (alnum only, lowercased). */
export function nameKey(v) {
  return normalizeAlias(v).replace(/[^a-z0-9]+/g, '')
}

/** Map the archive's champion_confidence string to a staging confidence level. */
export function championConfidence(v) {
  const s = (v || '').toLowerCase()
  if (s.includes('explicit')) return 'explicit'
  if (s.includes('heuristic')) return 'heuristic'
  if (s.includes('reconstruct')) return 'reconstructed'
  if (s.includes('disput')) return 'disputed'
  return 'unknown'
}

/** Map season_divisions completeness/status to a staging confidence. */
export function completenessConfidence(v) {
  const s = (v || '').toLowerCase()
  if (s === 'complete') return 'verified'
  if (s === 'partial') return 'incomplete'
  if (s === 'missing') return 'unknown'
  return 'unknown'
}
