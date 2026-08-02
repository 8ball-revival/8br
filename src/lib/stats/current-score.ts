/**
 * 8 Ball Revival — CURRENT RANKINGS: transparent hybrid performance score.
 *
 * Current is NOT the Glicko ladder. It is a points model over official results in the
 * trailing 365-day window, weighted so that: Season Playoffs > Season Group Stage >
 * Cups, later playoff rounds are worth progressively more, and losses + opponent
 * quality both matter. Every value lives in CONFIG so it can be tuned without touching
 * the engine. Pure function of official Seasons + Cups — nothing stored.
 *
 * (All-Time and Historical keep the Glicko engine; this drives ONLY the Current view.)
 */
import { getAllArchiveSeasons, type ArchiveSeason } from '@/lib/seasons/archive'
import { getCups, type Cup } from '@/lib/cups/fixtures'
import { resolveIdentity } from './identity'
import type { MatchResult } from './rating-engine'

// ---- Tunable configuration --------------------------------------------------
export const CONFIG = {
  cup: {
    win: { early: 10, quarterfinal: 10, semifinal: 12, final: 15 },
    loss: { early: -4, quarterfinal: -4, semifinal: -5, final: -6 },
    finish: { champion: 35, runnerUp: 20, semifinal: 10, quarterfinal: 5 },
  },
  group: {
    win: 15,
    draw: 5,
    loss: -6,
    placement: [25, 18, 10, 5, 0], // 1st..4th, then 0 for 5th+
  },
  playoff: {
    win: { early: 20, quarterfinal: 25, semifinal: 32, final: 40 },
    loss: { early: -8, quarterfinal: -9, semifinal: -10, final: -10 },
    finish: { champion: 60, runnerUp: 35, semifinal: 18, quarterfinal: 8 },
  },
  quality: {
    beatSeasonChampion: 8,
    beatCupChampion: 5,
    lossToSeasonChampionFactor: 0.5, // keep 50% of the (negative) penalty
    lossToCupChampionFactor: 0.75, // keep 75% of the penalty
  },
  windowDays: 365,
  formLength: 5,
} as const

type Tier = 'early' | 'quarterfinal' | 'semifinal' | 'final'
const TIER_RANK: Record<Tier, number> = { early: 0, quarterfinal: 1, semifinal: 2, final: 3 }

function roundTier(name: string): Tier {
  const n = name.toLowerCase()
  if (n.includes('semi')) return 'semifinal'
  if (n.includes('quarter')) return 'quarterfinal'
  if (n.includes('final') || n.includes('grand')) return 'final'
  return 'early'
}

// ---- Public shapes ----------------------------------------------------------
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
  trend: number // net of recent form (wins − losses over last 5), for ▲/▼
  breakdown: ScoreLine[] // sums to `score`
  seasonPlayoffWins: number // tiebreaker
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
  lines: Map<string, number> // positive contribution lines (label → points)
  qualityWinPts: number
  qualityWins: number
  lossPenalties: number // negative
  groupW: number; groupL: number; groupD: number
  playoffW: number; playoffL: number
  cupW: number; cupL: number
  seasonTitles: number; cupTitles: number
  seasonPlayoffWins: number
  form: { order: number; result: MatchResult }[]
  h2h: Map<string, { w: number; l: number }>
}

interface EventMeta {
  id: string
  label: string
  order: number
  kind: 'season' | 'cup'
  champId: string | null
  ruId: string | null
  completed: boolean
}

// In-window when the exact date falls in the trailing 365 days; otherwise fall back to
// the current-calendar-year proxy (no fabricated dates for undated events).
const withinWindow = (now: Date, year: number | undefined, date?: string): boolean => {
  if (date) {
    const d = new Date(date).getTime()
    return d <= now.getTime() && now.getTime() - d <= CONFIG.windowDays * 24 * 60 * 60 * 1000
  }
  return year === now.getFullYear()
}
const seasonOrder = (s: ArchiveSeason) => s.year * 1000 + s.period * 10
const cupOrder = (c: Cup) => (c.year ?? 0) * 1000 + 900 + c.number

const _cache = new Map<string, CurrentScoreView>()
export function getCurrentScoreRankings(now: Date = new Date()): CurrentScoreView {
  const cacheKey = now.toDateString()
  const cached = _cache.get(cacheKey)
  if (cached) return cached
  const view = computeCurrentScore(now)
  _cache.set(cacheKey, view)
  return view
}

function computeCurrentScore(now: Date): CurrentScoreView {
  const currentYear = now.getFullYear()
  const seasons = getAllArchiveSeasons().filter((s) => !s.pending && withinWindow(now, s.year))
  const cups = getCups().filter((c) => withinWindow(now, c.year, c.date))

  // Pass A — titles earned inside the window (with the order of the winning event).
  const seasonChampAt = new Map<string, number>()
  const cupChampAt = new Map<string, number>()
  for (const s of seasons) {
    for (const d of s.divisions) {
      const ch = ident(d.champion)
      if (ch) seasonChampAt.set(ch.id, Math.min(seasonChampAt.get(ch.id) ?? Infinity, seasonOrder(s) + 1))
    }
  }
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
  const deepest = new Map<string, Map<string, Tier>>() // playerId → eventId → deepest tier
  const setDeepest = (id: string, eventId: string, t: Tier) => {
    const m = deepest.get(id) ?? new Map<string, Tier>()
    if (!m.has(eventId) || TIER_RANK[t] > TIER_RANK[m.get(eventId)!]) m.set(eventId, t)
    deepest.set(id, m)
  }
  const events: EventMeta[] = []

  // qualityAdjustedLoss: opp is the winner of the match the player lost.
  const qualityFactor = (oppId: string, order: number): number => {
    if ((seasonChampAt.get(oppId) ?? Infinity) < order) return CONFIG.quality.lossToSeasonChampionFactor
    if ((cupChampAt.get(oppId) ?? Infinity) < order) return CONFIG.quality.lossToCupChampionFactor
    return 1
  }
  const qualityWinBonus = (oppId: string, order: number): number => {
    if ((seasonChampAt.get(oppId) ?? Infinity) < order) return CONFIG.quality.beatSeasonChampion
    if ((cupChampAt.get(oppId) ?? Infinity) < order) return CONFIG.quality.beatCupChampion
    return 0
  }

  // Pass B — Seasons: group standings (aggregate) + playoff matches (per-match).
  for (const s of seasons) {
    const gLabel = `${s.label} — Group Stage`
    const pLabel = `${s.label} — Playoffs`
    const order = seasonOrder(s)
    for (const d of s.divisions) {
      const ch = ident(d.champion), ru = ident(d.runnerUp)
      events.push({ id: `${s.seasonId}:season`, label: s.label, order: order + 1, kind: 'season', champId: ch?.id ?? null, ruId: ru?.id ?? null, completed: true })

      // Group stage — from standings aggregate (works even without pairwise logs).
      for (const grp of d.groups ?? []) {
        grp.rows.forEach((row, i) => {
          if (row.wins + row.losses + row.draws === 0) return
          const r = ident(row)
          if (!r) return
          const e = get(r.id, r.name, r.resolved)
          const place = CONFIG.group.placement[i] ?? 0
          addLine(e, gLabel, row.wins * CONFIG.group.win + row.draws * CONFIG.group.draw + place)
          e.lossPenalties += row.losses * CONFIG.group.loss
          e.groupW += row.wins; e.groupL += row.losses; e.groupD += row.draws
        })
      }

      // Playoffs — per completed match, by round tier.
      const rounds = [
        ...(d.playoff?.rounds ?? []),
        ...(d.doubleElim ? [...d.doubleElim.winners, ...d.doubleElim.losers] : []),
      ]
      for (const rd of rounds) {
        const tier = roundTier(rd.name)
        for (const m of rd.matches) {
          if (!m.winner) continue
          const a = ident(m.a), b = ident(m.b)
          if (!a || !b || a.id === b.id) continue
          const win = m.winner === 'a' ? a : b
          const los = m.winner === 'a' ? b : a
          const we = get(win.id, win.name, win.resolved)
          const le = get(los.id, los.name, los.resolved)
          setDeepest(win.id, `${s.seasonId}:season`, tier)
          setDeepest(los.id, `${s.seasonId}:season`, tier)
          addLine(we, pLabel, CONFIG.playoff.win[tier])
          we.playoffW++; we.seasonPlayoffWins++
          const qb = qualityWinBonus(los.id, order + 1)
          if (qb) { we.qualityWinPts += qb; we.qualityWins++ }
          le.lossPenalties += CONFIG.playoff.loss[tier] * qualityFactor(win.id, order + 1)
          le.playoffL++
          we.form.push({ order: order + 1, result: 'W' }); le.form.push({ order: order + 1, result: 'L' })
          we.h2h.set(los.id, { w: (we.h2h.get(los.id)?.w ?? 0) + 1, l: we.h2h.get(los.id)?.l ?? 0 })
          le.h2h.set(win.id, { w: le.h2h.get(win.id)?.w ?? 0, l: (le.h2h.get(win.id)?.l ?? 0) + 1 })
        }
      }
    }
  }

  // Pass B — Cups: bracket + team-tie matches (per-match), finish only if completed.
  for (const c of cups) {
    const order = cupOrder(c)
    const ch = ident(c.champion), ru = ident(c.runnerUp)
    events.push({ id: `cup${c.number}`, label: cupLabel(c), order, kind: 'cup', champId: ch?.id ?? null, ruId: ru?.id ?? null, completed: c.status === 'completed' })
    const label = cupLabel(c)
    const bracketRounds = [...(c.bracket ?? []), ...(c.winnersBracket ?? []), ...(c.losersBracket ?? []), ...(c.grandFinal ?? [])]
    const record = (winSlot: ReturnType<typeof ident>, losSlot: ReturnType<typeof ident>, tier: Tier) => {
      if (!winSlot || !losSlot || winSlot.id === losSlot.id) return
      const we = get(winSlot.id, winSlot.name, winSlot.resolved)
      const le = get(losSlot.id, losSlot.name, losSlot.resolved)
      setDeepest(winSlot.id, `cup${c.number}`, tier)
      setDeepest(losSlot.id, `cup${c.number}`, tier)
      addLine(we, label, CONFIG.cup.win[tier])
      we.cupW++
      const qb = qualityWinBonus(losSlot.id, order)
      if (qb) { we.qualityWinPts += qb; we.qualityWins++ }
      le.lossPenalties += CONFIG.cup.loss[tier] * qualityFactor(winSlot.id, order)
      le.cupL++
      we.form.push({ order, result: 'W' }); le.form.push({ order, result: 'L' })
      we.h2h.set(losSlot.id, { w: (we.h2h.get(losSlot.id)?.w ?? 0) + 1, l: we.h2h.get(losSlot.id)?.l ?? 0 })
      le.h2h.set(winSlot.id, { w: le.h2h.get(winSlot.id)?.w ?? 0, l: (le.h2h.get(winSlot.id)?.l ?? 0) + 1 })
    }
    for (const rd of bracketRounds) {
      const tier = roundTier(rd.name)
      for (const m of rd.matches) {
        if (!m.winner) continue
        const a = ident(m.a), b = ident(m.b)
        record(m.winner === 'a' ? a : b, m.winner === 'a' ? b : a, tier)
      }
    }
    for (const tie of c.teamTies ?? []) {
      const tier = roundTier(tie.round)
      for (const m of tie.matches) {
        const w = boardWinner(m.homeScore, m.awayScore)
        if (w == null) continue
        const home = ident(m.home), away = ident(m.away)
        record(w === 1 ? home : away, w === 1 ? away : home, tier)
      }
    }
  }

  // Pass C — finish bonuses (highest reached per event, no stacking).
  for (const ev of events) {
    if (!ev.completed) continue
    const cfg = ev.kind === 'season' ? CONFIG.playoff.finish : CONFIG.cup.finish
    for (const [pid, evMap] of deepest) {
      const tier = evMap.get(ev.id)
      const e = acc.get(pid)
      if (!e) continue
      let bonus = 0
      if (pid === ev.champId) { bonus = cfg.champion; if (ev.kind === 'season') e.seasonTitles++; else e.cupTitles++ }
      else if (pid === ev.ruId) bonus = cfg.runnerUp
      else if (tier === 'semifinal') bonus = cfg.semifinal
      else if (tier === 'quarterfinal') bonus = cfg.quarterfinal
      if (bonus) addLine(e, `${ev.label} — Finish`, bonus)
    }
    // Champion/RU may not have appeared in a rated match (rare) — still credit them.
    for (const [pid, isChamp] of [[ev.champId, true], [ev.ruId, false]] as [string | null, boolean][]) {
      if (!pid) continue
      const e = acc.get(pid)
      if (!e) continue
      const already = (deepest.get(pid)?.has(ev.id)) ?? false
      if (already) continue
      const bonus = isChamp ? cfg.champion : cfg.runnerUp
      if (isChamp) { if (ev.kind === 'season') e.seasonTitles++; else e.cupTitles++ }
      addLine(e, `${ev.label} — Finish`, bonus)
    }
  }

  // Finalise rows.
  const rows: CurrentScoreRow[] = []
  for (const e of acc.values()) {
    const positives = [...e.lines.entries()].map(([label, points]) => ({ label, points }))
    positives.sort((a, b) => a.label.localeCompare(b.label))
    const breakdown: ScoreLine[] = [...positives]
    if (e.qualityWinPts) breakdown.push({ label: 'Quality Wins', points: e.qualityWinPts })
    if (e.lossPenalties) breakdown.push({ label: 'Loss Penalties', points: Math.round(e.lossPenalties) })
    const score = Math.round(positives.reduce((s, l) => s + l.points, 0) + e.qualityWinPts + e.lossPenalties)
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

  // Order + tiebreakers.
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
    if (net !== 0) return -net // a won the h2h → a ranks higher
    return a.name.localeCompare(b.name)
  })
  rows.forEach((r, i) => {
    // Joint rank only when genuinely tied on every ordered criterion.
    const prev = rows[i - 1]
    const tiedWithPrev =
      i > 0 && prev.score === r.score && prev.seasonPlayoffWins === r.seasonPlayoffWins &&
      prev.seasonTitles === r.seasonTitles && prev.winPct === r.winPct && prev.qualityWins === r.qualityWins
    r.rank = tiedWithPrev ? prev.rank : i + 1
  })

  const warnings: string[] = []
  for (const s of seasons) {
    const gapNoMatches = s.divisions.some(
      (d) => (d.groups ?? []).some((g) => g.rows.length > 0) && !(d.groups ?? []).some((g) => (g.matches ?? []).length > 0),
    )
    if (gapNoMatches)
      warnings.push(`Group-stage points for ${s.label} are computed from official standings (per-match group logs not yet imported, so group quality-win bonuses are unavailable there).`)
  }
  warnings.push('Rolling window approximated by calendar year until events carry exact dates; 2025 events (e.g. the 602 Invitational) are excluded until dated inside the window.')

  return { rows, warnings, provisionalDataset: warnings.length > 0, window: { days: CONFIG.windowDays, approximatedByYear: true, year: currentYear } }
}

function cupLabel(c: Cup): string {
  return `${c.name}${c.year ? ` (${c.year})` : ''}`
}

/** The score row + breakdown for a single canonical id (for profiles). */
export function getCurrentScoreForId(id: string, now: Date = new Date()): CurrentScoreRow | null {
  return getCurrentScoreRankings(now).rows.find((r) => r.id === id) ?? null
}
