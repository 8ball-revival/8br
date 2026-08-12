/**
 * World Cue Championships — RANKING SERVICE. Three views, each answering a distinct question:
 *   - Current    — an INDEPENDENT Glicko-2 calc over ONLY the trailing 365 days
 *                  (who performed best in the last year). No lifetime carryover.
 *   - Historical — an INDEPENDENT Glicko-2 calc over ONLY the selected calendar year
 *                  (who performed best that year).
 *   - All-Time   — the persistent full-history timeline, ranked by highest ESTABLISHED
 *                  conservative rating (who's strongest across all history).
 * Plus a per-player provenance API so a profile can answer "why am I ranked here?".
 *
 * Titles are shown as context only and NEVER feed the rating (the engine is
 * match-based). Championship/placement bonuses are intentionally absent.
 */
import {
  getRatingTimeline,
  getCurrentTimeline,
  getHistoricalTimeline,
  ESTABLISHED_RD,
  MIN_ESTABLISHED_GAMES,
  type PlayerRating,
  type MatchResult,
  type PeakInfo,
} from './rating-engine'
import { getCurrentScoreForId, type ScoreLine } from './current-score'
import { getCups } from '@/lib/tournaments/service'
import { currentCupRevision } from '@/lib/tournaments/context'
import { resolveIdentity } from './identity'

export const WINDOW_DAYS = 365
const FORM_LEN = 5

export type Confidence = 'established' | 'provisional'

export interface RankingRow {
  rank: number
  id: string
  name: string
  resolved: boolean // false = identity not yet verified
  rating: number // headline R
  cr: number // conservative rating (ordering key)
  rd: number
  confidence: Confidence
  provisional: boolean
  wins: number
  losses: number
  draws: number
  gamesPlayed: number
  winPct: number // 0–100
  seasonsPlayed: number
  cupsPlayed: number
  titles: number // championships in this view's scope (context only)
  trend: number // rating change in the player's most recent period (in scope)
  recentForm: MatchResult[] // most-recent-first
  // All-Time only:
  peakRating?: number
  peakCR?: number
  peakAchievedAt?: PeakInfo | null
}

export interface RankingView {
  mode: 'current' | 'historical' | 'all-time'
  rows: RankingRow[]
  unranked?: RankingRow[] // e.g. All-Time players not yet established
  warnings: string[]
  provisionalDataset: boolean
  window?: { days: number; approximatedByYear: boolean; year: number }
  year?: number
}

// ---------- title index (context only; never affects rating) ----------------
type TitleRec = { year: number; kind: 'tournament' | 'cup' }
let _titles: Map<string, TitleRec[]> | null = null
let _titlesRev = -1
function titleIndex(): Map<string, TitleRec[]> {
  const rev = currentCupRevision()
  if (_titles && _titlesRev === rev) return _titles
  _titlesRev = rev
  const m = new Map<string, TitleRec[]>()
  const add = (slot: { name?: string | null; handle?: string | null } | null | undefined, year: number, kind: 'tournament' | 'cup') => {
    if (!slot || !slot.name) return
    const r = resolveIdentity(slot.handle, slot.name, { unknownAsSelf: true })
    if (!r) return
    const arr = m.get(r.id) ?? []
    arr.push({ year, kind })
    m.set(r.id, arr)
  }
  for (const c of getCups()) if (c.year) add(c.champion, c.year, 'cup')
  _titles = m
  return m
}

// ---------- helpers ----------------------------------------------------------
const seasonIdOf = (eventId: string) => (eventId.startsWith('cup') ? null : eventId.split(':')[0])
const cupIdOf = (eventId: string) => (eventId.startsWith('cup') ? eventId : null)

const isProvisional = (rd: number, games: number) => rd > ESTABLISHED_RD || games < MIN_ESTABLISHED_GAMES

/**
 * Build a ranking row from a player's timeline. The timeline is already scoped
 * (full / current-window / single-year), so we use its matchLog + history directly.
 * `rating/rd/cr` are passed in so All-Time can substitute peak values.
 */
function buildRow(
  p: PlayerRating,
  opts: { rating: number; rd: number; cr: number; titleYear?: number | 'all' },
): RankingRow {
  let wins = 0, losses = 0, draws = 0
  const seasons = new Set<string>()
  const cups = new Set<string>()
  for (const m of p.matchLog) {
    if (m.result === 'W') wins++
    else if (m.result === 'L') losses++
    else draws++
    const s = seasonIdOf(m.eventId)
    if (s) seasons.add(s)
    const c = cupIdOf(m.eventId)
    if (c) cups.add(c)
  }
  const played = wins + losses + draws
  const trend = p.history.length ? p.history[p.history.length - 1].delta : 0
  const recentForm = p.matchLog.slice(-FORM_LEN).reverse().map((m) => m.result)

  const titleRecs = titleIndex().get(p.id) ?? []
  const titles =
    opts.titleYear === 'all'
      ? titleRecs.length
      : opts.titleYear != null
        ? titleRecs.filter((t) => t.year === opts.titleYear).length
        : 0

  return {
    rank: 0,
    id: p.id,
    name: p.name,
    resolved: p.resolved,
    rating: opts.rating,
    cr: opts.cr,
    rd: opts.rd,
    confidence: isProvisional(opts.rd, played) ? 'provisional' : 'established',
    provisional: isProvisional(opts.rd, played),
    wins,
    losses,
    draws,
    gamesPlayed: played,
    winPct: played ? Math.round((wins / played) * 1000) / 10 : 0,
    seasonsPlayed: seasons.size,
    cupsPlayed: cups.size,
    titles,
    trend,
    recentForm,
  }
}

/** Competition ranking on CR: equal CR shares a rank, next rank skips. */
function assignRanks(rows: RankingRow[]): void {
  rows.sort((a, b) => b.cr - a.cr || b.rating - a.rating || b.gamesPlayed - a.gamesPlayed || a.name.localeCompare(b.name))
  rows.forEach((r, i) => {
    r.rank = i > 0 && r.cr === rows[i - 1].cr && r.rating === rows[i - 1].rating ? rows[i - 1].rank : i + 1
  })
}

// ---------- Current ----------------------------------------------------------
export function getCurrentRankings(now: Date = new Date()): RankingView {
  const currentYear = now.getFullYear()
  // Independent calc over ONLY the trailing-365-day matches (no lifetime carryover).
  const { players } = getCurrentTimeline(now)
  const rows: RankingRow[] = []
  for (const p of players.values()) {
    rows.push(buildRow(p, { rating: p.r, rd: p.rd, cr: p.cr, titleYear: currentYear }))
  }
  assignRanks(rows)

  const warnings: string[] = []
  warnings.push('Rolling window approximated by calendar year until events carry exact dates.')

  return {
    mode: 'current',
    rows,
    warnings,
    provisionalDataset: warnings.length > 0,
    window: { days: WINDOW_DAYS, approximatedByYear: true, year: currentYear },
  }
}

// ---------- Historical -------------------------------------------------------
export function getHistoricalRankings(year: number): RankingView {
  // Independent calc over ONLY that calendar year's matches (from a 1500 baseline).
  const { players } = getHistoricalTimeline(year)
  const rows: RankingRow[] = []
  for (const p of players.values()) {
    rows.push(buildRow(p, { rating: p.r, rd: p.rd, cr: p.cr, titleYear: year }))
  }
  assignRanks(rows)
  return { mode: 'historical', rows, warnings: [], provisionalDataset: false, year }
}

/** Completed calendar years available for the Historical view (newest first). */
export function getRankingYears(now: Date = new Date()): number[] {
  const { yearEndStates } = getRatingTimeline()
  return [...yearEndStates.keys()].filter((y) => y < now.getFullYear()).sort((a, b) => b - a)
}

// ---------- All-Time ---------------------------------------------------------
export function getAllTimeRankings(): RankingView {
  const { players } = getRatingTimeline()
  const rows: RankingRow[] = []
  const unranked: RankingRow[] = []
  for (const p of players.values()) {
    const base = buildRow(p, { rating: p.r, rd: p.rd, cr: p.cr, titleYear: 'all' })
    if (p.peakEstablishedCR != null) {
      rows.push({ ...base, cr: p.peakEstablishedCR, peakRating: p.peakR ?? undefined, peakCR: p.peakEstablishedCR, peakAchievedAt: p.peakAchievedAt })
    } else {
      unranked.push(base) // never met RD≤100 & ≥20 games — no qualifying all-time peak
    }
  }
  assignRanks(rows) // ranks by peak CR (placed into cr above)
  unranked.sort((a, b) => b.rating - a.rating)
  return { mode: 'all-time', rows, unranked, warnings: [], provisionalDataset: false }
}

// ---------- Per-player provenance --------------------------------------------
// The public "current" standing is the hybrid CURRENT SCORE (current-score.ts). The
// Glicko lifetime peak is retained as a secondary All-Time metric.
export interface RatingProfile {
  id: string
  name: string
  resolved: boolean
  inCurrentWindow: boolean
  // Current (rolling 365-day) hybrid score standing:
  score: number | null
  currentRank: number | null
  wins: number
  losses: number
  draws: number
  winPct: number
  groupRecord: { w: number; l: number; d: number }
  playoffRecord: { w: number; l: number }
  cupRecord: { w: number; l: number }
  seasonTitles: number
  cupTitles: number
  qualityWins: number
  recentForm: MatchResult[]
  trend: number
  scoreBreakdown: ScoreLine[]
  // All-Time (persistent Glicko timeline) — secondary metric:
  peakRating: number | null
  peakCR: number | null
  peakAchievedAt: PeakInfo | null
  bestYearEndRank: number | null
}

function bestYearEndRank(id: string): number | null {
  const { yearEndStates } = getRatingTimeline()
  let best: number | null = null
  for (const rows of yearEndStates.values()) {
    const ranked = [...rows].sort((a, b) => b.cr - a.cr)
    const idx = ranked.findIndex((r) => r.id === id)
    if (idx >= 0) {
      const rank = idx + 1
      if (best == null || rank < best) best = rank
    }
  }
  return best
}

export function getPlayerRankingProfile(id: string): RatingProfile | null {
  const persistent = getRatingTimeline().players.get(id) ?? null // All-Time / peaks
  const cur = getCurrentScoreForId(id) ?? null // rolling-window hybrid score
  const base = persistent ?? null
  if (!base && !cur) return null

  return {
    id: (persistent ?? cur)!.id,
    name: (persistent ?? cur)!.name,
    resolved: (persistent ?? cur)!.resolved,
    inCurrentWindow: !!cur,
    score: cur?.score ?? null,
    currentRank: cur?.rank ?? null,
    wins: cur?.wins ?? 0,
    losses: cur?.losses ?? 0,
    draws: cur?.draws ?? 0,
    winPct: cur?.winPct ?? 0,
    groupRecord: { w: cur?.groupW ?? 0, l: cur?.groupL ?? 0, d: cur?.groupD ?? 0 },
    playoffRecord: { w: cur?.playoffW ?? 0, l: cur?.playoffL ?? 0 },
    cupRecord: { w: cur?.cupW ?? 0, l: cur?.cupL ?? 0 },
    seasonTitles: cur?.seasonTitles ?? 0,
    cupTitles: cur?.cupTitles ?? 0,
    qualityWins: cur?.qualityWins ?? 0,
    recentForm: cur?.recentForm ?? [],
    trend: cur?.trend ?? 0,
    scoreBreakdown: cur?.breakdown ?? [],
    peakRating: persistent?.peakR ?? null,
    peakCR: persistent?.peakEstablishedCR ?? null,
    peakAchievedAt: persistent?.peakAchievedAt ?? null,
    bestYearEndRank: bestYearEndRank(id),
  }
}
