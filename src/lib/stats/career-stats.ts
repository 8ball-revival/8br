/**
 * Shared CAREER statistics service — the single source for every per-player total
 * shown publicly (profiles, /players, homepage spotlight, Hall of Fame standings).
 *
 * Everything is computed live from the authoritative Seasons archive
 * (`getAllArchiveSeasons()` — group play + playoffs) and Cups (`getCups()`), keyed
 * by the SAME canonical id space as season-stats (via `resolveIdentity`). No manual
 * totals, no hand-stored fixtures. If a value cannot be derived from Seasons/Cups it
 * is simply absent — legacy/Division-B/profile-fixture numbers never appear here.
 *
 * (The archive JSON already excludes purged Division B, so Div B contributes nothing
 * by construction — a player whose only title was Div B correctly computes to zero.)
 */
import {
  getAllArchiveSeasons,
  type SeasonDivision,
  type SeasonMatch,
} from '@/lib/seasons/archive'
import { getCups, type BracketRound } from '@/lib/cups/fixtures'
import { resolveIdentity } from './identity'
import { getSeasonRankings, resolveCanonicalId } from './season-stats'

export interface CareerSeasonEntry {
  seasonId: string
  division: string
  groupLetter: string | null
  groupWins: number | null
  groupLosses: number | null
  madePlayoffs: boolean
  playoffSeed: number | null
  result: string | null // "Champion" | "Runner-up" | "Semifinals" | … | null
}

export interface CareerH2H {
  opponentId: string
  opponentName: string
  matches: number
  wins: number
  losses: number
  lastSeason: string | null
}

export interface CareerStat {
  id: string
  name: string
  resolved: boolean
  seasonsPlayed: number
  groupWins: number
  groupLosses: number
  groupDraws: number
  playoffWins: number
  playoffLosses: number
  cupWins: number
  cupLosses: number
  totalMatches: number
  totalWins: number
  totalLosses: number
  totalWinPct: number // 0–100, one decimal
  seasonTitles: number
  seasonRunnerUps: number
  finals: number // season titles + season runner-ups
  semifinals: number
  playoffAppearances: number
  cupTitles: number
  cupRunnerUps: number
  longestTitleStreak: number
  seasonHistory: CareerSeasonEntry[]
  headToHead: CareerH2H[]
  titleRank: number | null // all-time rank by Season championships (season-stats)
  winsRank: number | null // all-time rank by total career wins
}

interface Acc {
  id: string
  name: string
  resolved: boolean
  seasons: Set<string>
  groupWins: number
  groupLosses: number
  groupDraws: number
  playoffWins: number
  playoffLosses: number
  cupWins: number
  cupLosses: number
  seasonTitles: number
  seasonRunnerUps: number
  semifinals: number
  playoffSeasons: Set<string>
  cupTitles: number
  cupRunnerUps: number
  titleSeasonOrdinals: number[]
  history: Map<string, CareerSeasonEntry>
  h2h: Map<string, { name: string; wins: number; losses: number; last: string | null }>
}

type Slot = { name?: string | null; handle?: string | null } | null | undefined

function resolve(slot: Slot) {
  if (!slot || !(slot.handle || slot.name)) return null
  return resolveIdentity(slot.handle, slot.name, { unknownAsSelf: false })
}

function playoffMatches(d: SeasonDivision): SeasonMatch[] {
  const out: SeasonMatch[] = []
  if (d.playoff?.rounds) for (const r of d.playoff.rounds) out.push(...r.matches)
  if (d.doubleElim) {
    for (const r of d.doubleElim.winners) out.push(...r.matches)
    for (const r of d.doubleElim.losers) out.push(...r.matches)
  }
  return out
}

/** Winner/loser of a team-cup individual match, or null when undecidable. */
function tieWinner(homeScore?: string, awayScore?: string): 'home' | 'away' | null {
  const h = homeScore?.trim().toUpperCase()
  const a = awayScore?.trim().toUpperCase()
  if (h === 'W' && a !== 'W') return 'home'
  if (a === 'W' && h !== 'W') return 'away'
  const hn = Number(homeScore)
  const an = Number(awayScore)
  if (Number.isFinite(hn) && Number.isFinite(an) && hn !== an) return hn > an ? 'home' : 'away'
  return null
}

function computeCareers(): Map<string, CareerStat> {
  const acc = new Map<string, Acc>()
  const get = (id: string, name: string, resolved: boolean): Acc => {
    let e = acc.get(id)
    if (!e) {
      e = {
        id, name, resolved,
        seasons: new Set(), groupWins: 0, groupLosses: 0, groupDraws: 0,
        playoffWins: 0, playoffLosses: 0, cupWins: 0, cupLosses: 0,
        seasonTitles: 0, seasonRunnerUps: 0, semifinals: 0, playoffSeasons: new Set(),
        cupTitles: 0, cupRunnerUps: 0, titleSeasonOrdinals: [],
        history: new Map(), h2h: new Map(),
      }
      acc.set(id, e)
    }
    if (!resolved) e.resolved = false
    return e
  }
  const recordH2H = (a: Acc, oppId: string, oppName: string, win: boolean, season: string | null) => {
    const e = a.h2h.get(oppId) ?? { name: oppName, wins: 0, losses: 0, last: null }
    if (win) e.wins += 1
    else e.losses += 1
    if (season) e.last = season
    a.h2h.set(oppId, e)
  }

  const seasons = getAllArchiveSeasons()
    .slice()
    .sort((a, b) => a.year - b.year || a.period - b.period)
  const ordinalOf = new Map<string, number>()
  seasons.forEach((s, i) => ordinalOf.set(s.seasonId, i))

  for (const season of seasons) {
    for (const d of season.divisions) {
      const champ = resolve(d.champion)
      const ru = resolve(d.runnerUp)

      // ---- Group play (aggregate standings) ----
      for (const g of d.groups ?? []) {
        for (const row of g.rows) {
          const r = resolve(row)
          if (!r) continue
          const e = get(r.id, r.name, r.ok)
          e.groupWins += row.wins
          e.groupLosses += row.losses
          e.groupDraws += row.draws
          e.seasons.add(season.seasonId)
          const h = e.history.get(season.seasonId)
          const entry: CareerSeasonEntry = h ?? {
            seasonId: season.seasonId, division: d.division, groupLetter: g.letter,
            groupWins: 0, groupLosses: 0, madePlayoffs: false, playoffSeed: null, result: null,
          }
          entry.groupLetter = g.letter
          entry.groupWins = (entry.groupWins ?? 0) + row.wins
          entry.groupLosses = (entry.groupLosses ?? 0) + row.losses
          e.history.set(season.seasonId, entry)
        }
      }

      // ---- Playoffs (per-match W/L, appearances, H2H, deepest round) ----
      const deepest = new Map<string, string>() // id -> round name reached
      const seenPlayoff = new Set<string>()
      const roundsList = [
        ...(d.playoff?.rounds ?? []),
        ...(d.doubleElim ? [...d.doubleElim.winners, ...d.doubleElim.losers] : []),
      ]
      for (const round of roundsList) {
        for (const m of round.matches) {
          for (const slot of [m.a, m.b]) {
            const r = resolve(slot)
            if (r && slot?.name !== 'Bye') { deepest.set(r.id, round.name); seenPlayoff.add(r.id) }
          }
        }
      }
      for (const m of playoffMatches(d)) {
        const { a, b, winner } = m
        if (!a || !b || !winner) continue
        if (a.name === 'Bye' || b.name === 'Bye') continue
        const win = winner === 'a' ? a : b
        const los = winner === 'a' ? b : a
        const rw = resolve(win)
        const rl = resolve(los)
        if (rw) { const e = get(rw.id, rw.name, rw.ok); e.playoffWins += 1; e.seasons.add(season.seasonId) }
        if (rl) { const e = get(rl.id, rl.name, rl.ok); e.playoffLosses += 1; e.seasons.add(season.seasonId) }
        if (rw && rl) {
          recordH2H(get(rw.id, rw.name, rw.ok), rl.id, rl.name, true, season.seasonId)
          recordH2H(get(rl.id, rl.name, rl.ok), rw.id, rw.name, false, season.seasonId)
        }
      }
      for (const id of seenPlayoff) {
        const e = acc.get(id)!
        e.playoffSeasons.add(season.seasonId)
        const entry = e.history.get(season.seasonId) ?? {
          seasonId: season.seasonId, division: d.division, groupLetter: null,
          groupWins: null, groupLosses: null, madePlayoffs: false, playoffSeed: null, result: null,
        }
        entry.madePlayoffs = true
        const round = (deepest.get(id) ?? '').toLowerCase()
        let result: string | null = null
        if (champ && champ.id === id) result = 'Champion'
        else if (ru && ru.id === id) result = 'Runner-up'
        else if (round.includes('semi')) { result = 'Semifinals'; e.semifinals += 1 }
        else if (round.includes('quarter')) result = 'Quarterfinals'
        else if (round) result = 'Playoffs'
        entry.result = result
        e.history.set(season.seasonId, entry)
      }

      // ---- Titles ----
      if (champ) {
        const e = get(champ.id, champ.name, champ.ok)
        e.seasonTitles += 1
        const ord = ordinalOf.get(season.seasonId)
        if (ord != null) e.titleSeasonOrdinals.push(ord)
      }
      if (ru) get(ru.id, ru.name, ru.ok).seasonRunnerUps += 1
    }
  }

  // ---- Cups (match W/L + titles; bracket + team formats) ----
  for (const c of getCups()) {
    if (c.status !== 'completed') continue
    const rounds: BracketRound[] = [
      ...(c.bracket ?? []), ...(c.winnersBracket ?? []),
      ...(c.losersBracket ?? []), ...(c.grandFinal ?? []),
    ]
    for (const round of rounds) {
      for (const m of round.matches) {
        const a = m.a, b = m.b
        if (!a?.name || !b?.name || a.name === 'Bye' || b.name === 'Bye' || !m.winner) continue
        const win = m.winner === 'a' ? a : b
        const los = m.winner === 'a' ? b : a
        const rw = resolve(win)
        const rl = resolve(los)
        if (rw) get(rw.id, rw.name, rw.ok).cupWins += 1
        if (rl) get(rl.id, rl.name, rl.ok).cupLosses += 1
      }
    }
    for (const t of c.teamTies ?? []) {
      for (const m of t.matches) {
        const w = tieWinner(m.homeScore, m.awayScore)
        if (!w) continue
        const win = w === 'home' ? m.home : m.away
        const los = w === 'home' ? m.away : m.home
        const rw = resolve(win)
        const rl = resolve(los)
        if (rw) get(rw.id, rw.name, rw.ok).cupWins += 1
        if (rl) get(rl.id, rl.name, rl.ok).cupLosses += 1
      }
    }
    const champ = resolve(c.champion)
    const ru = resolve(c.runnerUp)
    if (champ) get(champ.id, champ.name, champ.ok).cupTitles += 1
    if (ru) get(ru.id, ru.name, ru.ok).cupRunnerUps += 1
  }

  // ---- Finalise + ranks ----
  const titleRankById = new Map<string, number>()
  for (const p of getSeasonRankings()) titleRankById.set(p.id, p.rank)

  const stats = new Map<string, CareerStat>()
  for (const e of acc.values()) {
    const totalWins = e.groupWins + e.playoffWins + e.cupWins
    const totalLosses = e.groupLosses + e.playoffLosses + e.cupLosses
    const totalMatches = totalWins + totalLosses + e.groupDraws
    // longest run of globally-consecutive title seasons
    const ords = [...new Set(e.titleSeasonOrdinals)].sort((a, b) => a - b)
    let streak = ords.length ? 1 : 0
    let run = streak
    for (let i = 1; i < ords.length; i++) {
      run = ords[i] === ords[i - 1] + 1 ? run + 1 : 1
      if (run > streak) streak = run
    }
    const h2h: CareerH2H[] = [...e.h2h.entries()]
      .map(([oid, v]) => ({ opponentId: oid, opponentName: v.name, matches: v.wins + v.losses, wins: v.wins, losses: v.losses, lastSeason: v.last }))
      .sort((a, b) => b.matches - a.matches || b.wins - a.wins)
    const history = [...e.history.values()].sort((a, b) => b.seasonId.localeCompare(a.seasonId))

    stats.set(e.id, {
      id: e.id, name: e.name, resolved: e.resolved,
      seasonsPlayed: e.seasons.size,
      groupWins: e.groupWins, groupLosses: e.groupLosses, groupDraws: e.groupDraws,
      playoffWins: e.playoffWins, playoffLosses: e.playoffLosses,
      cupWins: e.cupWins, cupLosses: e.cupLosses,
      totalMatches, totalWins, totalLosses,
      totalWinPct: totalWins + totalLosses ? Math.round((totalWins / (totalWins + totalLosses)) * 1000) / 10 : 0,
      seasonTitles: e.seasonTitles, seasonRunnerUps: e.seasonRunnerUps,
      finals: e.seasonTitles + e.seasonRunnerUps,
      semifinals: e.semifinals, playoffAppearances: e.playoffSeasons.size,
      cupTitles: e.cupTitles, cupRunnerUps: e.cupRunnerUps,
      longestTitleStreak: streak,
      seasonHistory: history, headToHead: h2h,
      titleRank: titleRankById.get(e.id) ?? null, winsRank: null,
    })
  }

  // all-time rank by total career wins (competition rank, ties share)
  const byWins = [...stats.values()].filter((s) => s.resolved).sort((a, b) => b.totalWins - a.totalWins)
  byWins.forEach((s, i) => {
    s.winsRank = i > 0 && s.totalWins === byWins[i - 1].totalWins ? byWins[i - 1].winsRank : i + 1
  })

  return stats
}

let _cache: Map<string, CareerStat> | null = null
const careers = () => (_cache ??= computeCareers())

export function getCareerStatById(id: string): CareerStat | undefined {
  return careers().get(id)
}

/** Career stats for a noisy alias list (profile identity), via the shared resolver. */
export function getCareerStatForAliases(handles: (string | null | undefined)[]): CareerStat | null {
  const id = resolveCanonicalId(handles)
  return id ? (careers().get(id) ?? null) : null
}
