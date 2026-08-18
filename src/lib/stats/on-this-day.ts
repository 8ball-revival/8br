import 'server-only'
import { unstable_cache } from 'next/cache'

import { prisma } from '@/lib/prisma'
import { LEGITIMATE_MATCHES } from '@/lib/home/matches'

/**
 * "On This Day" — what happened on today's date in earlier years.
 *
 * ── On the historical dataset ────────────────────────────────────────────────────────────────────
 * The specification asks for an existing curated On This Day dataset to be located, backed up and
 * migrated. There is no such dataset. This feature has always been DERIVED: the previous
 * implementation read completed Season and Tournament matches out of the live database and built its
 * sentences from stored values, and nothing else ever fed it. Checked and found empty or absent: no
 * on-this-day JSON, seed, table or service anywhere in the repository; the archive CSV set has no
 * events file; and the archive-era `Achievement`, `HallOfFameEntry` and `Championship` tables hold
 * no rows.
 *
 * So the historical corpus IS the canonical match data, and it is preserved here rather than
 * migrated: every event the old implementation could produce, this one still produces. Nothing was
 * rewritten, corrected or manufactured. What is added is the milestone layer below — championships
 * and finals — derived from the same canonical rows.
 *
 * Events are derived at read time. Nothing is written, so the archive cannot drift away from the
 * competition results it describes, and rendering the homepage cannot create duplicate rows.
 */

export type OnThisDayKind = 'match' | 'final' | 'championship'

export interface OnThisDayEvent {
  /** Stable identity, used for deduplication and as the React key. */
  id: string
  /** ISO date of the event. */
  date: string
  year: number
  kind: OnThisDayKind
  /** Initials of the two competitors, or of the champion for a title event. */
  homeInitials: string
  awayInitials: string | null
  /** Factual one-line description built only from stored values. */
  description: string
  /** Where it happened, e.g. "8BRCAM Season 6". */
  context: string
  /** Link to the competition, when one can be resolved. */
  href: string | null
}

/** Two-letter initials from a stored display name. Falls back to the first characters. */
export function initialsOf(name: string | null | undefined): string {
  const s = (name ?? '').trim()
  if (!s) return '—'
  const parts = s.split(/[\s_.-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return s.slice(0, 2).toUpperCase()
}

interface MatchRow {
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

interface TitleRow {
  season_id: number
  number: number
  competition_name: string
  champion: string
  runner_up: string | null
  final_score: string | null
  completed_at: Date
}

/**
 * Everything that happened on this month and day in an earlier year.
 *
 * Two sources, combined and deduplicated:
 *
 *  1. Completed matches, using the same legitimacy rules as Recent Results and By the Numbers.
 *  2. Season championships, derived from the Season's own close record.
 *
 * A championship and the final that decided it fall on the same day and involve the same two
 * players, so they would read as two near-identical cards. The title wins and the final is dropped —
 * but only for that exact pairing. Two genuinely different matches on one date both survive, which
 * is why deduplication keys on the competition, the day and the players rather than on the day alone.
 */
export async function computeOnThisDay(now = new Date()): Promise<OnThisDayEvent[]> {
  const month = now.getUTCMonth() + 1
  const day = now.getUTCDate()
  const year = now.getUTCFullYear()

  let matches: MatchRow[] = []
  let titles: TitleRow[] = []

  try {
    ;[matches, titles] = await Promise.all([
      prisma.$queryRawUnsafe<MatchRow[]>(`
        SELECT * FROM (${LEGITIMATE_MATCHES}) lm
         WHERE EXTRACT(MONTH FROM lm.completed_at) = $1
           AND EXTRACT(DAY   FROM lm.completed_at) = $2
           AND EXTRACT(YEAR  FROM lm.completed_at) < $3
         ORDER BY lm.completed_at DESC, lm.match_key DESC
         LIMIT 24
      `, month, day, year),
      prisma.$queryRawUnsafe<TitleRow[]>(`
        SELECT s."id" AS season_id, s."number", cs."name" AS competition_name,
               coalesce(s."championHandle", s."championName") AS champion,
               coalesce(s."runnerUpHandle", s."runnerUpName") AS runner_up,
               s."finalScore" AS final_score, s."completedAt" AS completed_at
          FROM "public"."season" s
          JOIN "public"."competition_series" cs ON cs."id" = s."competitionSeriesId"
         WHERE s."lifecycleState" = 'COMPLETED'
           AND s."completedAt" IS NOT NULL
           AND btrim(coalesce(s."championName", '')) <> ''
           AND EXTRACT(MONTH FROM s."completedAt") = $1
           AND EXTRACT(DAY   FROM s."completedAt") = $2
           AND EXTRACT(YEAR  FROM s."completedAt") < $3
         ORDER BY s."completedAt" DESC
         LIMIT 12
      `, month, day, year),
    ])
  } catch {
    return []
  }

  // Resolve the competitions the matches belong to, so a card can say where it happened and link there.
  const seasonIds = [...new Set(matches.filter((m) => m.kind === 'season').map((m) => m.competition_id))]
  const tournamentIds = [...new Set(matches.filter((m) => m.kind === 'tournament').map((m) => m.competition_id))]

  const [seasons, tournaments] = await Promise.all([
    seasonIds.length
      ? prisma.season.findMany({
        where: { id: { in: seasonIds } },
        select: { id: true, number: true, competitionSeries: { select: { name: true } } },
      })
      : Promise.resolve([]),
    tournamentIds.length
      ? prisma.tournament.findMany({ where: { id: { in: tournamentIds } }, select: { id: true, name: true, number: true } })
      : Promise.resolve([]),
  ])
  const seasonById = new Map(seasons.map((s) => [s.id, s]))
  const tournamentById = new Map(tournaments.map((t) => [t.id, t]))

  const events: OnThisDayEvent[] = []
  /** Keys of (competition, date, players) already represented by a title event. */
  const claimed = new Set<string>()

  const pairKey = (competition: string, date: Date, a: string, b: string) =>
    `${competition}|${date.toISOString().slice(0, 10)}|${[a.toLowerCase(), b.toLowerCase()].sort().join('~')}`

  // Championships first: they outrank the final that produced them.
  for (const t of titles) {
    const date = new Date(t.completed_at)
    const context = `${t.competition_name} Season ${t.number}`
    if (t.runner_up) claimed.add(pairKey(`season:${t.season_id}`, date, t.champion, t.runner_up))

    events.push({
      id: `title:season:${t.season_id}`,
      date: date.toISOString(),
      year: date.getUTCFullYear(),
      kind: 'championship',
      homeInitials: initialsOf(t.champion),
      awayInitials: t.runner_up ? initialsOf(t.runner_up) : null,
      description: t.runner_up
        ? `${t.champion} won ${context}, beating ${t.runner_up}${t.final_score ? ` ${t.final_score}` : ''}`
        : `${t.champion} won ${context}`,
      context,
      href: `/seasons/${t.season_id}`,
    })
  }

  for (const m of matches) {
    const date = new Date(m.completed_at)
    const season = m.kind === 'season' ? seasonById.get(m.competition_id) : null
    const tournament = m.kind === 'tournament' ? tournamentById.get(m.competition_id) : null

    const context = season
      ? `${season.competitionSeries.name} Season ${season.number}`
      : tournament?.name ?? ''
    const competitionKey = season ? `season:${season.id}` : `tournament:${m.competition_id}`

    // Skip the final that a championship card already tells the story of.
    if (claimed.has(pairKey(competitionKey, date, m.home_name, m.away_name))) continue

    const isFinal = m.stage === 'playoff' && /final/i.test(m.round_label ?? '')
    const [first, second, fs, ss] = m.home_games >= m.away_games
      ? [m.home_name, m.away_name, m.home_games, m.away_games]
      : [m.away_name, m.home_name, m.away_games, m.home_games]

    // A forfeit is reported as a forfeit. Its recorded score is an outcome, not frames played, so
    // presenting it as "beat X 9–0" would be inventing a match that never happened.
    const description = m.is_forfeit
      ? `${first} advanced over ${second} by forfeit`
      : `${first} ${fs === ss ? 'drew with' : 'beat'} ${second} ${fs}–${ss}${isFinal ? ' in the final' : ''}`

    events.push({
      id: `match:${m.match_key}`,
      date: date.toISOString(),
      year: date.getUTCFullYear(),
      kind: isFinal ? 'final' : 'match',
      homeInitials: initialsOf(first),
      awayInitials: initialsOf(second),
      description,
      context,
      href: season ? `/seasons/${season.id}` : tournament?.number != null ? `/tournaments/${tournament.number}` : null,
    })
  }

  // Newest year first; a championship leads its own day.
  return events
    .sort((a, b) => b.date.localeCompare(a.date) || (a.kind === 'championship' ? -1 : 1))
    .slice(0, 12)
}

export const ON_THIS_DAY_TAG = 'on-this-day'

/**
 * Cached for an hour. The set only changes at midnight or when a result is entered, and the homepage
 * should not re-run two date queries for every visitor.
 */
export const getOnThisDayEvents = unstable_cache(async () => computeOnThisDay(), ['on-this-day'], {
  tags: [ON_THIS_DAY_TAG],
  revalidate: 3600,
})
