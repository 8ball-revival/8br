import 'server-only'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { LEGITIMATE_MATCHES } from './matches'

/**
 * Recent Results — the three most recently completed legitimate matches.
 *
 * "Legitimate" is not decided here: it comes from the shared definition in `matches.ts`, the same
 * one By the Numbers counts and On This Day reads. That is deliberate — three surfaces on one page
 * disagreeing about which matches are real would be visible to a visitor.
 */

export interface RecentResult {
  /** Stable identity, e.g. "season_playoff:412". Also the React key. */
  key: string
  competitionName: string
  /** Season or Tournament, plus the stage when the data records one. */
  competitionType: string
  stageLabel: string | null
  /** Where the competition's own page lives. */
  href: string
  /** The competition's icon, when its Competition has one. */
  iconMediaId: string | null
  /** Initials fallback when there is no icon. */
  initials: string
  homeName: string
  awayName: string
  homeGames: number
  awayGames: number
  isForfeit: boolean
  /** ISO string: this crosses `unstable_cache`, which turns a Date into one. */
  completedAt: string
}

interface Row {
  match_key: string
  kind: string
  stage: string
  competition_id: number
  round_label: string | null
  home_name: string
  away_name: string
  home_games: number
  away_games: number
  completed_at: Date
  is_forfeit: boolean
}

/** Two-letter initials for the fallback badge, matching the Competition convention elsewhere. */
function initialsOf(source: string): string {
  const s = source.trim()
  if (!s) return '??'
  const words = s.split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return s.slice(0, 2).toUpperCase()
}

/** Uncached. Exported so tests can call it without a Next request context. */
export async function computeRecentResults(limit = 3): Promise<RecentResult[]> {
  let rows: Row[] = []
  try {
    rows = await prisma.$queryRawUnsafe<Row[]>(`
      SELECT * FROM (${LEGITIMATE_MATCHES}) lm
      -- Newest first. match_key is the tie-break so two results completed in the same instant come
      -- back in the same order every time rather than at the planner's discretion.
      ORDER BY lm.completed_at DESC, lm.match_key DESC
      LIMIT ${Math.max(1, Math.trunc(limit))}
    `)
  } catch {
    // The homepage must render even if this query fails.
    return []
  }
  if (rows.length === 0) return []

  // Resolve the competitions the results belong to, in two grouped queries rather than per row.
  const seasonIds = rows.filter((r) => r.kind === 'season').map((r) => r.competition_id)
  const tournamentIds = rows.filter((r) => r.kind === 'tournament').map((r) => r.competition_id)

  const [seasons, tournaments] = await Promise.all([
    seasonIds.length
      ? prisma.season.findMany({
        where: { id: { in: seasonIds } },
        select: {
          id: true, number: true, competitionYear: true,
          competitionSeries: { select: { name: true, shortName: true, iconMediaId: true } },
        },
      })
      : Promise.resolve([]),
    tournamentIds.length
      ? prisma.tournament.findMany({
        where: { id: { in: tournamentIds } },
        select: { id: true, name: true, number: true },
      })
      : Promise.resolve([]),
  ])

  const seasonById = new Map(seasons.map((s) => [s.id, s]))
  const tournamentById = new Map(tournaments.map((t) => [t.id, t]))

  const out: RecentResult[] = []
  for (const r of rows) {
    if (r.kind === 'season') {
      const s = seasonById.get(r.competition_id)
      if (!s) continue
      const name = `${s.competitionSeries.name} Season ${s.number}`
      out.push({
        key: r.match_key,
        competitionName: name,
        competitionType: 'Season',
        stageLabel: r.stage === 'playoff' ? r.round_label ?? 'Playoffs' : 'Group stage',
        href: `/seasons/${s.id}`,
        iconMediaId: s.competitionSeries.iconMediaId,
        initials: initialsOf(s.competitionSeries.shortName || s.competitionSeries.name),
        homeName: r.home_name,
        awayName: r.away_name,
        homeGames: r.home_games,
        awayGames: r.away_games,
        isForfeit: r.is_forfeit,
        completedAt: new Date(r.completed_at).toISOString(),
      })
    } else {
      const t = tournamentById.get(r.competition_id)
      if (!t) continue
      out.push({
        key: r.match_key,
        competitionName: t.name,
        competitionType: 'Cup',
        stageLabel: r.stage === 'playoff' ? r.round_label ?? 'Playoffs' : 'Group stage',
        href: t.number != null ? `/cups/${t.number}` : '/cups',
        iconMediaId: null,
        initials: initialsOf(t.name),
        homeName: r.home_name,
        awayName: r.away_name,
        homeGames: r.home_games,
        awayGames: r.away_games,
        isForfeit: r.is_forfeit,
        completedAt: new Date(r.completed_at).toISOString(),
      })
    }
  }

  return out
}

export const RECENT_RESULTS_TAG = 'recent-results'

export const getRecentResults = unstable_cache(
  async () => computeRecentResults(3),
  ['home-recent-results'],
  { tags: [RECENT_RESULTS_TAG], revalidate: 300 },
)
