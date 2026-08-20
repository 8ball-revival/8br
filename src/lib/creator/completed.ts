import 'server-only'
import { prisma } from '@/lib/prisma'
import { seasonIsArchived, tournamentIsArchived, type DataCompleteness } from '@/lib/competition/lifecycle-rules'

/**
 * The completed records Creator manages.
 *
 * Deliberately a LIST, not a grid of cards. There will be a hundred of these, and a card grid
 * answers "browse what exists" — which is what the public Archives is for. Creator's question is
 * "find the one I need to correct", and that is a table: scannable columns, sortable, filterable,
 * a row per record.
 *
 * Eligibility comes from the shared rule, so this list and /seasons can never disagree
 * about what "completed" means. That matters here more than anywhere: a record visible in one and
 * not the other would mean somebody is correcting something the public cannot see, or the public is
 * reading something nobody can correct.
 */

export interface CompletedRow {
  kind: 'season' | 'tournament'
  id: number
  title: string
  /** Season number, shown as secondary information. Null for Tournaments, which lead with a title. */
  number: number | null
  competition: string
  competitionSeriesId: number | null
  /** Historical competition year. NEVER the row's creation or import time. */
  year: number | null
  division: string | null
  entrants: number
  champion: string | null
  completeness: DataCompleteness
  /** When it was finalised, where that is trustworthy. */
  completedAt: string | null
  /** Where Creator opens it. */
  href: string
  /** The public, read-only archive page. */
  publicHref: string
}

export interface CompletedQuery {
  type?: 'all' | 'seasons' | 'cups'
  competitionSeriesId?: number | null
  year?: number | null
  division?: string | null
  /** Matches title, competition, champion handle or champion preferred name. */
  search?: string | null
  sort?: 'newest' | 'oldest'
  page?: number
  perPage?: number
}

export interface CompletedPage {
  rows: CompletedRow[]
  total: number
  page: number
  perPage: number
  pages: number
  facets: {
    competitions: { id: number; name: string }[]
    years: number[]
    divisions: string[]
    counts: { all: number; seasons: number; tournaments: number }
  }
}

const PER_PAGE = 25

export async function listCompleted(q: CompletedQuery = {}): Promise<CompletedPage> {
  const [seasonRows, tournamentRows] = await Promise.all([
    prisma.season.findMany({
      where: { lifecycleState: 'COMPLETED', ladderAppliedAt: { not: null }, reopenedAt: null, cancelledAt: null, deletedAt: null },
      select: {
        id: true, number: true, competitionYear: true, subtitle: true, division: true,
        lifecycleState: true, ladderAppliedAt: true, reopenedAt: true, cancelledAt: true, deletedAt: true,
        dataCompleteness: true, entrantsCount: true, championHandle: true, championName: true,
        completedAt: true, competitionSeriesId: true,
        competitionSeries: { select: { name: true } },
      },
    }),
    prisma.tournament.findMany({
      where: { reopenedAt: null },
      select: {
        id: true, name: true, number: true, competitionYear: true, lifecycleState: true, status: true,
        archivedAt: true, reopenedAt: true, dataCompleteness: true, entrantsCount: true,
        championHandle: true, championName: true,
      },
    }).catch(() => []),
  ])

  const seasons: CompletedRow[] = seasonRows.filter(seasonIsArchived).map((s) => ({
    kind: 'season' as const,
    id: s.id,
    title: s.subtitle?.trim() || `${s.competitionSeries?.name ?? 'Season'} Season ${s.number}`,
    number: s.number,
    competition: s.competitionSeries?.name ?? 'Competition',
    competitionSeriesId: s.competitionSeriesId,
    year: s.competitionYear,
    division: s.division,
    entrants: s.entrantsCount,
    champion: s.championHandle || s.championName || null,
    completeness: s.dataCompleteness === 'partial' ? 'partial' : 'full',
    // The finalisation stamp, which is when the record actually became the record. Falls back to
    // the lifecycle timestamp; never to createdAt, which for a reconstruction is when somebody
    // opened the form.
    completedAt: (s.ladderAppliedAt ?? s.completedAt)?.toISOString() ?? null,
    href: `/creator/seasons/${s.id}`,
    publicHref: `/seasons/${s.id}`,
  }))

  const tournaments: CompletedRow[] = tournamentRows.filter(tournamentIsArchived).map((t) => ({
    kind: 'tournament' as const,
    id: t.id,
    title: t.name,
    number: null,
    competition: 'Cup',
    competitionSeriesId: null,
    year: t.competitionYear,
    division: null,
    entrants: t.entrantsCount ?? 0,
    champion: t.championHandle || t.championName || null,
    completeness: t.dataCompleteness === 'partial' ? 'partial' : 'full',
    completedAt: t.archivedAt?.toISOString() ?? null,
    href: `/creator/cups/${t.id}`,
    publicHref: `/cups/${t.number ?? t.id}`,
  }))

  const all = [...seasons, ...tournaments]
  const counts = { all: all.length, seasons: seasons.length, tournaments: tournaments.length }

  const type = q.type ?? 'all'
  let rows = type === 'seasons' ? seasons : type === 'cups' ? tournaments : all

  // Facets come from the TYPE-SELECTED set, so choosing Tournaments cannot offer a Season-only
  // Competition that would then match nothing.
  const competitions = new Map<number, string>()
  const years = new Set<number>()
  const divisions = new Set<string>()
  for (const r of rows) {
    if (r.competitionSeriesId != null) competitions.set(r.competitionSeriesId, r.competition)
    if (r.year != null) years.add(r.year)
    if (r.division) divisions.add(r.division)
  }

  const search = q.search?.trim().toLowerCase() ?? ''
  rows = rows.filter((r) => {
    if (q.competitionSeriesId != null && r.competitionSeriesId !== q.competitionSeriesId) return false
    if (q.year != null && r.year !== q.year) return false
    if (q.division && r.division !== q.division) return false
    if (search) {
      const hay = [r.title, r.competition, r.champion, r.number != null ? `season ${r.number}` : null]
      if (!hay.some((h) => (h ?? '').toLowerCase().includes(search))) return false
    }
    return true
  })

  // Historical order: the year it was played, then the Season number. Never row id or created time.
  const dir = q.sort === 'oldest' ? 1 : -1
  rows.sort((a, b) =>
    dir * ((a.year ?? 0) - (b.year ?? 0))
    || dir * ((a.number ?? 0) - (b.number ?? 0))
    || a.title.localeCompare(b.title))

  const perPage = Math.min(Math.max(q.perPage ?? PER_PAGE, 1), 200)
  const pages = Math.max(1, Math.ceil(rows.length / perPage))
  const page = Math.min(Math.max(q.page ?? 1, 1), pages)

  return {
    rows: rows.slice((page - 1) * perPage, page * perPage),
    total: rows.length,
    page,
    perPage,
    pages,
    facets: {
      competitions: [...competitions].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      years: [...years].sort((a, b) => b - a),
      divisions: [...divisions].sort(),
      counts,
    },
  }
}
