/**
 * Read-only reader for the 8BRCAM archive CSVs.
 *
 * The archive under `archive/cueverse-prime` is a frozen snapshot and is never written to. This
 * module loads it, applies the reviewed identity corrections, and hands back plain objects for the
 * importer. Keeping the corrections here means every consumer sees the same resolved identities.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const ARCHIVE_ROOT = join(HERE, '..', 'archive', 'cueverse-prime')
const CSV = join(ARCHIVE_ROOT, 'data', 'csv')
const CORRECTIONS = join(ARCHIVE_ROOT, 'corrections')

/** Minimal RFC-4180 reader: handles quoted fields, embedded commas and doubled quotes. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  if (!rows.length) return []

  const header = rows[0]
  return rows.slice(1)
    .filter((r) => r.some((v) => v !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

const read = (file: string, dir = CSV) => parseCsv(readFileSync(join(dir, file), 'utf8'))

export const num = (v: string | undefined | null, dflt = 0): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : dflt
}
export const intOr = (v: string | undefined | null, dflt = 0): number => Math.trunc(num(v, dflt))
/** Archive booleans are the Python strings "True"/"False". */
export const boolOf = (v: string | undefined | null): boolean => String(v).trim().toLowerCase() === 'true'

export interface ArchiveSeason { seasonId: string; year: number; period: number }
export interface ArchiveDivision { seasonId: string; division: string }
export interface ArchivePlayerRow {
  playerId: string; primaryName: string; primaryYm: string; firstYear: number; lastYear: number
}
export interface ArchiveGroup { groupId: string; seasonId: string; division: string; letter: string; scoreModel: string }
export interface ArchiveStanding {
  groupId: string; seasonId: string; division: string; playerId: string; slot: number
  played: number; wins: number; losses: number; draws: number
  gamesFor: number; gamesAgainst: number; winPct: number; points: number; bonus: number; total: number
}
export interface ArchiveGroupMatch {
  matchId: string; seasonId: string; division: string; groupId: string
  playerAId: string; playerBId: string; scoreA: number | null; scoreB: number | null; winnerId: string
}
export interface ArchivePlayoff {
  playoffId: string; seasonId: string; division: string; format: string
  championId: string; championHandle: string; runnerUpId: string; runnerUpHandle: string
  championConfidence: string; bracketReconstructed: boolean
}
export interface ArchivePlayoffMatch {
  matchId: string; playoffId: string; seasonId: string; division: string
  round: number; roundName: string; matchNo: number
  playerAId: string; playerBId: string; score: string; winnerId: string; loserId: string
}
export interface ArchiveSeed { seasonId: string; division: string; playerId: string; seed: number; handle: string }
export interface ArchiveSeasonStat {
  playerId: string; seasonId: string; division: string; groupId: string
  madePlayoffs: boolean; playoffSeed: number | null; result: string
}

export interface ArchiveData {
  seasons: ArchiveSeason[]
  divisions: ArchiveDivision[]
  players: Map<string, ArchivePlayerRow>
  groups: ArchiveGroup[]
  standings: ArchiveStanding[]
  groupMatches: ArchiveGroupMatch[]
  playoffs: ArchivePlayoff[]
  playoffMatches: ArchivePlayoffMatch[]
  seeds: ArchiveSeed[]
  seasonStats: ArchiveSeasonStat[]
  /** merged archive player id -> canonical archive player id (reviewed corrections). */
  mergeMap: Map<string, string>
  /** "<playerId>|<seasonId>|<division>" -> replacement player id (reviewed split corrections). */
  splitMap: Map<string, string>
}

/** Resolve an archive player id through the reviewed merge corrections. */
export function canonicalPlayer(data: ArchiveData, playerId: string): string {
  let id = playerId
  for (let hop = 0; hop < 8; hop++) {
    const next = data.mergeMap.get(id)
    if (!next || next === id) break
    id = next
  }
  return id
}

/**
 * Resolve a player for a specific season-division, applying splits before merges.
 *
 * A split says "this handle was two different people, and in THIS season it was the other one",
 * so it has to win over the merge map.
 */
export function resolvePlayer(data: ArchiveData, playerId: string, seasonId: string, division: string): string {
  const split = data.splitMap.get(`${playerId}|${seasonId}|${division}`)
  return canonicalPlayer(data, split ?? playerId)
}

export function loadArchive(): ArchiveData {
  const players = new Map<string, ArchivePlayerRow>()
  for (const r of read('players.csv')) {
    players.set(r.player_id, {
      playerId: r.player_id,
      primaryName: r.primary_name ?? '',
      primaryYm: r.primary_ym ?? '',
      firstYear: intOr(r.first_year),
      lastYear: intOr(r.last_year),
    })
  }

  const mergeMap = new Map<string, string>()
  const splitMap = new Map<string, string>()
  const corrections = new Set(readdirSync(CORRECTIONS))
  if (corrections.has('player_merges.csv')) {
    for (const r of read('player_merges.csv', CORRECTIONS)) {
      if (r.merged_player_id && r.canonical_player_id) mergeMap.set(r.merged_player_id, r.canonical_player_id)
    }
  }
  if (corrections.has('player_splits.csv')) {
    for (const r of read('player_splits.csv', CORRECTIONS)) {
      if (!r.source_player_id || !r.new_player_id) continue
      splitMap.set(`${r.source_player_id}|${r.season_id}|${r.division}`, r.new_player_id)
      // A split can introduce a player id that players.csv never knew about.
      if (!players.has(r.new_player_id)) {
        players.set(r.new_player_id, {
          playerId: r.new_player_id,
          primaryName: r.new_primary_name ?? '',
          primaryYm: '',
          firstYear: 0,
          lastYear: 0,
        })
      }
    }
  }

  return {
    seasons: read('seasons.csv').map((r) => ({
      seasonId: r.season_id, year: intOr(r.year), period: intOr(r.period),
    })),
    divisions: read('season_divisions.csv').map((r) => ({ seasonId: r.season_id, division: r.division })),
    players,
    groups: read('groups.csv').map((r) => ({
      groupId: r.group_id, seasonId: r.season_id, division: r.division,
      letter: r.group_letter ?? '', scoreModel: r.score_model ?? '',
    })),
    standings: read('group_standings.csv').map((r) => ({
      groupId: r.group_id, seasonId: r.season_id, division: r.division, playerId: r.player_id,
      slot: intOr(r.slot), played: intOr(r.played), wins: intOr(r.wins), losses: intOr(r.losses),
      draws: intOr(r.draws), gamesFor: intOr(r.games_for), gamesAgainst: intOr(r.games_against),
      winPct: num(r.win_pct), points: num(r.points), bonus: num(r.bonus), total: num(r.total),
    })),
    groupMatches: read('group_matches.csv').map((r) => ({
      matchId: r.match_id, seasonId: r.season_id, division: r.division, groupId: r.group_id,
      playerAId: r.player_a_id, playerBId: r.player_b_id,
      scoreA: r.score_a === '' ? null : intOr(r.score_a),
      scoreB: r.score_b === '' ? null : intOr(r.score_b),
      winnerId: r.winner_id ?? '',
    })),
    playoffs: read('playoffs.csv').map((r) => ({
      playoffId: r.playoff_id, seasonId: r.season_id, division: r.division, format: r.format ?? '',
      championId: r.champion_id ?? '', championHandle: r.champion_handle ?? '',
      runnerUpId: r.runner_up_id ?? '', runnerUpHandle: r.runner_up_handle ?? '',
      championConfidence: r.champion_confidence ?? '', bracketReconstructed: boolOf(r.bracket_reconstructed),
    })),
    playoffMatches: read('playoff_matches.csv').map((r) => ({
      matchId: r.match_id, playoffId: r.playoff_id, seasonId: r.season_id, division: r.division,
      round: intOr(r.round), roundName: r.round_name ?? '', matchNo: intOr(r.match_no),
      playerAId: r.player_a_id ?? '', playerBId: r.player_b_id ?? '',
      score: r.score ?? '', winnerId: r.winner_id ?? '', loserId: r.loser_id ?? '',
    })),
    seeds: read('playoff_seeds.csv').map((r) => ({
      seasonId: r.season_id, division: r.division, playerId: r.player_id,
      seed: intOr(r.seed), handle: r.handle ?? '',
    })),
    seasonStats: read('player_season_stats.csv').map((r) => ({
      playerId: r.player_id, seasonId: r.season_id, division: r.division, groupId: r.group_id,
      madePlayoffs: boolOf(r.made_playoffs),
      playoffSeed: r.playoff_seed === '' ? null : intOr(r.playoff_seed),
      result: r.result ?? '',
    })),
    mergeMap,
    splitMap,
  }
}

/** Season-divisions in the order they were played: year, then period, then A before B. */
export function orderedSeasonDivisions(data: ArchiveData): { seasonId: string; division: string; year: number; period: number }[] {
  const meta = new Map(data.seasons.map((s) => [s.seasonId, s]))
  const rank = (d: string) => (d === 'single' ? 0 : d === 'A' ? 1 : d === 'B' ? 2 : 3)
  return data.divisions
    .map((d) => {
      const m = meta.get(d.seasonId)
      return { seasonId: d.seasonId, division: d.division, year: m?.year ?? 0, period: m?.period ?? 0 }
    })
    .sort((a, b) => a.year - b.year || a.period - b.period || rank(a.division) - rank(b.division))
}
