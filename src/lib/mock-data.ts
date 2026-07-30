/**
 * TEMPORARY SAMPLE DATA — NOT REAL 8 Ball Revival RECORDS.
 * ------------------------------------------------------------------
 * This file exists only so the frontend shell can be built and previewed before
 * the Prisma-backed data layer is wired in. Every value here is synthetic and
 * must be replaced by real queries. Player call-signs, results, and stats are
 * invented placeholders; they do NOT assert any historical fact.
 *
 * The site shows a global "preview / sample data" banner and per-section "Sample"
 * badges so this content is never mistaken for real records.
 *
 * Types intentionally mirror the future Prisma shapes (see prisma/schema.prisma)
 * so components can switch to live data without a redesign.
 */

export const IS_SAMPLE_DATA = true

export type CompetitionStatus = 'upcoming' | 'registration' | 'in_progress' | 'completed'

export interface Season {
  slug: string
  name: string // public 8 Ball Revival identity
  originalName?: string // preserved original identity
  year: number
  status: CompetitionStatus
  divisions: number
  participants: number
  championHandle?: string
}

export interface Player {
  slug: string
  handle: string
  country?: string
  seasonsPlayed: number
  titles: number
  matchWinPct?: number
}

export interface RankingRow {
  rank: number
  playerHandle: string
  playerSlug: string
  points: number
  movement: number // +/- vs previous snapshot, 0 = no change
}

export interface NewsItem {
  slug: string
  title: string
  excerpt: string
  date: string // ISO
  category: string
  featured?: boolean
}

export interface Competition {
  slug: string
  name: string
  type: 'Season' | 'Cup' | 'Tournament'
  status: CompetitionStatus
  date: string // ISO or descriptive
  format: string
}

export interface Stat {
  label: string
  value: string
  hint?: string
}

export interface HallOfFamer {
  slug: string
  handle: string
  inductedYear: number
  citation: string
}

export const STATUS_LABEL: Record<CompetitionStatus, string> = {
  upcoming: 'Upcoming',
  registration: 'Registration open',
  in_progress: 'In progress',
  completed: 'Completed',
}

/* ---------------------------------- data ---------------------------------- */

export const seasons: Season[] = [
  // 8 Ball Revival Season 1 facts are NOT yet imported/verified — no champion or participant
  // count is asserted here (see the season detail page's honest "pending" states).
  { slug: 'ego-season-1', name: '8 Ball Revival Season 1', originalName: '8B Retro Season 1', year: 2024, status: 'completed', divisions: 2, participants: 0 },
  { slug: 'ego-season-2', name: '8 Ball Revival Season 2', year: 2025, status: 'completed', divisions: 2, participants: 56, championHandle: 'Ricochet' },
  { slug: 'ego-season-3', name: '8 Ball Revival Season 3', year: 2025, status: 'completed', divisions: 3, participants: 64, championHandle: 'Onyx' },
  { slug: 'ego-season-4', name: '8 Ball Revival Season 4', year: 2026, status: 'in_progress', divisions: 3, participants: 72 },
  { slug: 'ego-season-5', name: '8 Ball Revival Season 5', year: 2026, status: 'registration', divisions: 3, participants: 0 },
]

export const featuredSeason = seasons.find((s) => s.status === 'in_progress') ?? seasons[0]

export const players: Player[] = [
  { slug: 'meridian', handle: 'Meridian', country: 'US', seasonsPlayed: 5, titles: 3, matchWinPct: 0.78 },
  { slug: 'ricochet', handle: 'Ricochet', country: 'CA', seasonsPlayed: 5, titles: 2, matchWinPct: 0.74 },
  { slug: 'onyx', handle: 'Onyx', country: 'GB', seasonsPlayed: 4, titles: 2, matchWinPct: 0.71 },
  { slug: 'halcyon', handle: 'Halcyon', country: 'AU', seasonsPlayed: 5, titles: 1, matchWinPct: 0.69 },
  { slug: 'vector', handle: 'Vector', country: 'DE', seasonsPlayed: 3, titles: 1, matchWinPct: 0.66 },
  { slug: 'cutter', handle: 'Cutter', country: 'US', seasonsPlayed: 4, titles: 0, matchWinPct: 0.63 },
  { slug: 'sable', handle: 'Sable', country: 'FR', seasonsPlayed: 3, titles: 0, matchWinPct: 0.61 },
  { slug: 'quartz', handle: 'Quartz', country: 'NL', seasonsPlayed: 2, titles: 0, matchWinPct: 0.58 },
]

export const rankings: RankingRow[] = [
  { rank: 1, playerHandle: 'Meridian', playerSlug: 'meridian', points: 2480, movement: 0 },
  { rank: 2, playerHandle: 'Ricochet', playerSlug: 'ricochet', points: 2361, movement: 1 },
  { rank: 3, playerHandle: 'Onyx', playerSlug: 'onyx', points: 2298, movement: -1 },
  { rank: 4, playerHandle: 'Halcyon', playerSlug: 'halcyon', points: 2155, movement: 2 },
  { rank: 5, playerHandle: 'Vector', playerSlug: 'vector', points: 2087, movement: 0 },
  { rank: 6, playerHandle: 'Cutter', playerSlug: 'cutter', points: 1994, movement: -2 },
  { rank: 7, playerHandle: 'Sable', playerSlug: 'sable', points: 1902, movement: 1 },
  { rank: 8, playerHandle: 'Quartz', playerSlug: 'quartz', points: 1848, movement: 3 },
  { rank: 9, playerHandle: 'Zephyr', playerSlug: 'zephyr', points: 1790, movement: -1 },
  { rank: 10, playerHandle: 'Vantage', playerSlug: 'vantage', points: 1733, movement: 0 },
]

export const latestResults: {
  competitor: string
  opponent: string
  score: string
  competition: string
  stage: string
}[] = [
  { competitor: 'Meridian', opponent: 'Halcyon', score: '7–4', competition: '8 Ball Revival Season 4', stage: 'Group A' },
  { competitor: 'Onyx', opponent: 'Cutter', score: '7–5', competition: '8 Ball Revival Season 4', stage: 'Group B' },
  { competitor: 'Ricochet', opponent: 'Sable', score: '7–2', competition: '8 Ball Revival Season 4', stage: 'Group A' },
  { competitor: 'Vector', opponent: 'Quartz', score: '7–6', competition: '8 Ball Revival Season 4', stage: 'Group C' },
]

export const competitions: Competition[] = [
  { slug: 'ego-season-4', name: '8 Ball Revival Season 4', type: 'Season', status: 'in_progress', date: '2026', format: 'Groups → Single-elim playoffs' },
  { slug: 'ego-season-5', name: '8 Ball Revival Season 5', type: 'Season', status: 'registration', date: '2026', format: 'Groups → Playoffs' },
  { slug: 'winter-cup-2026', name: 'Winter Cup 2026', type: 'Cup', status: 'upcoming', date: 'Q1 2026', format: 'Swiss → Single-elim' },
  { slug: 'masters-invitational', name: 'Masters Invitational', type: 'Tournament', status: 'upcoming', date: 'Q2 2026', format: 'Double elimination' },
  { slug: 'ego-season-3', name: '8 Ball Revival Season 3', type: 'Season', status: 'completed', date: '2025', format: 'Groups → Playoffs' },
  { slug: 'autumn-cup-2025', name: 'Autumn Cup 2025', type: 'Cup', status: 'completed', date: '2025', format: 'Single elimination' },
]

export const news: NewsItem[] = [
  { slug: 'season-4-playoffs-set', title: 'Season 4 playoff field takes shape', excerpt: 'Group play enters its final week as the top seeds jockey for a first-round bye.', date: '2026-07-20', category: 'Seasons', featured: true },
  { slug: 'winter-cup-announced', title: 'Winter Cup 2026 announced', excerpt: 'A new Swiss-into-bracket cup joins the 8 Ball Revival calendar this coming quarter.', date: '2026-07-12', category: 'Competitions' },
  { slug: 'ranking-system-notes', title: 'Notes on the ranking system', excerpt: 'How points, recency, and participation will factor into 8 Ball Revival rankings.', date: '2026-07-05', category: 'Rankings' },
  { slug: 'hall-of-fame-2025', title: 'Hall of Fame — 2025 inductions', excerpt: 'Recognizing sustained excellence across multiple seasons of competition.', date: '2026-06-28', category: 'Hall of Fame' },
  { slug: 'archive-restoration', title: 'Restoring the historical archive', excerpt: 'Work continues to preserve and verify records from the earliest seasons.', date: '2026-06-15', category: 'Archive' },
]

export const stats: Stat[] = [
  { label: 'Players', value: '1,900+', hint: 'across all seasons' },
  { label: 'Matches', value: '12,000+', hint: 'recorded' },
  { label: 'Seasons', value: '48', hint: 'archived + current' },
  { label: 'Countries', value: '40+', hint: 'represented' },
]

export const hallOfFame: HallOfFamer[] = [
  { slug: 'meridian', handle: 'Meridian', inductedYear: 2025, citation: 'Three-time champion; defined the modern group-to-playoff era.' },
  { slug: 'ricochet', handle: 'Ricochet', inductedYear: 2025, citation: 'Back-to-back finalist with the highest career match win rate.' },
  { slug: 'onyx', handle: 'Onyx', inductedYear: 2024, citation: 'Two titles and a record playoff run across divisions.' },
]

/* --------------------------- season detail (mock) --------------------------- */
/*
 * Shapes mirror the future Prisma-backed data (Competition → Stage → Group →
 * Standing / Match / Bracket → Seed / Championship / SourceReference). Two data
 * states:
 *   - 'pending' → facts not yet imported/verified; sections show honest empty
 *      states ("Data pending source verification"). Used for 8 Ball Revival Season 1.
 *   - 'sample'  → neutral SYNTHETIC placeholders (Player A, Qualifier 1, Seed
 *      pending) only, to exercise the components. Never realistic fake names.
 */

export type DataState = 'pending' | 'sample'

export type MatchResolution = 'played' | 'forfeit' | 'walkover' | 'bye' | 'pending'

export interface StandingRowData {
  pos: number | null
  name: string
  played: number | null
  wins: number | null
  losses: number | null
  points: number | null
  diff: number | null
}

export interface MatchData {
  a: string
  b: string | null // null = bye / no opponent
  scoreA: number | null
  scoreB: number | null
  resolution: MatchResolution
}

export interface GroupData {
  code: string
  name: string
  roster: string[]
  standings: StandingRowData[]
  matches: MatchData[]
}

export interface BracketMatchData {
  a: string // competitor label or "TBD" / "Seed pending"
  b: string | null // null = bye
  scoreA: number | null
  scoreB: number | null
  resolution: MatchResolution
}

export interface BracketRoundData {
  name: string
  matches: BracketMatchData[]
}

export interface PlayoffData {
  state: DataState
  format: string
  rounds: BracketRoundData[]
}

export interface SeasonSourceRef {
  label: string
  locator: string | null
  kind: 'file_row' | 'url' | 'wayback' | 'manual_review' | 'pending'
}

export interface SeasonDetail {
  slug: string
  name: string
  originalName?: string
  year: number
  status: CompetitionStatus
  dataState: DataState
  startDate: string | null
  endDate: string | null
  formatSummary: string | null
  participants: number | null
  divisions: number
  currentPhase: string
  champion: { handle: string | null; state: 'known' | 'pending' }
  historicalNote?: string
  groups: GroupData[]
  playoff: PlayoffData
  rulesRef: string | null
  sources: SeasonSourceRef[]
}

// The restrained, temporary historical note for the known 8 Ball Revival Season 1 seeding issue.
export const SEASON1_HISTORICAL_NOTE =
  'The playoff bracket shown will reflect the official seeding used at the time. Available records are still being reviewed to determine whether that seeding followed the intended qualification order.'

function sampleGroup(code: string, roster: string[]): GroupData {
  const standings: StandingRowData[] = roster.map((name, i) => ({
    pos: i + 1,
    name,
    played: 3,
    wins: 3 - i,
    losses: i,
    points: (3 - i) * 3,
    diff: (3 - i) * 4 - i * 3,
  }))
  const matches: MatchData[] = [
    { a: roster[0], b: roster[1], scoreA: 7, scoreB: 4, resolution: 'played' },
    { a: roster[2], b: roster[3], scoreA: 7, scoreB: 5, resolution: 'played' },
    { a: roster[0], b: roster[2], scoreA: 7, scoreB: 6, resolution: 'played' },
    { a: roster[1], b: roster[3], scoreA: null, scoreB: null, resolution: 'forfeit' },
    { a: roster[0], b: roster[3], scoreA: null, scoreB: null, resolution: 'pending' },
  ]
  return { code, name: `Group ${code}`, roster, standings, matches }
}

function sampleDetail(base: Season): SeasonDetail {
  const groups = [
    sampleGroup('A', ['Player A', 'Player B', 'Player C', 'Player D']),
    sampleGroup('B', ['Player E', 'Player F', 'Player G', 'Player H']),
  ]
  const playoff: PlayoffData = {
    state: 'sample',
    format: 'Single elimination',
    rounds: [
      {
        name: 'Semifinals',
        matches: [
          { a: 'Qualifier 1', b: 'Qualifier 4', scoreA: 7, scoreB: 3, resolution: 'played' },
          { a: 'Qualifier 2', b: 'Qualifier 3', scoreA: null, scoreB: null, resolution: 'walkover' },
        ],
      },
      {
        name: 'Final',
        matches: [{ a: 'Qualifier 1', b: 'Qualifier 2', scoreA: 8, scoreB: 6, resolution: 'played' }],
      },
    ],
  }
  return {
    slug: base.slug,
    name: base.name,
    originalName: base.originalName,
    year: base.year,
    status: base.status,
    dataState: 'sample',
    startDate: `${base.year}-01-15`,
    endDate: base.status === 'completed' ? `${base.year}-04-20` : null,
    formatSummary: 'Group stage → single-elimination playoffs',
    participants: base.participants || 32,
    divisions: base.divisions,
    currentPhase: base.status === 'completed' ? 'Completed' : 'Group stage',
    champion: base.championHandle
      ? { handle: base.championHandle, state: 'known' }
      : { handle: null, state: 'pending' },
    groups,
    playoff,
    rulesRef: 'rules',
    sources: [
      { label: 'Sample structure — placeholder data', locator: null, kind: 'manual_review' },
    ],
  }
}

// 8 Ball Revival Season 1 — honest "pending" detail; no invented facts.
function egoSeason1Detail(base: Season): SeasonDetail {
  return {
    slug: base.slug,
    name: base.name,
    originalName: base.originalName,
    year: base.year,
    status: base.status,
    dataState: 'pending',
    startDate: null,
    endDate: null,
    formatSummary: null,
    participants: null,
    divisions: base.divisions,
    currentPhase: 'Completed — records under review',
    champion: { handle: null, state: 'pending' },
    historicalNote: SEASON1_HISTORICAL_NOTE,
    groups: [],
    playoff: { state: 'pending', format: 'Pending source verification', rounds: [] },
    rulesRef: null,
    sources: [],
  }
}

/** Look up a season detail by slug. Returns undefined for unknown slugs (→ 404). */
export function getSeasonDetail(slug: string): SeasonDetail | undefined {
  const base = seasons.find((s) => s.slug === slug)
  if (!base) return undefined
  return base.slug === 'ego-season-1' ? egoSeason1Detail(base) : sampleDetail(base)
}

export function getSeasonSlugs(): string[] {
  return seasons.map((s) => s.slug)
}
