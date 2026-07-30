/**
 * PLAYER PREVIEW DATA — sourced from the read-only 8BRCAM archive snapshot
 * (src/lib/preview-data/archive-players.json, extracted from the Cueverse Prime
 * archive export). Used ONLY as preview content for the frontend while the Prisma
 * import pipeline is still being built. These are REAL archived names/aliases/stats,
 * NOT yet imported or 8 Ball Revival-verified — the UI labels them as archive preview and shows
 * honest pending states for anything the archive does not contain.
 *
 * Shapes mirror the future Prisma models (Player, PlayerAlias, Championship,
 * PlayerSeasonStat, PlayerCareerStat, HeadToHead, HallOfFameEntry).
 */
import archiveData from './preview-data/archive-players.json'
import type { Player } from './mock-data'

export interface PreviewAlias {
  alias: string
  type: string
}

export interface PreviewCareer {
  seasonsPlayed: number | null
  totalMatches: number | null
  totalWins: number | null
  totalLosses: number | null
  totalWinPct: number | null // 0–100
  championships: number | null
  runnerUps: number | null
  finals: number | null
  semifinals: number | null
  playoffAppearances: number | null
  longestTitleStreak: number | null
  longestPlayoffRun: number | null
}

export type ChampionshipConfidence = 'explicit' | 'heuristic' | 'reconstructed' | 'unknown'

export interface PreviewChampionship {
  seasonId: string
  division: string
  result: 'champion' | 'runner-up'
  confidence: ChampionshipConfidence
  bracketReconstructed: boolean
}

export interface PreviewSeason {
  seasonId: string
  division: string
  groupLetter: string | null
  madePlayoffs: boolean
  playoffSeed: number | null
  result: string | null
  groupWins: number | null
  groupLosses: number | null
}

export interface PreviewH2H {
  opponent: string
  opponentSlug: string | null
  matches: number | null
  wins: number | null
  losses: number | null
  draws: number | null
  lastSeason: string | null
}

export interface PreviewHof {
  category: string
  rank: number | null
  value: string
}

export interface PlayerPreview {
  slug: string
  playerId: string
  primaryName: string
  country: string | null
  firstYear: number | null
  lastYear: number | null
  aliases: PreviewAlias[]
  career: PreviewCareer | null
  championships: PreviewChampionship[]
  seasonHistory: PreviewSeason[]
  headToHead: PreviewH2H[]
  hof: PreviewHof[]
  historicalNotes: string[]
}

const PLAYERS = archiveData as unknown as PlayerPreview[]

/** Preview source label shown in the Sources panel and verification badges. */
export const PLAYER_PREVIEW_SOURCE =
  '8BRCAM archive (imported snapshot) — pending 8 Ball Revival source verification'

export function getPlayerPreviewSlugs(): string[] {
  return PLAYERS.map((p) => p.slug)
}

export function getPlayerPreview(slug: string): PlayerPreview | undefined {
  return PLAYERS.find((p) => p.slug === slug)
}

export interface PlayerSearchHit {
  slug: string
  primaryName: string
  playerId: string
  aliasCount: number
  matchedAlias?: string
}

/**
 * Case-insensitive search over primary names AND aliases. An alias match returns
 * the canonical player (with the alias that matched).
 */
export function searchPlayers(query: string): PlayerSearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: PlayerSearchHit[] = []
  for (const p of PLAYERS) {
    const nameHit = p.primaryName.toLowerCase().includes(q)
    let matchedAlias: string | undefined
    if (!nameHit) {
      const a = p.aliases.find((al) => al.alias.toLowerCase().includes(q))
      if (a) matchedAlias = a.alias
    }
    if (nameHit || matchedAlias) {
      hits.push({
        slug: p.slug,
        primaryName: p.primaryName,
        playerId: p.playerId,
        aliasCount: p.aliases.length,
        matchedAlias,
      })
    }
  }
  return hits
}

/** Directory list for /players, mapped to the shared PlayerCard shape (real values). */
export function getPlayerIndex(): Player[] {
  return PLAYERS.map((p) => ({
    slug: p.slug,
    handle: p.primaryName,
    country: p.country ?? undefined,
    seasonsPlayed: p.career?.seasonsPlayed ?? 0,
    titles: p.career?.championships ?? 0,
    matchWinPct: p.career?.totalWinPct != null ? p.career.totalWinPct / 100 : undefined,
  })).sort((a, b) => b.titles - a.titles || b.seasonsPlayed - a.seasonsPlayed)
}
