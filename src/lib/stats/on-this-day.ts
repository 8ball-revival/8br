import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * "On This Day" — completed results from the same calendar month and day in EARLIER years.
 *
 * Reads only the live competition database. Every field shown is stored data: the date, the two
 * competitors and their scores. Nothing is inferred, embellished or generated — if a fact is not in
 * the row, it is not displayed.
 */

export interface OnThisDayEvent {
  /** ISO date of the result. */
  date: string
  year: number
  /** Initials of the two competitors, e.g. "AB" / "CD". */
  homeInitials: string
  awayInitials: string
  /** Factual one-line description built only from stored values. */
  description: string
  /** Where it happened, e.g. "Season 6" or a tournament name. */
  context: string
  /** True for a final / championship-deciding result. */
  isFinal: boolean
}

/** Two-letter initials from a stored display name. Falls back to the first characters. */
export function initialsOf(name: string | null | undefined): string {
  const s = (name ?? '').trim()
  if (!s) return '—'
  const parts = s.split(/[\s_.-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return s.slice(0, 2).toUpperCase()
}

interface Row {
  completedAt: Date
  homeName: string | null
  awayName: string | null
  homeGames: number | null
  awayGames: number | null
  context: string | null
  isFinal: boolean
}

/**
 * Season and Tournament results that landed on today's month/day in a previous year.
 *
 * Playoff rows are flagged as finals so the copy can say so; group-stage rows are not. The month/day
 * comparison happens in SQL so only the matching rows come back.
 */
export async function getOnThisDayEvents(now = new Date()): Promise<OnThisDayEvent[]> {
  const month = now.getMonth() + 1
  const day = now.getDate()
  const year = now.getFullYear()

  const sql = `
    SELECT * FROM (
      SELECT m."completedAt", m."homeUsername" AS "homeName", m."awayUsername" AS "awayName",
             m."homeGames", m."awayGames",
             'Season ' || s."number" AS context, false AS "isFinal"
        FROM "public"."season_match" m
        JOIN "public"."season" s ON s."id" = m."seasonId"
       WHERE m."completedAt" IS NOT NULL AND m."homeGames" IS NOT NULL AND m."awayGames" IS NOT NULL
      UNION ALL
      SELECT m."completedAt", m."homeUsername", m."awayUsername", m."homeGames", m."awayGames",
             'Season ' || s."number", true
        FROM "public"."season_playoff_match" m
        JOIN "public"."season" s ON s."id" = m."seasonId"
       WHERE m."completedAt" IS NOT NULL AND m."homeGames" IS NOT NULL AND m."awayGames" IS NOT NULL
      UNION ALL
      SELECT m."completedAt", m."homeUsername", m."awayUsername", m."homeGames", m."awayGames",
             t."name", false
        FROM "public"."comp_tournament_match" m
        JOIN "public"."comp_tournament" t ON t."id" = m."tournamentId"
       WHERE m."completedAt" IS NOT NULL AND m."homeGames" IS NOT NULL AND m."awayGames" IS NOT NULL
      UNION ALL
      SELECT m."completedAt", m."homeUsername", m."awayUsername", m."homeGames", m."awayGames",
             t."name", true
        FROM "public"."comp_playoff_match" m
        JOIN "public"."comp_tournament" t ON t."id" = m."tournamentId"
       WHERE m."completedAt" IS NOT NULL AND m."homeGames" IS NOT NULL AND m."awayGames" IS NOT NULL
    ) e
    WHERE EXTRACT(MONTH FROM e."completedAt") = $1
      AND EXTRACT(DAY   FROM e."completedAt") = $2
      AND EXTRACT(YEAR  FROM e."completedAt") < $3
    ORDER BY e."completedAt" DESC
    LIMIT 12
  `

  let rows: Row[] = []
  try {
    rows = await prisma.$queryRawUnsafe<Row[]>(sql, month, day, year)
  } catch {
    return []
  }

  return rows.map((r) => {
    const d = new Date(r.completedAt)
    const home = r.homeName ?? 'Unknown'
    const away = r.awayName ?? 'Unknown'
    const hg = r.homeGames ?? 0
    const ag = r.awayGames ?? 0
    // Winner is whoever holds the higher recorded score; equal scores are reported as a draw
    // rather than guessed at.
    const verb = hg === ag ? 'drew with' : 'beat'
    const [first, second, fs, ss] = hg >= ag ? [home, away, hg, ag] : [away, home, ag, hg]
    return {
      date: d.toISOString(),
      year: d.getFullYear(),
      homeInitials: initialsOf(first),
      awayInitials: initialsOf(second),
      description: `${first} ${verb} ${second} ${fs}–${ss}${r.isFinal ? ' in the final' : ''}`,
      context: r.context ?? '',
      isFinal: r.isFinal,
    }
  })
}
