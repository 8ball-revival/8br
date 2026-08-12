/**
 * Shared Tournament-derived statistics service.
 *
 * SINGLE SOURCE OF TRUTH for player Tournament statistics. Everything here is computed
 * live from the published Seasons archive (`getAllArchiveSeasons()` — 2005–2014 +
 * 2026, with the verified-playoff overlay). CUPS ARE NOT USED and must never affect
 * these numbers. No manual totals, no points, no weighting.
 *
 * Identity is resolved through the verified alias map (player-aliases.json:
 * archive merges + owner-confirmed merges). Handles that don't resolve are kept as
 * their own distinct player and flagged `resolved: false` — never guess-merged by name.
 *
 * Because it derives from the archive at call time, adding/correcting/removing a
 * Tournament (or updating the alias map) automatically recalculates every consumer.
 */
import { getAllArchiveSeasons, type TournamentDivision, type TournamentMatch } from '@/lib/seasons/archive'
import { resolveIdentity } from './identity'

export interface TitleEntry {
  tournamentId: string // e.g. "2009-s4"
  division: string // "A", "B", or "single"
  confidence: string | null // the division's recorded champion confidence
  bracketReconstructed: boolean
}

export interface TournamentPlayerStat {
  rank: number // competition rank; ties share a rank (joint #1 → next is #3)
  id: string
  name: string
  aliases: string[] // distinct handles/names seen in Seasons
  championships: number
  championshipSeasons: string[] // tournament ids, e.g. "2006-s1"
  championshipDetail: TitleEntry[] // per-title tournament + division + confidence
  runnerUps: number
  runnerUpDetail: TitleEntry[]
  playoffWins: number
  playoffLosses: number
  playoffWinPct: number // 0–100, one decimal; 0 when no completed playoff matches
  resolved: boolean // false when the identity is not in the verified alias map
}

// public display handle for a slot (already scrubbed at the loader for Neo)
const cleanHandle = (s: string) => s.replace(/^#?\d+[.\s]\s*/, '')

/** Resolve a slot to a canonical identity via the shared resolver. */
function resolveSlot(slot: { name?: string | null; handle?: string | null } | null | undefined) {
  if (!slot) return null
  return resolveIdentity(slot.handle, slot.name, { unknownAsSelf: false })
}

/** All completed playoff matches for a division — single-elim rounds or double-elim brackets. */
function playoffMatches(d: TournamentDivision): TournamentMatch[] {
  const out: TournamentMatch[] = []
  if (d.playoff?.rounds) for (const r of d.playoff.rounds) out.push(...r.matches)
  if (d.doubleElim) {
    for (const r of d.doubleElim.winners) out.push(...r.matches)
    for (const r of d.doubleElim.losers) out.push(...r.matches)
  }
  return out
}

interface Acc {
  id: string
  name: string
  aliases: Set<string>
  championships: number
  championshipSeasons: string[]
  championshipDetail: TitleEntry[]
  runnerUps: number
  runnerUpDetail: TitleEntry[]
  playoffWins: number
  playoffLosses: number
  resolved: boolean
}

function computeRankings(): TournamentPlayerStat[] {
  const acc = new Map<string, Acc>()
  const get = (id: string, resolved: boolean, displayName: string): Acc => {
    let e = acc.get(id)
    if (!e) {
      e = { id, name: displayName, aliases: new Set(), championships: 0, championshipSeasons: [], championshipDetail: [], runnerUps: 0, runnerUpDetail: [], playoffWins: 0, playoffLosses: 0, resolved }
      acc.set(id, e)
    }
    if (!resolved) e.resolved = false
    return e
  }

  for (const tournament of getAllArchiveSeasons()) {
    for (const d of tournament.divisions) {
      const titleEntry = (): TitleEntry => ({
        tournamentId: tournament.tournamentId,
        division: d.division,
        confidence: d.championConfidence,
        bracketReconstructed: d.bracketReconstructed,
      })
      // Championship — the recorded champion of the tournament's playoff.
      const ch = d.champion
      if (ch && (ch.handle || ch.name)) {
        const r = resolveSlot(ch)
        if (r) {
          const e = get(r.id, r.ok, r.name)
          e.championships += 1
          e.championshipSeasons.push(tournament.tournamentId)
          e.championshipDetail.push(titleEntry())
          e.aliases.add(cleanHandle(ch.handle ?? ch.name))
        }
      }
      // Runner-up — the recorded finalist who lost the title match.
      const ru = d.runnerUp
      if (ru && (ru.handle || ru.name)) {
        const r = resolveSlot(ru)
        if (r) {
          const e = get(r.id, r.ok, r.name)
          e.runnerUps += 1
          e.runnerUpDetail.push(titleEntry())
          e.aliases.add(cleanHandle(ru.handle ?? ru.name))
        }
      }
      // Playoff match record — completed matches only, byes excluded.
      for (const m of playoffMatches(d)) {
        const { a, b, winner } = m
        if (!a || !b || !winner) continue
        if (a.name === 'Bye' || b.name === 'Bye') continue
        const win = winner === 'a' ? a : b
        const los = winner === 'a' ? b : a
        const rw = resolveSlot(win)
        const rl = resolveSlot(los)
        if (rw) {
          const e = get(rw.id, rw.ok, rw.name)
          e.playoffWins += 1
          e.aliases.add(cleanHandle(win.handle ?? win.name))
        }
        if (rl) {
          const e = get(rl.id, rl.ok, rl.name)
          e.playoffLosses += 1
          e.aliases.add(cleanHandle(los.handle ?? los.name))
        }
      }
    }
  }

  const rows: TournamentPlayerStat[] = [...acc.values()].map((e) => {
    const played = e.playoffWins + e.playoffLosses
    return {
      rank: 0,
      id: e.id,
      name: e.name,
      aliases: [...e.aliases].sort(),
      championships: e.championships,
      championshipSeasons: [...e.championshipSeasons].sort(),
      championshipDetail: [...e.championshipDetail].sort((a, b) => a.tournamentId.localeCompare(b.tournamentId)),
      runnerUps: e.runnerUps,
      runnerUpDetail: [...e.runnerUpDetail].sort((a, b) => a.tournamentId.localeCompare(b.tournamentId)),
      playoffWins: e.playoffWins,
      playoffLosses: e.playoffLosses,
      playoffWinPct: played ? Math.round((e.playoffWins / played) * 1000) / 10 : 0,
      resolved: e.resolved,
    }
  })

  // Ranking formula (exact): championships desc → playoff wins desc → playoff losses
  // asc → playoff win% desc. NO further tiebreaker — players equal on all four are
  // genuinely tied and share a rank (e.g. joint #1; the next player is then #3).
  const key = (p: TournamentPlayerStat) => `${p.championships}|${p.playoffWins}|${p.playoffLosses}|${p.playoffWinPct}`
  rows.sort(
    (x, y) =>
      y.championships - x.championships ||
      y.playoffWins - x.playoffWins ||
      x.playoffLosses - y.playoffLosses ||
      y.playoffWinPct - x.playoffWinPct,
  )
  rows.forEach((p, i) => {
    p.rank = i > 0 && key(p) === key(rows[i - 1]) ? rows[i - 1].rank : i + 1
  })
  return rows
}

// Memoise for the process lifetime; the underlying archive is static per build.
let _cache: TournamentPlayerStat[] | null = null

/** Full Tournament-derived ranking, ordered by the ranking formula. */
export function getSeasonRankings(): TournamentPlayerStat[] {
  return (_cache ??= computeRankings())
}

/** Top N by the ranking formula (default 10). */
export function getSeasonTop(n = 10): TournamentPlayerStat[] {
  return getSeasonRankings().slice(0, n)
}

/** Tournament stats for a single resolved player id (for Hall of Fame / profiles later). */
export function getSeasonStatById(id: string): TournamentPlayerStat | undefined {
  return getSeasonRankings().find((p) => p.id === id)
}

const EMPTY_STAT: TournamentPlayerStat = {
  rank: 0, id: '', name: '', aliases: [], championships: 0, championshipSeasons: [],
  championshipDetail: [], runnerUps: 0, runnerUpDetail: [], playoffWins: 0,
  playoffLosses: 0, playoffWinPct: 0, resolved: false,
}

/**
 * CANONICAL BRIDGE. Given a set of handles/aliases (e.g. a profile's identity list),
 * resolve them to a single canonical player and return that player's Tournament stats.
 *
 * This is how consumers that key players by their own id scheme (player profiles,
 * the /players index) read championship totals from the SAME source as the Top 10.
 *
 * A profile's alias list is noisy: it can carry a common real name that collides with
 * a stray archive id (e.g. "James" → an empty P0297 while the real record lives under
 * the handle "cue.ball") and it can even carry a wrong alias (a "Luis" on an otherwise
 * all-Neo profile). So we vote by DISTINCT handle (dedup first, so a name repeated as
 * both primary + alias can't double-count) and break ties by record richness — the
 * canonical id actually carrying the titles/matches wins.
 */
/**
 * Resolve a noisy alias list to ONE canonical player id (or null). Vote by distinct
 * handle (dedup so a name repeated as primary + alias can't double-count) and break
 * ties by record richness — the canonical id actually carrying the titles/matches
 * wins. Shared by every consumer that keys players by their own id scheme, so the
 * tournament and career services agree on which canonical player a profile is.
 */
export function resolveCanonicalId(handles: (string | null | undefined)[]): string | null {
  const nk = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const votes = new Map<string, Set<string>>() // canonical id -> distinct normalized handles
  for (const h of handles) {
    if (!h) continue
    const r = resolveIdentity(h, h, { unknownAsSelf: false })
    if (r && r.ok) (votes.get(r.id) ?? votes.set(r.id, new Set()).get(r.id)!).add(nk(h))
  }
  if (!votes.size) return null
  const scored = [...votes.entries()].map(([id, hs]) => {
    const stat = getSeasonStatById(id)
    return { id, distinct: hs.size, championships: stat?.championships ?? 0, games: (stat?.playoffWins ?? 0) + (stat?.playoffLosses ?? 0) }
  })
  scored.sort((a, b) => b.distinct - a.distinct || b.championships - a.championships || b.games - a.games)
  return scored[0].id
}

export function getSeasonStatForAliases(handles: (string | null | undefined)[]): TournamentPlayerStat {
  const id = resolveCanonicalId(handles)
  if (!id) return EMPTY_STAT
  return getSeasonStatById(id) ?? { ...EMPTY_STAT, id }
}
