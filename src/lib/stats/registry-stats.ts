import 'server-only'
import { unstable_cache } from 'next/cache'

import { prisma } from '@/lib/prisma'
import { LEGITIMATE_MATCHES, PLAYED_GAME_MATCHES } from '@/lib/home/matches'

/**
 * "By the Numbers" — the homepage registry totals.
 *
 * Every figure except Countries is computed from canonical Season and Tournament data in the live
 * database. Nothing reads an archive file, an export, a static JSON, user-account totals or ladder
 * activity: those would inflate the numbers with things that are not competition results.
 *
 * The match-derived figures share one definition of a legitimate match with Recent Results and On
 * This Day (see `home/matches.ts`), so the three surfaces on the homepage can never disagree about
 * which matches are real.
 *
 * All figures come back in one round trip — a single query of independent scalar subqueries, rather
 * than eight queries or loading tables into memory to count in JS.
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
 * Countries is a fixed figure by explicit instruction — the only statistic on the page that is not
 * derived. Named rather than inlined so it is obvious that it is deliberate and not a stale query.
 */
export const FIXED_COUNTRIES = 8

/**
 * Seasons that actually count.
 *
 * Every Season row counts. The lifecycle enum has no cancelled or draft-deleted state — a scrapped
 * Season is deleted outright rather than flagged — so there is nothing here to filter out, and a
 * WHERE clause against a state that cannot exist would be a comment pretending to be a safeguard.
 * An in-progress Season is still a Season; only the CHAMPION figures require a completed one.
 */
const VALID_SEASONS = `
  SELECT s."id", s."competitionYear"
    FROM "public"."season" s
`

/**
 * Tournaments that actually count.
 *
 * Archived tournaments are included: archiving makes a competition read-only history, which is
 * exactly what these totals are counting. It is not the same as cancelling one.
 */
const VALID_TOURNAMENTS = `
  SELECT t."id", t."competitionYear"
    FROM "public"."comp_tournament" t
`

/**
 * Every unique canonical player who has won a COMPLETED competition.
 *
 * Two things matter here. Only completed competitions award a title — an active, reopened, draft or
 * cancelled one does not, whatever champion field may be left on the row. And this counts unique
 * PLAYERS, not championship events: somebody with four titles is one champion.
 *
 * Identity resolves through `player_merge` so a merged pair counts once, falling back to the
 * canonical player id, then to the recorded name for archive-era rows that never had a linked
 * profile.
 */
const CHAMPION_IDENTITIES = `
  SELECT DISTINCT coalesce(
           'player:' || coalesce(pm."canonicalPlayerId", s."championPlayerId"),
           'name:' || lower(btrim(s."championName"))
         ) AS identity
    FROM "public"."season" s
    LEFT JOIN "public"."PlayerMerge" pm
      ON pm."mergedPlayerId" = s."championPlayerId" AND pm."status" = 'APPROVED'
   WHERE s."lifecycleState" = 'COMPLETED'
     AND (s."championPlayerId" IS NOT NULL OR btrim(coalesce(s."championName", '')) <> '')

  UNION

  SELECT DISTINCT 'name:' || lower(btrim(t."championName"))
    FROM "public"."comp_tournament" t
   WHERE t."status" = 'COMPLETED'
     AND btrim(coalesce(t."championName", '')) <> ''
`

/**
 * Unique canonical players who took part in at least one valid competition.
 *
 * Read from entrant/registration records — the fact of entering a competition — rather than from
 * accounts. An account that never entered anything is not a competitor, and counting it would
 * inflate the figure with sign-ups.
 */
const PARTICIPANT_IDENTITIES = `
  SELECT DISTINCT coalesce(
           'player:' || coalesce(pm."canonicalPlayerId", e."playerId"),
           'name:' || lower(btrim(e."username"))
         ) AS identity
    FROM "public"."season_entrant" e
    JOIN (${VALID_SEASONS}) vs ON vs."id" = e."seasonId"
    LEFT JOIN "public"."PlayerMerge" pm
      ON pm."mergedPlayerId" = e."playerId" AND pm."status" = 'APPROVED'
   WHERE e."playerId" IS NOT NULL OR btrim(coalesce(e."username", '')) <> ''

  UNION

  SELECT DISTINCT coalesce(
           'player:' || coalesce(pm."canonicalPlayerId", r."playerId"),
           'name:' || lower(btrim(r."username"))
         )
    FROM "public"."comp_registration" r
    JOIN (${VALID_TOURNAMENTS}) vt ON vt."id" = r."tournamentId"
    LEFT JOIN "public"."PlayerMerge" pm
      ON pm."mergedPlayerId" = r."playerId" AND pm."status" = 'APPROVED'
   WHERE r."playerId" IS NOT NULL OR btrim(coalesce(r."username", '')) <> ''
`

const STATS_SQL = `
SELECT
  (SELECT min(y) FROM (
     SELECT min("competitionYear") AS y FROM (${VALID_SEASONS}) a
     UNION ALL
     SELECT min("competitionYear")      FROM (${VALID_TOURNAMENTS}) b
   ) t)                                                              AS since,
  (SELECT count(*) FROM (${VALID_SEASONS}) s)                        AS seasons,
  (SELECT count(*) FROM (${LEGITIMATE_MATCHES}) m)                   AS matches_played,
  (SELECT coalesce(sum(GREATEST(m.home_games, 0) + GREATEST(m.away_games, 0)), 0)
     FROM (${PLAYED_GAME_MATCHES}) m)                                AS games_played,
  (SELECT count(*) FROM (${PARTICIPANT_IDENTITIES}) p)               AS players,
  (SELECT count(*) FROM (${CHAMPION_IDENTITIES}) c)                  AS champions
`

type Row = Record<string, bigint | number | null>
const num = (v: bigint | number | null | undefined): number => (v == null ? 0 : Number(v))

/**
 * Uncached computation. Exported so tests can call it directly — `unstable_cache` only works inside
 * a Next.js request context and throws in a bare script.
 */
export async function computeRegistryStats(now = new Date()): Promise<RegistryStats> {
  try {
    const rows = await prisma.$queryRawUnsafe<Row[]>(STATS_SQL)
    const r = rows[0]
    if (!r) return { ...EMPTY, countries: FIXED_COUNTRIES }
    const since = r.since == null ? null : Number(r.since)
    return {
      since,
      // Inclusive: a single year of activity reads as 1, not 0.
      yearsOfHistory: since == null ? 0 : Math.max(1, now.getFullYear() - since + 1),
      seasons: num(r.seasons),
      matchesPlayed: num(r.matches_played),
      players: num(r.players),
      champions: num(r.champions),
      countries: FIXED_COUNTRIES,
      gamesPlayed: num(r.games_played),
    }
  } catch (err) {
    console.warn('[registry-stats] query failed:', err instanceof Error ? err.message : err)
    // The homepage must still render if the stats query fails.
    return { ...EMPTY, countries: FIXED_COUNTRIES }
  }
}

/**
 * Cached under a tag so the figures refresh when competition data changes, without every homepage
 * hit re-running the aggregate. Call `revalidateTag(REGISTRY_STATS_TAG)` after a result is entered
 * or a competition closes.
 */
export const REGISTRY_STATS_TAG = 'registry-stats'

export const getRegistryStats = unstable_cache(async () => computeRegistryStats(), ['registry-stats'], {
  tags: [REGISTRY_STATS_TAG],
  revalidate: 300,
})
