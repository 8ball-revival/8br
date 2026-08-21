import 'server-only'
import { prisma } from '@/lib/prisma'
import {
  seasonIsArchived, seasonIsLive, tournamentIsArchived, tournamentIsLive,
  type DataCompleteness,
} from './lifecycle-rules'

/**
 * One read-only shape for Live and Archives, over two models that stay separate.
 *
 * Seasons and Tournaments are genuinely different competitions with different lifecycles, different
 * stages and different tables, and merging them into one model to make two listing pages easier
 * would be paying for a listing page with the rest of the application. So they keep their models,
 * and this is the narrow projection the two listings read.
 *
 * Detail pages stay type-specific — they show group tables and brackets, which do not generalise.
 * This shape exists to answer "what is this, when was it, who won" and nothing more.
 *
 * ── The rule about dates ─────────────────────────────────────────────────────────────────────────
 * `year` is the COMPETITION year — the year the competition belongs to historically. It is never
 * the row's `createdAt`. A reconstruction of a 2005 season entered last week is a 2005 season, and
 * sorting the archive by import time would put the whole of history in the order somebody happened
 * to type it in.
 */

export type RecordKind = 'season' | 'tournament'

export interface CompetitionCard {
  kind: RecordKind
  /** Canonical id of the underlying record. Stable, and what the detail URL uses. */
  id: number
  /** What to call it: the custom title where there is one, else the derived name. */
  title: string
  /** Competition series, e.g. "8BRCAM". */
  competition: string
  competitionSeriesId: number | null
  /** Historical competition year. NEVER the database import time. */
  year: number | null
  /** Season number. Null for Tournaments, which are identified by their title. */
  number: number | null
  division: string | null
  /** How the competition ran: "Groups → Playoffs", "Single elimination", … */
  format: string | null
  participants: number
  champion: string | null
  runnerUp: string | null
  finalScore: string | null
  lifecycle: string
  publiclyVisible: boolean
  completeness: DataCompleteness
  /** Canonical detail URL. Unchanged from the existing routes, so old links keep working. */
  href: string
}

const completenessOf = (v: string | null | undefined): DataCompleteness =>
  v === 'partial' ? 'partial' : 'full'

/**
 * How a Season ran, in words.
 *
 * Derived from what the Season actually has rather than from a stored label, so it cannot claim a
 * format the record does not match. A Season with groups and a bracket is Groups → Playoffs; one
 * with groups and no bracket is Groups only; one with a bracket and no groups is a straight bracket.
 */
function seasonFormat(groups: number, playoffMatches: number, doubleElim: boolean): string {
  if (groups > 0 && playoffMatches > 0) return doubleElim ? 'Groups → Double elimination' : 'Groups → Playoffs'
  if (groups > 0) return 'Groups only'
  if (playoffMatches > 0) return doubleElim ? 'Double elimination' : 'Single elimination'
  return 'Not yet configured'
}

const SEASON_SELECT = {
  id: true, number: true, competitionYear: true, subtitle: true, division: true,
  lifecycleState: true, ladderAppliedAt: true, publiclyVisible: true, reconstruction: true,
  reopenedAt: true, cancelledAt: true, deletedAt: true, dataCompleteness: true,
  entrantsCount: true, championName: true, championHandle: true,
  runnerUpName: true, runnerUpHandle: true, finalScore: true, playoffDoubleElim: true,
  competitionSeriesId: true,
  competitionSeries: { select: { name: true, shortName: true } },
  _count: { select: { groups: true, playoffMatches: true } },
} as const

type SeasonRow = Awaited<ReturnType<typeof loadSeasons>>[number]
async function loadSeasons(where: object) {
  return prisma.season.findMany({ where, select: SEASON_SELECT })
}

function seasonCard(s: SeasonRow): CompetitionCard {
  const series = s.competitionSeries?.name ?? 'Competition'
  return {
    kind: 'season',
    id: s.id,
    // The subtitle is the custom title when one was given; otherwise the Season is named by its
    // competition and number, which is how the community refers to it.
    title: s.subtitle?.trim() || `${series} Season ${s.number}`,
    competition: series,
    competitionSeriesId: s.competitionSeriesId,
    year: s.competitionYear,
    number: s.number,
    division: s.division,
    format: seasonFormat(s._count.groups, s._count.playoffMatches, s.playoffDoubleElim),
    participants: s.entrantsCount,
    champion: s.championHandle || s.championName || null,
    runnerUp: s.runnerUpHandle || s.runnerUpName || null,
    finalScore: s.finalScore,
    lifecycle: String(s.lifecycleState),
    publiclyVisible: s.publiclyVisible,
    completeness: completenessOf(s.dataCompleteness),
    href: `/seasons/${s.id}`,
  }
}

const TOURNAMENT_SELECT = {
  id: true, name: true, number: true, competitionYear: true, status: true,
  lifecycleState: true, archivedAt: true, publiclyVisible: true, reconstruction: true,
  reopenedAt: true, dataCompleteness: true, formatSummary: true,
  championHandle: true, runnerUpHandle: true, finalScore: true,
} as const

type TournamentRow = Awaited<ReturnType<typeof loadTournaments>>[number]
async function loadTournaments(where: object) {
  return prisma.tournament.findMany({ where, select: TOURNAMENT_SELECT })
}

function tournamentCard(t: TournamentRow, participants: number): CompetitionCard {
  return {
    kind: 'tournament',
    id: t.id,
    // The title leads. The sequence number is internal and stays out of the name.
    title: t.name,
    competition: 'Tournament',
    competitionSeriesId: null,
    year: t.competitionYear,
    number: null,
    division: null,
    format: t.formatSummary,
    participants,
    champion: t.championHandle ?? null,
    runnerUp: t.runnerUpHandle ?? null,
    finalScore: t.finalScore ?? null,
    lifecycle: String(t.lifecycleState ?? t.status ?? ''),
    publiclyVisible: t.publiclyVisible,
    completeness: completenessOf(t.dataCompleteness),
    href: `/cups/${t.number ?? t.id}`,
  }
}

// ── Live ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * What is publicly under way.
 *
 * The database narrows to plausible candidates using the indexed columns; the FINAL decision is
 * made by the shared predicate in ./lifecycle-rules, so the SQL and the rule can never drift apart. A
 * `where` clause that tried to encode the whole rule would be a second copy of it.
 */
export async function getLiveSeasons(): Promise<CompetitionCard[]> {
  const rows = await loadSeasons({
    publiclyVisible: true,
    reconstruction: false,
    cancelledAt: null,
    deletedAt: null,
    lifecycleState: { notIn: ['COMPLETED', 'REGISTRATION_SCHEDULED'] },
  })
  return rows
    .filter((s) => seasonIsLive(s, s.publiclyVisible))
    .map(seasonCard)
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || (b.number ?? 0) - (a.number ?? 0))
}

export async function getLiveTournaments(): Promise<CompetitionCard[]> {
  const rows = await loadTournaments({
    publiclyVisible: true,
    reconstruction: false,
    reopenedAt: null,
  })
  const live = rows.filter((t) => tournamentIsLive(t, t.publiclyVisible))
  const counts = await participantCounts(live.map((t) => t.id))
  return live
    .map((t) => tournamentCard(t, counts.get(t.id) ?? 0))
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title))
}

/**
 * Is anything Live at all?
 *
 * Two counts rather than two full listings — the navigation only needs to know whether each half
 * exists, and loading every live competition to render a menu label would be work nobody sees.
 */
export async function getLiveSummary(): Promise<{ seasons: number; tournaments: number }> {
  const [seasons, tournaments] = await Promise.all([getLiveSeasons(), getLiveTournaments()])
  return { seasons: seasons.length, tournaments: tournaments.length }
}

// ── Archives ─────────────────────────────────────────────────────────────────────────────────────

export interface ArchiveQuery {
  competitionSeriesId?: number | null
  year?: number | null
  division?: string | null
  search?: string | null
  /** Matches the champion or runner-up handle/name. */
  player?: string | null
  sort?: 'newest' | 'oldest'
  page?: number
  perPage?: number
}

export interface ArchivePage {
  cards: CompetitionCard[]
  total: number
  page: number
  perPage: number
  pages: number
  /** The values the filters can actually offer, from the archived set itself. */
  facets: { competitions: { id: number; name: string }[]; years: number[]; divisions: string[] }
}

const PER_PAGE = 24

function paginate(cards: CompetitionCard[], q: ArchiveQuery): ArchivePage {
  const perPage = Math.min(Math.max(q.perPage ?? PER_PAGE, 1), 100)
  const pages = Math.max(1, Math.ceil(cards.length / perPage))
  const page = Math.min(Math.max(q.page ?? 1, 1), pages)
  const competitions = new Map<number, string>()
  const years = new Set<number>()
  const divisions = new Set<string>()
  for (const c of cards) {
    if (c.competitionSeriesId != null) competitions.set(c.competitionSeriesId, c.competition)
    if (c.year != null) years.add(c.year)
    if (c.division) divisions.add(c.division)
  }
  return {
    cards: cards.slice((page - 1) * perPage, page * perPage),
    total: cards.length,
    page,
    perPage,
    pages,
    facets: {
      competitions: [...competitions].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      years: [...years].sort((a, b) => b - a),
      divisions: [...divisions].sort(),
    },
  }
}

const matches = (haystack: (string | null)[], needle: string) =>
  haystack.some((h) => (h ?? '').toLowerCase().includes(needle))

function applyFilters(cards: CompetitionCard[], q: ArchiveQuery): CompetitionCard[] {
  const search = q.search?.trim().toLowerCase() ?? ''
  const player = q.player?.trim().toLowerCase() ?? ''
  return cards.filter((c) => {
    if (q.competitionSeriesId != null && c.competitionSeriesId !== q.competitionSeriesId) return false
    if (q.year != null && c.year !== q.year) return false
    if (q.division && c.division !== q.division) return false
    if (search && !matches([c.title, c.competition], search)) return false
    if (player && !matches([c.champion, c.runnerUp], player)) return false
    return true
  })
}

/**
 * Completed Seasons.
 *
 * Sorted by HISTORICAL year and then Season number — the order the competitions actually happened
 * in. Never by row id or creation time, which for a reconstructed archive is the order somebody sat
 * down to type them.
 */
export async function getArchivedSeasons(q: ArchiveQuery = {}): Promise<ArchivePage> {
  const rows = await loadSeasons({
    lifecycleState: 'COMPLETED',
    ladderAppliedAt: { not: null },
    reopenedAt: null,
    cancelledAt: null,
    deletedAt: null,
  })
  const all = rows.filter(seasonIsArchived).map(seasonCard)
  const dir = q.sort === 'oldest' ? 1 : -1
  all.sort((a, b) =>
    dir * ((a.year ?? 0) - (b.year ?? 0))
    || dir * ((a.number ?? 0) - (b.number ?? 0))
    || a.title.localeCompare(b.title))
  return paginate(applyFilters(all, q), q)
}

export async function getArchivedTournaments(q: ArchiveQuery = {}): Promise<ArchivePage> {
  const rows = await loadTournaments({ reopenedAt: null })
  const archived = rows.filter(tournamentIsArchived)
  const counts = await participantCounts(archived.map((t) => t.id))
  const all = archived.map((t) => tournamentCard(t, counts.get(t.id) ?? 0))
  const dir = q.sort === 'oldest' ? 1 : -1
  all.sort((a, b) => dir * ((a.year ?? 0) - (b.year ?? 0)) || a.title.localeCompare(b.title))
  return paginate(applyFilters(all, q), q)
}

/**
 * Participant counts for a set of Tournaments, in ONE query.
 *
 * A count per card would be an N+1 that only shows up once the archive has a hundred entries in it,
 * which is exactly when nobody is watching.
 */
async function participantCounts(ids: number[]): Promise<Map<number, number>> {
  if (ids.length === 0) return new Map()
  const rows = await prisma.registration.groupBy({
    by: ['tournamentId'],
    where: { tournamentId: { in: ids } },
    _count: { _all: true },
  }).catch(() => [] as { tournamentId: number; _count: { _all: number } }[])
  return new Map(rows.map((r) => [r.tournamentId, r._count._all]))
}
