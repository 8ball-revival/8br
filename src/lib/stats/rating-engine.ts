/**
 * 8 Ball Revival — RANKING ENGINE (standard Glicko-2, persistent timeline).
 *
 * ONE continuous Glicko-2 timeline over every official match in history. A player
 * enters at 1500 the first time they appear and is NEVER reset again; every match
 * contributes chronologically. This module is a pure, deterministic function of the
 * official competition data (Seasons + Cups) — it stores nothing and is recomputed
 * whenever the underlying data changes.
 *
 * Design (agreed):
 *  - Standard Glicko-2 (R / RD / σ, τ=0.5). No custom recency decay — RD inflation
 *    from inactivity is the only aging mechanism.
 *  - Batch RATING PERIODS processed chronologically (group stage, playoffs, each cup),
 *    order-independent within a period.
 *  - Weighted games (Glicko-2 fractional-games extension): every match counts, but
 *    playoff/championship matches count more, and Tournament finals slightly more than Cup
 *    finals. Prestige is EARNED by winning high-stakes matches, not stamped on.
 *  - Team cups: only the individual board matches are rated — never the team result —
 *    so nobody gains rating from being carried.
 *  - Identity via the shared canonical resolver, so ratings agree with every other
 *    derived statistic.
 *
 * This module produces the raw timeline. Views (Current / Historical / All-Time) and
 * per-player provenance are assembled in rankings.ts on top of this.
 */
import { getAllArchiveSeasons } from '@/lib/seasons/archive'
import { getCups, type BracketRound, type Cup } from '@/lib/tournaments/service'
import { currentCupRevision } from '@/lib/tournaments/context'
import { resolveIdentity } from './identity'

// ---- Glicko-2 constants -----------------------------------------------------
export const BASE_R = 1500
export const BASE_RD = 350
export const BASE_VOL = 0.06
const TAU = 0.5
const SCALE = 173.7178
const CONV_EPS = 1e-6
/** RD at or below which a rating is considered "established" (for All-Time peaks). */
export const ESTABLISHED_RD = 100
/** Minimum rated matches for a peak to qualify for the All-Time ladder. */
export const MIN_ESTABLISHED_GAMES = 20

// ---- Competition weights ----------------------------------------------------
export const WEIGHTS = {
  group: 1.0,
  playoff: 1.5,
  seasonFinal: 2.0,
  cup: 1.25,
  cupFinal: 1.75,
} as const

// ---- Public shapes ----------------------------------------------------------
export type MatchResult = 'W' | 'L' | 'D'
export type PeriodKind = 'group' | 'playoff' | 'cup'

export interface MatchLogEntry {
  eventId: string
  eventLabel: string
  year: number
  kind: PeriodKind
  result: MatchResult
  opponentId: string
  opponentName: string
  weight: number
}

export interface PeriodEntry {
  eventId: string
  eventLabel: string
  year: number
  kind: PeriodKind
  played: number
  wins: number
  losses: number
  draws: number
  rBefore: number
  rAfter: number
  rdAfter: number
  crAfter: number // conservative rating after this period
  cumulativeGames: number // total rated matches through this period
  delta: number // rAfter - rBefore
}

export interface PeakInfo {
  eventLabel: string
  year: number
  gamesAtPeak: number
}

/** A player's end-of-year rating snapshot (for Historical views + peak-rank). */
export interface YearEndRow {
  id: string
  name: string
  resolved: boolean
  r: number
  rd: number
  cr: number
  games: number
  activeThisYear: boolean
}

export interface PlayerRating {
  id: string
  name: string
  resolved: boolean // false = identity not yet verified (still ranked, flagged)
  r: number // current rating
  rd: number // current rating deviation (uncertainty)
  sigma: number // current volatility
  cr: number // conservative rating = R - 2·RD (ordering key)
  firstYear: number
  lastYear: number
  lastEventLabel: string
  gamesPlayed: number
  wins: number
  losses: number
  draws: number
  peakR: number | null // highest rating reached while established (RD≤100 & ≥20 games)
  peakEstablishedCR: number | null // highest CR reached while established (All-Time)
  peakAchievedAt: PeakInfo | null // where/when peak established CR was reached
  activeYears: number[] // calendar years with ≥1 rated match
  history: PeriodEntry[] // per rating period the player participated in
  matchLog: MatchLogEntry[] // chronological, every rated match
}

export interface RatingTimeline {
  players: Map<string, PlayerRating>
  /** Ordered rating-period metadata, oldest → newest. */
  periods: { eventId: string; eventLabel: string; year: number; kind: PeriodKind }[]
  /** End-of-year rating snapshots of every entered player, keyed by year. */
  yearEndStates: Map<number, YearEndRow[]>
}

// ---- Internal working state -------------------------------------------------
interface State {
  id: string
  name: string
  resolved: boolean
  mu: number
  phi: number
  sigma: number
  entered: boolean
  firstYear: number
  lastYear: number
  lastEventLabel: string
  wins: number
  losses: number
  draws: number
  peakR: number | null
  peakEstablishedCR: number | null
  peakAchievedAt: PeakInfo | null
  activeYears: Set<number>
  history: PeriodEntry[]
  matchLog: MatchLogEntry[]
}

interface Game {
  aId: string
  aName: string
  aResolved: boolean
  bId: string
  bName: string
  bResolved: boolean
  sA: 0 | 0.5 | 1 // score for player a
  weight: number
}

interface Period {
  eventId: string
  eventLabel: string
  year: number
  date?: string // exact event date when known (enables true day-level rolling window)
  kind: PeriodKind
  order: number
  games: Game[]
}

// ---- Helpers ----------------------------------------------------------------
const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI))
const expectation = (mu: number, muJ: number, phiJ: number) =>
  1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)))

const isFinalRound = (name: string): boolean => {
  const n = name.toLowerCase()
  return (n.includes('final') || n.includes('grand')) && !n.includes('semi') && !n.includes('quarter')
}

type Slot = { name?: string | null; handle?: string | null } | null | undefined
function ident(slot: Slot): { id: string; name: string; resolved: boolean } | null {
  if (!slot || !slot.name || slot.name === 'Bye') return null
  const r = resolveIdentity(slot.handle, slot.name, { unknownAsSelf: true })
  if (!r) return null
  return { id: r.id, name: r.name, resolved: r.ok }
}

/** Solve for the new volatility with the Illinois algorithm (standard Glicko-2). */
function newVolatility(sigma: number, phi: number, v: number, delta: number): number {
  const a = Math.log(sigma * sigma)
  const f = (x: number): number => {
    const ex = Math.exp(x)
    const d2 = delta * delta
    const num = ex * (d2 - phi * phi - v - ex)
    const den = 2 * Math.pow(phi * phi + v + ex, 2)
    return num / den - (x - a) / (TAU * TAU)
  }
  let A = a
  let B: number
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v)
  } else {
    let k = 1
    while (f(a - k * TAU) < 0) k++
    B = a - k * TAU
  }
  let fA = f(A)
  let fB = f(B)
  let guard = 0
  while (Math.abs(B - A) > CONV_EPS && guard++ < 100) {
    const C = A + ((A - B) * fA) / (fB - fA)
    const fC = f(C)
    if (fC * fB <= 0) {
      A = B
      fA = fB
    } else {
      fA = fA / 2
    }
    B = C
    fB = fC
  }
  return Math.exp(A / 2)
}

// ---- Build the chronological list of rating periods -------------------------
function buildPeriods(): Period[] {
  const periods: Period[] = []

  // Seasons: group stage, then playoffs (two periods each), oldest first.
  for (const s of getAllArchiveSeasons()) {
    if (s.pending) continue
    const base = s.year * 1000 + s.period * 10
    const groupGames: Game[] = []
    const playoffGames: Game[] = []
    for (const d of s.divisions) {
      // group stage — pairwise results (winner null + equal scores = draw)
      for (const grp of d.groups ?? []) {
        for (const m of grp.matches ?? []) {
          const a = ident(m.a)
          const b = ident(m.b)
          if (!a || !b || a.id === b.id) continue // skip byes/unresolved + self-matches (merge artifacts)
          let sA: 0 | 0.5 | 1
          if (m.winner === 'a') sA = 1
          else if (m.winner === 'b') sA = 0
          else if (m.scoreA != null && m.scoreB != null && m.scoreA === m.scoreB) sA = 0.5
          else continue // unplayed / undecided
          groupGames.push({ aId: a.id, aName: a.name, aResolved: a.resolved, bId: b.id, bName: b.name, bResolved: b.resolved, sA, weight: WEIGHTS.group })
        }
      }
      // playoffs — single-elim rounds + double-elim brackets
      const rounds = [
        ...(d.playoff?.rounds ?? []),
        ...(d.doubleElim ? [...d.doubleElim.winners, ...d.doubleElim.losers] : []),
      ]
      for (const rd of rounds) {
        const w = isFinalRound(rd.name) ? WEIGHTS.seasonFinal : WEIGHTS.playoff
        for (const m of rd.matches) {
          if (!m.winner) continue
          const a = ident(m.a)
          const b = ident(m.b)
          if (!a || !b || a.id === b.id) continue // skip byes/unresolved + self-matches (merge artifacts)
          playoffGames.push({ aId: a.id, aName: a.name, aResolved: a.resolved, bId: b.id, bName: b.name, bResolved: b.resolved, sA: m.winner === 'a' ? 1 : 0, weight: w })
        }
      }
    }
    if (groupGames.length)
      periods.push({ eventId: `${s.tournamentId}:group`, eventLabel: `${s.label} · Group Stage`, year: s.year, kind: 'group', order: base, games: groupGames })
    if (playoffGames.length)
      periods.push({ eventId: `${s.tournamentId}:playoff`, eventLabel: `${s.label} · Playoffs`, year: s.year, kind: 'playoff', order: base + 1, games: playoffGames })
  }

  // Cups: one period each (bracket + team ties). Ordered after that year's seasons.
  for (const c of getCups()) {
    const year = c.year ?? 0
    const games: Game[] = []
    const rounds: BracketRound[] = [
      ...(c.bracket ?? []),
      ...(c.winnersBracket ?? []),
      ...(c.losersBracket ?? []),
      ...(c.grandFinal ?? []),
    ]
    for (const rd of rounds) {
      const w = isFinalRound(rd.name) ? WEIGHTS.cupFinal : WEIGHTS.cup
      for (const m of rd.matches) {
        if (!m.winner) continue
        const a = ident(m.a)
        const b = ident(m.b)
        if (!a || !b || a.id === b.id) continue // skip byes/unresolved + self-matches (merge artifacts)
        games.push({ aId: a.id, aName: a.name, aResolved: a.resolved, bId: b.id, bName: b.name, bResolved: b.resolved, sA: m.winner === 'a' ? 1 : 0, weight: w })
      }
    }
    for (const tie of c.teamTies ?? []) {
      const w = isFinalRound(tie.round) ? WEIGHTS.cupFinal : WEIGHTS.cup
      for (const m of tie.matches) {
        const a = ident(m.home)
        const b = ident(m.away)
        if (!a || !b || a.id === b.id) continue // skip byes/unresolved + self-matches (merge artifacts)
        const sA = boardWinner(m.homeScore, m.awayScore)
        if (sA == null) continue
        games.push({ aId: a.id, aName: a.name, aResolved: a.resolved, bId: b.id, bName: b.name, bResolved: b.resolved, sA, weight: w })
      }
    }
    if (games.length)
      periods.push({ eventId: `cup${c.number}`, eventLabel: cupLabel(c), year, date: c.date, kind: 'cup', order: year * 1000 + 900 + c.number, games })
  }

  periods.sort((a, b) => a.order - b.order)
  return periods
}

function cupLabel(c: Cup): string {
  return `${c.name}${c.year ? ` (${c.year})` : ''}`
}

/** Board result for a team-cup individual match, or null when undecidable. */
function boardWinner(homeScore?: string, awayScore?: string): 0 | 1 | null {
  const h = homeScore?.trim().toUpperCase()
  const a = awayScore?.trim().toUpperCase()
  if (h === 'W' && a !== 'W') return 1
  if (a === 'W' && h !== 'W') return 0
  const hn = Number(homeScore)
  const an = Number(awayScore)
  if (Number.isFinite(hn) && Number.isFinite(an) && hn !== an) return hn > an ? 1 : 0
  return null
}

// ---- Run the timeline -------------------------------------------------------
// Runs Glicko-2 from a fresh 1500 baseline over the GIVEN periods. The persistent
// (All-Time) timeline passes every period; the Current and Historical views pass a
// filtered subset so they are independent windowed calculations, not lifetime ratings.
function runGlicko(periods: Period[], trackYearEnd: boolean): RatingTimeline {
  const state = new Map<string, State>()
  const yearEndStates = new Map<number, YearEndRow[]>()

  const ensure = (id: string, name: string, resolved: boolean, year: number): State => {
    let st = state.get(id)
    if (!st) {
      st = {
        id, name, resolved,
        mu: 0, phi: BASE_RD / SCALE, sigma: BASE_VOL, entered: true,
        firstYear: year, lastYear: year, lastEventLabel: '',
        wins: 0, losses: 0, draws: 0, peakR: null, peakEstablishedCR: null,
        peakAchievedAt: null, activeYears: new Set(),
        history: [], matchLog: [],
      }
      state.set(id, st)
    }
    // Keep the most-recently-seen canonical display name; upgrade resolved once true.
    st.name = name
    if (resolved) st.resolved = true
    return st
  }

  for (let pi = 0; pi < periods.length; pi++) {
    const period = periods[pi]
    // Register everyone appearing this period.
    for (const g0 of period.games) {
      ensure(g0.aId, g0.aName, g0.aResolved, period.year)
      ensure(g0.bId, g0.bName, g0.bResolved, period.year)
    }

    // Snapshot pre-period ratings (opponent strength is evaluated at period start).
    const snap = new Map<string, { mu: number; phi: number }>()
    for (const st of state.values()) snap.set(st.id, { mu: st.mu, phi: st.phi })

    // Collect each player's games for this period.
    const perPlayer = new Map<string, { opp: string; s: number; w: number; oppName: string; result: MatchResult }[]>()
    const push = (id: string, opp: string, oppName: string, s: number, w: number) => {
      const arr = perPlayer.get(id) ?? []
      arr.push({ opp, s, w, oppName, result: s === 1 ? 'W' : s === 0 ? 'L' : 'D' })
      perPlayer.set(id, arr)
    }
    for (const gm of period.games) {
      push(gm.aId, gm.bId, gm.bName, gm.sA, gm.weight)
      push(gm.bId, gm.aId, gm.aName, 1 - gm.sA, gm.weight)
    }

    // Active players: batch Glicko-2 update from the snapshot.
    for (const [id, games] of perPlayer) {
      const st = state.get(id)!
      const s = snap.get(id)!
      let vInv = 0
      let dSum = 0
      for (const gp of games) {
        const o = snap.get(gp.opp)!
        const gg = g(o.phi)
        const E = expectation(s.mu, o.mu, o.phi)
        vInv += gp.w * gg * gg * E * (1 - E)
        dSum += gp.w * gg * (gp.s - E)
      }
      const rBefore = st.mu * SCALE + BASE_R
      if (vInv <= 0) continue
      const v = 1 / vInv
      const delta = v * dSum
      const sigma2 = newVolatility(st.sigma, s.phi, v, delta)
      const phiStar = Math.sqrt(s.phi * s.phi + sigma2 * sigma2)
      const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v)
      const muNew = st.mu + phiNew * phiNew * dSum

      st.mu = muNew
      st.phi = phiNew
      st.sigma = sigma2
      st.lastYear = period.year
      st.lastEventLabel = period.eventLabel
      st.activeYears.add(period.year)

      const rAfter = st.mu * SCALE + BASE_R
      const rdAfter = st.phi * SCALE
      let wins = 0, losses = 0, draws = 0
      for (const gp of games) {
        if (gp.result === 'W') wins++
        else if (gp.result === 'L') losses++
        else draws++
        st.matchLog.push({ eventId: period.eventId, eventLabel: period.eventLabel, year: period.year, kind: period.kind, result: gp.result, opponentId: gp.opp, opponentName: gp.oppName, weight: gp.w })
      }
      st.wins += wins; st.losses += losses; st.draws += draws
      const cumGames = st.wins + st.losses + st.draws
      const crAfter = rAfter - 2 * rdAfter
      st.history.push({ eventId: period.eventId, eventLabel: period.eventLabel, year: period.year, kind: period.kind, played: games.length, wins, losses, draws, rBefore: Math.round(rBefore), rAfter: Math.round(rAfter), rdAfter: Math.round(rdAfter), crAfter: Math.round(crAfter), cumulativeGames: cumGames, delta: Math.round(rAfter - rBefore) })

      // Peaks qualify only once the rating is established: RD ≤ 100 AND ≥ 20 games.
      if (rdAfter <= ESTABLISHED_RD && cumGames >= MIN_ESTABLISHED_GAMES) {
        if (st.peakR == null || rAfter > st.peakR) st.peakR = rAfter
        if (st.peakEstablishedCR == null || crAfter > st.peakEstablishedCR) {
          st.peakEstablishedCR = crAfter
          st.peakAchievedAt = { eventLabel: period.eventLabel, year: period.year, gamesAtPeak: cumGames }
        }
      }
    }

    // Inactive-but-entered players: RD inflates (standard Glicko-2 aging).
    for (const st of state.values()) {
      if (perPlayer.has(st.id)) continue
      const phi = snap.get(st.id)!.phi
      st.phi = Math.min(Math.sqrt(phi * phi + st.sigma * st.sigma), BASE_RD / SCALE)
    }

    // At each year boundary, snapshot every entered player's state (persistent only).
    if (trackYearEnd && (pi === periods.length - 1 || periods[pi + 1].year !== period.year)) {
      const rows: YearEndRow[] = []
      for (const st of state.values()) {
        const r = st.mu * SCALE + BASE_R
        const rd = st.phi * SCALE
        rows.push({ id: st.id, name: st.name, resolved: st.resolved, r: Math.round(r), rd: Math.round(rd), cr: Math.round(r - 2 * rd), games: st.wins + st.losses + st.draws, activeThisYear: st.activeYears.has(period.year) })
      }
      yearEndStates.set(period.year, rows)
    }
  }

  const players = new Map<string, PlayerRating>()
  for (const st of state.values()) {
    const r = st.mu * SCALE + BASE_R
    const rd = st.phi * SCALE
    players.set(st.id, {
      id: st.id, name: st.name, resolved: st.resolved,
      r: Math.round(r), rd: Math.round(rd), sigma: st.sigma, cr: Math.round(r - 2 * rd),
      firstYear: st.firstYear, lastYear: st.lastYear, lastEventLabel: st.lastEventLabel,
      gamesPlayed: st.wins + st.losses + st.draws, wins: st.wins, losses: st.losses, draws: st.draws,
      peakR: st.peakR != null ? Math.round(st.peakR) : null,
      peakEstablishedCR: st.peakEstablishedCR != null ? Math.round(st.peakEstablishedCR) : null,
      peakAchievedAt: st.peakAchievedAt,
      activeYears: [...st.activeYears].sort((a, b) => a - b),
      history: st.history, matchLog: st.matchLog,
    })
  }

  return {
    players,
    periods: periods.map((p) => ({ eventId: p.eventId, eventLabel: p.eventLabel, year: p.year, kind: p.kind })),
    yearEndStates,
  }
}

let _periods: Period[] | null = null
let _periodsRev = -1
function allPeriods(): Period[] {
  const rev = currentCupRevision()
  if (!_periods || _periodsRev !== rev) {
    _periodsRev = rev
    _periods = buildPeriods()
  }
  return _periods
}

/** True if a period falls inside the trailing 365-day window ending at `now`. */
function periodInCurrentWindow(p: Period, now: Date): boolean {
  if (p.date) {
    const d = new Date(p.date).getTime()
    return d <= now.getTime() && now.getTime() - d <= 365 * 24 * 60 * 60 * 1000
  }
  // No exact date yet: include only current-calendar-year events. Older year-only
  // events are excluded (we can't confirm they're within 365 days — no fabricated dates).
  return p.year === now.getFullYear()
}

let _cache: RatingTimeline | null = null
let _cacheRev = -1

/** The full persistent Glicko-2 timeline — used ONLY for All-Time (peaks) + provenance. */
export function getRatingTimeline(): RatingTimeline {
  const rev = currentCupRevision()
  if (!_cache || _cacheRev !== rev) {
    _cacheRev = rev
    _cache = runGlicko(allPeriods(), true)
  }
  return _cache
}

const _current = new Map<string, RatingTimeline>()
/**
 * CURRENT view — an independent Glicko-2 calculation from a 1500 baseline over ONLY
 * the matches inside the trailing 365-day window. No lifetime carryover; matches older
 * than the window contribute nothing. (Answers: who performed best in the last year.)
 */
export function getCurrentTimeline(now: Date): RatingTimeline {
  const key = `${currentCupRevision()}:${now.getFullYear()}`
  let tl = _current.get(key)
  if (!tl) {
    tl = runGlicko(allPeriods().filter((p) => periodInCurrentWindow(p, now)), false)
    _current.set(key, tl)
  }
  return tl
}

const _historical = new Map<number, RatingTimeline>()
/**
 * HISTORICAL view — an independent Glicko-2 calculation over ONLY the selected
 * calendar year's official matches, from a 1500 baseline. (Answers: who performed
 * best that year.)
 */
export function getHistoricalTimeline(year: number): RatingTimeline {
  let tl = _historical.get(year)
  if (!tl) {
    tl = runGlicko(allPeriods().filter((p) => p.year === year), false)
    _historical.set(year, tl)
  }
  return tl
}
