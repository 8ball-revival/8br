import 'server-only'
import { unstable_cache } from 'next/cache'

import { prisma } from '@/lib/prisma'

/**
 * "By the Numbers" — the homepage registry totals.
 *
 * Everything is computed from the live PostgreSQL competition data. Nothing reads an archive file,
 * archive-viewer export, static JSON or any external database.
 *
 * All seven figures come back in ONE round trip: a single query of independent scalar subqueries,
 * rather than seven queries or (worse) loading tables into memory to count in JS. The four match
 * tables are unioned once and reused for the match/game figures.
 *
 * A match counts as played when BOTH game scores are recorded — that is the factual signal that a
 * result exists, and it is the same set the game total sums over, so the two figures can never
 * disagree.
 */

export interface RegistryStats {
  /** Inclusive span from the earliest recorded competition year to the current year. */
  yearsOfHistory: number
  /** The earliest recorded competition year, for the "Since YYYY" line. Null when there is no data. */
  since: number | null
  seasons: number
  matchesPlayed: number
  players: number
  champions: number
  countries: number
  gamesPlayed: number
}

const EMPTY: RegistryStats = {
  yearsOfHistory: 0,
  since: null,
  seasons: 0,
  matchesPlayed: 0,
  players: 0,
  champions: 0,
  countries: 0,
  gamesPlayed: 0,
}

/**
 * Every completed match across Seasons and Tournaments (group stage + playoffs), reduced to the
 * two columns the totals need. Defined once so "matches played" and "games played" always agree.
 */
const COMPLETED_MATCHES = `
  SELECT "homeGames" AS h, "awayGames" AS a FROM "public"."season_match"
    WHERE "homeGames" IS NOT NULL AND "awayGames" IS NOT NULL
  UNION ALL
  SELECT "homeGames", "awayGames" FROM "public"."season_playoff_match"
    WHERE "homeGames" IS NOT NULL AND "awayGames" IS NOT NULL
  UNION ALL
  SELECT "homeGames", "awayGames" FROM "public"."comp_tournament_match"
    WHERE "homeGames" IS NOT NULL AND "awayGames" IS NOT NULL
  UNION ALL
  SELECT "homeGames", "awayGames" FROM "public"."comp_playoff_match"
    WHERE "homeGames" IS NOT NULL AND "awayGames" IS NOT NULL
`

/** Champions of finished competitions, from both competition types. */
const CHAMPIONS = `
  SELECT DISTINCT lower(btrim("championName")) AS c FROM "public"."season"
    WHERE "championName" IS NOT NULL AND btrim("championName") <> ''
  UNION
  SELECT DISTINCT lower(btrim("championName")) FROM "public"."comp_tournament"
    WHERE "championName" IS NOT NULL AND btrim("championName") <> ''
`

const STATS_SQL = `
SELECT
  (SELECT min(y) FROM (
     SELECT min("competitionYear") AS y FROM "public"."season"
     UNION ALL
     SELECT min("competitionYear") FROM "public"."comp_tournament"
   ) t)                                                          AS since,
  (SELECT count(*) FROM "public"."season")                       AS seasons,
  (SELECT count(*) FROM (${COMPLETED_MATCHES}) m)                AS matches_played,
  (SELECT coalesce(sum(GREATEST(m.h, 0) + GREATEST(m.a, 0)), 0)
     FROM (${COMPLETED_MATCHES}) m)                              AS games_played,
  (SELECT count(DISTINCT "playerId") FROM "public"."rating_ledger") AS players,
  (SELECT count(*) FROM (${CHAMPIONS}) c)                        AS champions,
  (SELECT count(DISTINCT lower(btrim(p."country")))
     FROM "public"."Player" p
     WHERE p."country" IS NOT NULL AND btrim(p."country") <> ''
       AND EXISTS (SELECT 1 FROM "public"."rating_ledger" r WHERE r."playerId" = p."id")) AS countries
`

type Row = Record<string, bigint | number | null>
const num = (v: bigint | number | null | undefined): number => (v == null ? 0 : Number(v))

/**
 * Uncached computation. Exported so tests can call it directly — `unstable_cache` only works inside
 * a Next.js request context and throws in a bare script.
 */
export async function computeRegistryStats(): Promise<RegistryStats> {
  try {
    const rows = await prisma.$queryRawUnsafe<Row[]>(STATS_SQL)
    const r = rows[0]
    if (!r) return EMPTY
    const since = r.since == null ? null : Number(r.since)
    return {
      since,
      // Inclusive: a single year of activity reads as 1, not 0.
      yearsOfHistory: since == null ? 0 : Math.max(1, new Date().getFullYear() - since + 1),
      seasons: num(r.seasons),
      matchesPlayed: num(r.matches_played),
      players: num(r.players),
      champions: num(r.champions),
      countries: num(r.countries),
      gamesPlayed: num(r.games_played),
    }
  } catch {
    // The homepage must still render if the stats query fails.
    return EMPTY
  }
}

/**
 * Cached under a tag so the figures refresh when competition data changes, without every homepage
 * hit re-running the aggregate. Call `revalidateTag(REGISTRY_STATS_TAG)` after a result is entered
 * or a competition closes.
 */
export const REGISTRY_STATS_TAG = 'registry-stats'

export const getRegistryStats = unstable_cache(computeRegistryStats, ['registry-stats'], {
  tags: [REGISTRY_STATS_TAG],
  revalidate: 300,
})
