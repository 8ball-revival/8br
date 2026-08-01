/**
 * Derived-value selectors for the player legacy profile. Pure functions over the
 * archive PlayerPreview shape — no data is invented; every helper degrades to a
 * safe null/"—"/honest-fallback when the underlying archive field is missing.
 * Keeping this logic out of JSX makes each profile section a thin presenter.
 */
import type {
  PlayerPreview,
  PreviewAlias,
  PreviewChampionship,
  PreviewCareer,
  PreviewHof,
} from '@/lib/preview-players'

const NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
]

/** Small-integer to word ("two"); falls back to digits above the table. */
export function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n)
}

/** "…-time" prefix for a count of titles ("two-time"); empty for a single title. */
function timesPrefix(n: number): string {
  if (n <= 1) return ''
  return `${numberWord(n)}-time `
}

/** "total_wins" → "Career Wins" (archive category slugs → display labels). */
export function prettyCategory(category: string): string {
  const overrides: Record<string, string> = {
    total_wins: 'Career Wins',
    total_matches: 'Total Matches',
    playoff_wins: 'Playoff Wins',
    finals_appearances: 'Finals Appearances',
    group_wins: 'Group Wins',
    seasons_played: 'Seasons Played',
    championships: 'Championships',
  }
  return (
    overrides[category] ??
    category.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
  )
}

/** "2008–2014", "2008", or null when the range is unknown. */
export function activeYears(p: Pick<PlayerPreview, 'firstYear' | 'lastYear'>): string | null {
  if (p.firstYear && p.lastYear) {
    return p.firstYear === p.lastYear ? `${p.firstYear}` : `${p.firstYear}–${p.lastYear}`
  }
  return p.firstYear ? `${p.firstYear}` : p.lastYear ? `${p.lastYear}` : null
}

export type ActivityStatus = 'inactive' | 'unknown'

/**
 * Honest activity status. The archive is a historical snapshot that ends in the
 * 2010s, so a player with a known last year is "Inactive" (last seen YYYY); with
 * no years at all it is "Unknown". We never claim "Active" — the data can't say so.
 */
export function activityStatus(p: Pick<PlayerPreview, 'lastYear'>): {
  status: ActivityStatus
  label: string
} {
  if (p.lastYear) return { status: 'inactive', label: `Inactive · last seen ${p.lastYear}` }
  return { status: 'unknown', label: 'Activity unknown' }
}

/** Championship entries (result === 'champion'). */
export function championshipSeasons(champs: PreviewChampionship[]): PreviewChampionship[] {
  return champs.filter((c) => c.result === 'champion')
}

/** Runner-up entries (result === 'runner-up'). */
export function runnerUpSeasons(champs: PreviewChampionship[]): PreviewChampionship[] {
  return champs.filter((c) => c.result === 'runner-up')
}

/**
 * Finals record derived from career totals: wins = championships, losses = the
 * remaining finals. Null when finals data is absent or inconsistent.
 */
export function finalsRecord(career: PreviewCareer | null): { wins: number; losses: number } | null {
  if (!career || career.finals == null || career.championships == null) return null
  const wins = career.championships
  const losses = Math.max(career.finals - career.championships, 0)
  return { wins, losses }
}

/** The single most common division across a player's championships (for labels). */
export function primaryDivision(champs: PreviewChampionship[]): string | null {
  if (champs.length === 0) return null
  const counts = new Map<string, number>()
  for (const c of champs) counts.set(c.division, (counts.get(c.division) ?? 0) + 1)
  let best: string | null = null
  let bestN = 0
  for (const [div, n] of counts) if (n > bestN) [best, bestN] = [div, n]
  return best
}

/**
 * Hall-of-Fame calibre, derived only from this player's own all-time placements:
 * any outright #1, or three-plus top-tier standings. Self-consistent with the
 * rankings shown on the page (no cross-referencing a separate list).
 */
export function isHallOfFame(hof: PreviewHof[]): boolean {
  if (hof.some((h) => h.rank === 1)) return true
  return hof.filter((h) => h.rank != null && h.rank <= 5).length >= 3
}

/**
 * A single, data-backed legacy label (or null). Priority mirrors the spec:
 * championships outrank finals, which outrank longevity. Never overstated.
 */
export function legacyClassification(p: PlayerPreview): string | null {
  const titles = p.career?.championships ?? championshipSeasons(p.championships).length
  if (titles >= 2) return 'Multi-Time Champion'
  if (titles === 1) return 'Former Champion'
  const finals = p.career?.finals ?? p.championships.length
  if (finals && finals > 0) return 'Finalist'
  const seasons = p.career?.seasonsPlayed ?? p.seasonHistory.length
  if (seasons && seasons >= 10) return 'Archive Veteran'
  return null
}

/** All-time placements sorted best-first, optionally capped. */
export function topRankings(hof: PreviewHof[], limit?: number): PreviewHof[] {
  const sorted = [...hof].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
  return limit ? sorted.slice(0, limit) : sorted
}

/** Highest (numerically lowest) all-time rank the player holds, or null. */
export function bestRank(hof: PreviewHof[]): number | null {
  const ranks = hof.map((h) => h.rank).filter((r): r is number => r != null)
  return ranks.length ? Math.min(...ranks) : null
}

/**
 * A factual, non-hyperbolic career summary sentence built from structured data.
 * Returns the honest fallback when there is nothing verifiable to summarise.
 */
export function careerSummary(p: PlayerPreview): string {
  const c = p.career
  if (!c || (c.totalWins == null && c.seasonsPlayed == null && c.championships == null)) {
    return 'No verified career summary has been added.'
  }

  const titles = c.championships ?? 0
  const div = primaryDivision(championshipSeasons(p.championships))
  // formatDivisionInline already carries its own trailing space.
  const divPhrase = div ? formatDivisionInline(div) : ''

  // Opening clause: champion framing when titled, plain competitor framing otherwise.
  let opening: string
  if (titles > 0) {
    opening = `${p.primaryName} is a ${timesPrefix(titles)}${divPhrase}champion`
  } else {
    opening = `${p.primaryName} is an archive competitor`
  }

  const parts: string[] = []
  if (c.totalWins != null) parts.push(`${c.totalWins} recorded ${c.totalWins === 1 ? 'win' : 'wins'}`)
  if (c.seasonsPlayed != null) parts.push(`across ${c.seasonsPlayed} ${c.seasonsPlayed === 1 ? 'season' : 'seasons'}`)
  let sentence = parts.length ? `${opening} with ${parts.join(' ')}` : opening

  // Finals appearances (only when they add information beyond the titles).
  if (c.finals != null && c.finals > titles) {
    sentence += `, reaching ${numberWord(c.finals)} ${c.finals === 1 ? 'final' : 'finals'}`
  }

  // All-time standing clause from the strongest placements.
  const elite = topRankings(p.hof).filter((h) => h.rank != null && h.rank <= 3)
  if (elite.length) {
    const best = Math.min(...elite.map((h) => h.rank as number))
    const cats = elite.slice(0, 2).map((h) => prettyCategory(h.category).toLowerCase())
    const catPhrase = cats.length === 2 ? `${cats[0]} and ${cats[1]}` : cats[0]
    sentence += `, ranking ${ordinalWord(best)} all-time in ${catPhrase}`
  }

  return `${sentence}.`
}

/** "A" → "Division A", "single" → "" (inline, no leading capital noise). */
function formatDivisionInline(division: string): string {
  if (!division || division.toLowerCase() === 'single') return ''
  return `Division ${division} `
}

/** "top-two", "top-three" style ordinal word for the summary sentence. */
function ordinalWord(rank: number): string {
  if (rank === 1) return 'first'
  return `top-${numberWord(rank)}`
}

export interface AliasGroup {
  type: string
  label: string
  aliases: string[]
}

const ALIAS_TYPE_LABEL: Record<string, string> = {
  'name/handle': 'Handles',
  handle: 'Handles',
  ym_id: 'Yahoo Messenger IDs',
  ym: 'Yahoo Messenger IDs',
  yahoo_messenger: 'Yahoo Messenger IDs',
  email: 'Emails',
  forum: 'Forum names',
  historical: 'Historical names',
}

function aliasTypeLabel(t: string): string {
  return ALIAS_TYPE_LABEL[t.toLowerCase()] ?? t.replace(/[_/]/g, ' ')
}

/**
 * Consolidates raw aliases into a clean public display: the primary handle is
 * pulled out, remaining aliases are de-duplicated (case-insensitively) within
 * each type group so the same call-sign isn't listed twice.
 */
export function consolidatedAliases(
  aliases: PreviewAlias[],
  primaryName: string,
): { primary: string; groups: AliasGroup[] } {
  const byType = new Map<string, Map<string, string>>() // type -> lowerAlias -> displayAlias
  for (const a of aliases) {
    if (a.alias === primaryName) continue
    const key = a.type
    if (!byType.has(key)) byType.set(key, new Map())
    const seen = byType.get(key)!
    const lower = a.alias.toLowerCase()
    if (!seen.has(lower)) seen.set(lower, a.alias)
  }

  const groups: AliasGroup[] = []
  for (const [type, seen] of byType) {
    groups.push({ type, label: aliasTypeLabel(type), aliases: [...seen.values()] })
  }
  // Handles first, then the rest alphabetically by label.
  groups.sort((a, b) => {
    const ah = a.label === 'Handles' ? 0 : 1
    const bh = b.label === 'Handles' ? 0 : 1
    return ah - bh || a.label.localeCompare(b.label)
  })

  return { primary: primaryName, groups }
}
