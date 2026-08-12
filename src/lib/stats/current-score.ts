/**
 * World Cue Championships — CURRENT RANKINGS: stage-weighted performance score.
 *
 * Philosophy: the IMPORTANCE OF THE MATCH determines its value, not the number of matches
 * played. A single geometric ladder ranks every stage exactly:
 *   Tournament Final > TournamentView Final > Tournament SF > Tournament QF > TournamentView SF > TournamentView QF >
 *   Tournament playoff (other rounds) > Group match = early TournamentView round.
 * Points are earned by WINNING matches at their stage value. The group stage is a CAPPED,
 * match-count-INDEPENDENT qualifier (placement + win rate) so a long round-robin can never
 * overpower playoff success. Opponent quality is a moderate, hard-capped multiplier that
 * can never outweigh the stage. Every value lives in CONFIG. Pure function of official
 * tournaments. Seasons are single-elimination (legacy double-elim data still reads).
 *
 * (All-Time and Historical keep the Glicko engine; this drives ONLY the Current view.)
 */
import { getTournaments, type TournamentView } from '@/lib/tournaments/service'
import { currentTournamentRevision } from '@/lib/tournaments/context'
import { resolveIdentity } from './identity'
import type { MatchResult } from './rating-engine'

// ---- Tunable configuration --------------------------------------------------
export const CONFIG = {
  // Stage ladder: value(tier) = base * ratio^rank. One knob controls the whole hierarchy.
  base: 100,
  ratio: 0.72,
  group: {
    cap: 30, // max total group-stage contribution per tournament (a qualifier, not the event)
    placementWeight: 0.6,
    winRateWeight: 0.4,
  },
  loss: { base: 8 }, // flat per-loss penalty, scaled ONLY by opponent quality
  finalist: { tournament: 35, cup: 25 }, // reached the final but lost (softens champ↔runner-up)
  quality: {
    k: 0.25, // ±25% max swing — moderate; never overtakes the stage
    winMin: 0.85,
    winMax: 1.25,
    lossMin: 0.75,
    lossMax: 1.25,
    reigningChampWinFloor: 0.15, // beating a reigning champion is worth at least +15%
  },
  windowDays: 365,
  formLength: 5,
} as const

// Stage ladder derived from base + ratio (rank 0 = most important).
const V = (rank: number) => CONFIG.base * Math.pow(CONFIG.ratio, rank)
export const STAGE = {
  seasonFinal: V(0),
  cupFinal: V(1),
  seasonSemifinal: V(2),
  seasonQuarterfinal: V(3),
  cupSemifinal: V(4),
  cupQuarterfinal: V(5),
  seasonPlayoffOther: V(6),
  floor: V(7), // group match = early cup round
} as const

type Tier = 'early' | 'quarterfinal' | 'semifinal' | 'final'
const TIER_RANK: Record<Tier, number> = { early: 0, quarterfinal: 1, semifinal: 2, final: 3 }

function roundTier(name: string): Tier {
  const n = name.toLowerCase()
  if (n.includes('final') || n.includes('grand')) return 'final'
  if (n.includes('semi')) return 'semifinal'
  if (n.includes('quarter')) return 'quarterfinal'
  return 'early'
}
/** Points a WIN at this stage is worth. */
function stageValue(kind: 'tournament' | 'cup', tier: Tier): number {
  if (kind === 'tournament') {
    if (tier === 'final') return STAGE.seasonFinal
    if (tier === 'semifinal') return STAGE.seasonSemifinal
    if (tier === 'quarterfinal') return STAGE.seasonQuarterfinal
    return STAGE.seasonPlayoffOther
  }
  if (tier === 'final') return STAGE.cupFinal
  if (tier === 'semifinal') return STAGE.cupSemifinal
  if (tier === 'quarterfinal') return STAGE.cupQuarterfinal
  return STAGE.floor
}

// ---- Public shapes (unchanged — consumers depend on these) ------------------
export interface ScoreLine {
  label: string
  points: number
}
export interface CurrentScoreRow {
  rank: number
  id: string
  name: string
  resolved: boolean
  score: number
  wins: number
  losses: number
  draws: number
  winPct: number
  groupW: number
  groupL: number
  groupD: number
  playoffW: number
  playoffL: number
  cupW: number
  cupL: number
  seasonTitles: number
  cupTitles: number
  qualityWins: number
  recentForm: MatchResult[]
  trend: number
  breakdown: ScoreLine[]
  seasonPlayoffWins: number
}
export interface CurrentScoreView {
  rows: CurrentScoreRow[]
  warnings: string[]
  provisionalDataset: boolean
  window: { days: number; approximatedByYear: boolean; year: number }
}

// ---- Identity ---------------------------------------------------------------
type Slot = { name?: string | null; handle?: string | null } | null | undefined
function ident(slot: Slot): { id: string; name: string; resolved: boolean } | null {
  if (!slot || !slot.name || slot.name === 'Bye') return null
  const r = resolveIdentity(slot.handle, slot.name, { unknownAsSelf: true })
  return r ? { id: r.id, name: r.name, resolved: r.ok } : null
}
function boardWinner(homeScore?: string, awayScore?: string): 0 | 1 | null {
  const h = homeScore?.trim().toUpperCase()
  const a = awayScore?.trim().toUpperCase()
  if (h === 'W' && a !== 'W') return 1
  if (a === 'W' && h !== 'W') return 0
  const hn = Number(homeScore), an = Number(awayScore)
  if (Number.isFinite(hn) && Number.isFinite(an) && hn !== an) return hn > an ? 1 : 0
  return null
}

// ---- Working state ----------------------------------------------------------
interface Acc {
  id: string
  name: string
  resolved: boolean
  lines: Map<string, number> // base positive lines (label → points), quality-free
  qualityWinPts: number
  qualityWins: number
  lossPenalties: number // negative (quality-adjusted)
  groupW: number; groupL: number; groupD: number
  playoffW: number; playoffL: number
  cupW: number; cupL: number
  seasonTitles: number; cupTitles: number
  seasonPlayoffWins: number
  form: { order: number; result: MatchResult }[]
  h2h: Map<string, { w: number; l: number }>
}
interface EventMeta {
  id: string; label: string; order: number
  kind: 'tournament' | 'cup'
  champId: string | null; ruId: string | null; completed: boolean
}
// A single decided match, collected in pass 1 and re-scored for quality in pass 2.
interface MatchRec {
  winId: string; loseId: string
  kind: 'tournament' | 'cup'; value: number; label: string; order: number; eventId: string
}

/**
 * Finish-based TournamentView stage points — a function of HOW FAR a player advanced, NOT how many
 * matches the format required. Single- and double-elimination runs to the same finish
 * score identically, so extra losers-bracket matches can never inflate a ranking.
 */
function cupFinishStage(deepestTier: Tier, isChampion: boolean): number {
  if (isChampion) return STAGE.floor + STAGE.cupQuarterfinal + STAGE.cupSemifinal + STAGE.cupFinal
  if (deepestTier === 'final' || deepestTier === 'semifinal') return STAGE.floor + STAGE.cupQuarterfinal + STAGE.cupSemifinal
  if (deepestTier === 'quarterfinal') return STAGE.floor + STAGE.cupQuarterfinal
  return STAGE.floor
}

const withinWindow = (now: Date, year: number | undefined, date?: string): boolean => {
  if (date) {
    const d = new Date(date).getTime()
    return d <= now.getTime() && now.getTime() - d <= CONFIG.windowDays * 24 * 60 * 60 * 1000
  }
  return year === now.getFullYear()
}
const cupOrder = (c: TournamentView) => (c.year ?? 0) * 1000 + 900 + c.number

const _cache = new Map<string, CurrentScoreView>()
export function getCurrentScoreRankings(now: Date = new Date()): CurrentScoreView {
  const cacheKey = `${currentTournamentRevision()}:${now.toDateString()}`
  const cached = _cache.get(cacheKey)
  if (cached) return cached
  const view = computeCurrentScore(now)
  _cache.set(cacheKey, view)
  return view
}

function computeCurrentScore(now: Date): CurrentScoreView {
  const currentYear = now.getFullYear()
  const cups = getTournaments().filter((c) => withinWindow(now, c.year, c.date))

  // Reigning-champion index (earliest order at which a player became champion in-window).
  // The historical-season archive was removed in the WCC reset, so seasonChampAt stays empty
  // and reigning-champion bonuses now derive only from completed WCC tournaments (cupChampAt).
  const seasonChampAt = new Map<string, number>()
  const cupChampAt = new Map<string, number>()
  for (const c of cups) {
    if (c.status !== 'completed') continue
    const ch = ident(c.champion)
    if (ch) cupChampAt.set(ch.id, Math.min(cupChampAt.get(ch.id) ?? Infinity, cupOrder(c)))
  }

  const acc = new Map<string, Acc>()
  const get = (id: string, name: string, resolved: boolean): Acc => {
    let e = acc.get(id)
    if (!e) {
      e = { id, name, resolved, lines: new Map(), qualityWinPts: 0, qualityWins: 0, lossPenalties: 0, groupW: 0, groupL: 0, groupD: 0, playoffW: 0, playoffL: 0, cupW: 0, cupL: 0, seasonTitles: 0, cupTitles: 0, seasonPlayoffWins: 0, form: [], h2h: new Map() }
      acc.set(id, e)
    }
    e.name = name
    if (resolved) e.resolved = true
    return e
  }
  const addLine = (e: Acc, label: string, pts: number) => e.lines.set(label, (e.lines.get(label) ?? 0) + pts)
  const events: EventMeta[] = []
  const matches: MatchRec[] = []
  const deepest = new Map<string, Map<string, Tier>>()
  const setDeepest = (id: string, eventId: string, t: Tier) => {
    const m = deepest.get(id) ?? new Map<string, Tier>()
    if (!m.has(eventId) || TIER_RANK[t] > TIER_RANK[m.get(eventId)!]) m.set(eventId, t)
    deepest.set(id, m)
  }

  // ---- PASS 1: base points (stage wins + capped group + finalist), collect matches ----
  const recordMatch = (win: NonNullable<ReturnType<typeof ident>>, los: NonNullable<ReturnType<typeof ident>>, kind: 'tournament' | 'cup', tier: Tier, label: string, eventId: string, order: number) => {
    const we = get(win.id, win.name, win.resolved)
    const le = get(los.id, los.name, los.resolved)
    setDeepest(win.id, eventId, tier)
    setDeepest(los.id, eventId, tier)
    const value = stageValue(kind, tier)
    // Group stage: per-match stage (single-elim, bounded). Tournaments: stage is added finish-based
    // later (format-independent), so we do NOT add per-match cup stage here.
    if (kind === 'tournament') addLine(we, label, value)
    if (kind === 'tournament') { we.playoffW++; we.seasonPlayoffWins++; le.playoffL++ } else { we.cupW++; le.cupL++ }
    we.form.push({ order, result: 'W' }); le.form.push({ order, result: 'L' })
    we.h2h.set(los.id, { w: (we.h2h.get(los.id)?.w ?? 0) + 1, l: we.h2h.get(los.id)?.l ?? 0 })
    le.h2h.set(win.id, { w: le.h2h.get(win.id)?.w ?? 0, l: (le.h2h.get(win.id)?.l ?? 0) + 1 })
    matches.push({ winId: win.id, loseId: los.id, kind, value, label, order, eventId })
  }

  // Tournaments: per-match bracket + team ties.
  for (const c of cups) {
    const order = cupOrder(c)
    const ch = ident(c.champion), ru = ident(c.runnerUp)
    const eventId = `cup${c.number}`
    const label = cupLabel(c)
    events.push({ id: eventId, label, order, kind: 'cup', champId: ch?.id ?? null, ruId: ru?.id ?? null, completed: c.status === 'completed' })
    const bracket = [...(c.bracket ?? []), ...(c.winnersBracket ?? []), ...(c.losersBracket ?? []), ...(c.grandFinal ?? [])]
    for (const rd of bracket) {
      const tier = roundTier(rd.name)
      for (const m of rd.matches) {
        if (!m.winner) continue
        const a = ident(m.a), b = ident(m.b)
        if (!a || !b || a.id === b.id) continue
        recordMatch(m.winner === 'a' ? a : b, m.winner === 'a' ? b : a, 'cup', tier, label, eventId, order)
      }
    }
    for (const tie of c.teamTies ?? []) {
      const tier = roundTier(tie.round)
      for (const m of tie.matches) {
        const w = boardWinner(m.homeScore, m.awayScore)
        if (w == null) continue
        const home = ident(m.home), away = ident(m.away)
        if (!home || !away || home.id === away.id) continue
        recordMatch(w === 1 ? home : away, w === 1 ? away : home, 'cup', tier, label, eventId, order)
      }
    }
  }

  // Tournament finish (single-elim): title counts (final win already scored) + finalist bonus.
  for (const ev of events) {
    if (ev.kind !== 'tournament' || !ev.completed) continue
    if (ev.champId) { const e = acc.get(ev.champId); if (e) e.seasonTitles++ }
    if (ev.ruId) { const e = acc.get(ev.ruId); if (e) addLine(e, `${ev.label} — Finalist`, CONFIG.finalist.tournament) }
  }

  // TournamentView finish (format-independent): stage points by how far each player advanced, so a
  // double-elim losers-bracket run scores the same as reaching that finish in single-elim.
  for (const ev of events) {
    if (ev.kind !== 'cup') continue
    for (const [pid, evMap] of deepest) {
      const tier = evMap.get(ev.id)
      if (!tier) continue
      const e = acc.get(pid)
      if (!e) continue
      const isChampion = ev.completed && pid === ev.champId
      addLine(e, ev.label, cupFinishStage(tier, isChampion))
      if (isChampion) e.cupTitles++
    }
    if (ev.completed && ev.ruId) { const e = acc.get(ev.ruId); if (e) addLine(e, `${ev.label} — Finalist`, CONFIG.finalist.cup) }
  }

  // ---- Strength (percentile of base positive contributions) for opponent quality ----
  const basePositive = new Map<string, number>()
  for (const e of acc.values()) basePositive.set(e.id, [...e.lines.values()].reduce((s, v) => s + v, 0))
  const sortedIds = [...basePositive.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id)
  const strength = new Map<string, number>() // 0 (weakest) .. 1 (strongest)
  sortedIds.forEach((id, i) => strength.set(id, sortedIds.length > 1 ? i / (sortedIds.length - 1) : 0.5))
  const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

  // ---- PASS 2: opponent-quality (moderate, capped) ----
  // Seasons apply quality/loss per match. Tournaments dedupe by event so double-elim volume can't
  // stack: at most the single best quality win, and one elimination loss, per cup.
  const cupQualityBest = new Map<string, number>() // `${winId}|${eventId}` → best win bonus
  const cupLossSeen = new Set<string>() // `${loseId}|${eventId}`
  for (const m of matches) {
    const oppStrength = strength.get(m.loseId) ?? 0.5 // winner faced this strength
    let winMult = clamp(1 + CONFIG.quality.k * (2 * oppStrength - 1), CONFIG.quality.winMin, CONFIG.quality.winMax)
    const oppIsReigning = (seasonChampAt.get(m.loseId) ?? Infinity) < m.order || (cupChampAt.get(m.loseId) ?? Infinity) < m.order
    if (oppIsReigning) winMult = Math.max(winMult, 1 + CONFIG.quality.reigningChampWinFloor)
    const bonus = m.value * (winMult - 1)
    if (m.kind === 'tournament') {
      const we = acc.get(m.winId)
      if (we && bonus !== 0) { we.qualityWinPts += bonus; if (bonus > 0) we.qualityWins++ }
    } else {
      const key = `${m.winId}|${m.eventId}`
      const cur = cupQualityBest.get(key)
      if (cur === undefined || bonus > cur) cupQualityBest.set(key, bonus)
    }

    const winnerStrength = strength.get(m.winId) ?? 0.5 // loser lost to this strength
    const lossMult = clamp(1 + CONFIG.quality.k * (1 - 2 * winnerStrength), CONFIG.quality.lossMin, CONFIG.quality.lossMax)
    const pen = -CONFIG.loss.base * lossMult
    if (m.kind === 'tournament') {
      const le = acc.get(m.loseId)
      if (le) le.lossPenalties += pen
    } else {
      const key = `${m.loseId}|${m.eventId}`
      if (!cupLossSeen.has(key)) { cupLossSeen.add(key); const le = acc.get(m.loseId); if (le) le.lossPenalties += pen }
    }
  }
  // Apply the deduped best cup quality win per player per cup.
  for (const [key, bonus] of cupQualityBest) {
    if (bonus === 0) continue
    const we = acc.get(key.split('|')[0])
    if (we) { we.qualityWinPts += bonus; if (bonus > 0) we.qualityWins++ }
  }

  // ---- Finalise rows ----
  const rows: CurrentScoreRow[] = []
  for (const e of acc.values()) {
    const positives = [...e.lines.entries()].map(([label, points]) => ({ label, points: Math.round(points) }))
    positives.sort((a, b) => a.label.localeCompare(b.label))
    const breakdown: ScoreLine[] = [...positives]
    if (e.qualityWinPts) breakdown.push({ label: 'Quality Wins', points: Math.round(e.qualityWinPts) })
    if (e.lossPenalties) breakdown.push({ label: 'Loss Penalties', points: Math.round(e.lossPenalties) })
    const score = Math.round([...e.lines.values()].reduce((s, v) => s + v, 0) + e.qualityWinPts + e.lossPenalties)
    breakdown.push({ label: 'Total', points: score })
    const wins = e.groupW + e.playoffW + e.cupW
    const losses = e.groupL + e.playoffL + e.cupL
    const played = wins + losses + e.groupD
    const form = e.form.sort((a, b) => a.order - b.order).slice(-CONFIG.formLength).map((f) => f.result)
    const trend = form.reduce((s, r) => s + (r === 'W' ? 1 : r === 'L' ? -1 : 0), 0)
    rows.push({
      rank: 0, id: e.id, name: e.name, resolved: e.resolved, score,
      wins, losses, draws: e.groupD, winPct: played ? Math.round((wins / played) * 1000) / 10 : 0,
      groupW: e.groupW, groupL: e.groupL, groupD: e.groupD,
      playoffW: e.playoffW, playoffL: e.playoffL, cupW: e.cupW, cupL: e.cupL,
      seasonTitles: e.seasonTitles, cupTitles: e.cupTitles, qualityWins: e.qualityWins,
      recentForm: form.reverse(), trend, breakdown, seasonPlayoffWins: e.seasonPlayoffWins,
    })
  }

  // Order + tiebreakers (unchanged).
  const h2hById = new Map<string, Acc>()
  for (const e of acc.values()) h2hById.set(e.id, e)
  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.seasonPlayoffWins !== a.seasonPlayoffWins) return b.seasonPlayoffWins - a.seasonPlayoffWins
    if (b.seasonTitles !== a.seasonTitles) return b.seasonTitles - a.seasonTitles
    if (b.winPct !== a.winPct) return b.winPct - a.winPct
    if (b.qualityWins !== a.qualityWins) return b.qualityWins - a.qualityWins
    const ah = h2hById.get(a.id)?.h2h.get(b.id)
    const net = (ah?.w ?? 0) - (ah?.l ?? 0)
    if (net !== 0) return -net
    return a.name.localeCompare(b.name)
  })
  rows.forEach((r, i) => {
    const prev = rows[i - 1]
    const tiedWithPrev =
      i > 0 && prev.score === r.score && prev.seasonPlayoffWins === r.seasonPlayoffWins &&
      prev.seasonTitles === r.seasonTitles && prev.winPct === r.winPct && prev.qualityWins === r.qualityWins
    r.rank = tiedWithPrev ? prev.rank : i + 1
  })

  const warnings: string[] = []
  warnings.push('Group-stage points are a capped qualifier (placement + win rate), independent of how many group matches a format uses.')
  warnings.push('Rolling window approximated by calendar year until events carry exact dates.')
  return { rows, warnings, provisionalDataset: false, window: { days: CONFIG.windowDays, approximatedByYear: true, year: currentYear } }
}

function cupLabel(c: TournamentView): string {
  return `${c.name}${c.year ? ` (${c.year})` : ''}`
}

/** The score row + breakdown for a single canonical id (for profiles). */
export function getCurrentScoreForId(id: string, now: Date = new Date()): CurrentScoreRow | null {
  return getCurrentScoreRankings(now).rows.find((r) => r.id === id) ?? null
}
