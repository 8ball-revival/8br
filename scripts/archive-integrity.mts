// RETIRED — see scripts/_retired.mjs. Importing this file refuses to run.
import './_retired.mjs'

/**
 * Row counts and content checksums for the canonical competition record.
 *
 * Presentation work should never move a competitive result. This prints a fingerprint of the tables
 * that hold the record — counts plus an order-independent checksum of the fields that matter — so a
 * before/after comparison proves nothing shifted while a page was being rebuilt.
 *
 * The checksum is `md5` over a sorted concatenation of the identifying columns, so it is stable
 * regardless of physical row order or when a row was written. Columns that legitimately change
 * (updatedAt, cache stamps) are deliberately excluded.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/archive-integrity.mts
 *       ... > before.json      (then again after, and diff the two)
 */
import { prisma } from '../src/lib/prisma.ts'

/** table → the expression whose md5 fingerprints one row. */
const FINGERPRINTS: Record<string, string> = {
  // Identity
  '"Player"': `"id" || '|' || "primaryName" || '|' || coalesce("cueverseId",'') || '|' || coalesce("legacyPlayerId",'')`,
  '"PlayerAlias"': `"playerId" || '|' || "alias" || '|' || "aliasType"::text`,

  // Seasons and their results
  season: `"id"::text || '|' || "number"::text || '|' || "competitionYear"::text || '|' || "lifecycleState" || '|' || coalesce("championPlayerId",'') || '|' || coalesce("runnerUpHandle",'')`,
  season_entrant: `"id"::text || '|' || "seasonId"::text || '|' || "username" || '|' || coalesce("playerId",'') || '|' || "status"`,
  season_group: `"id"::text || '|' || "seasonId"::text || '|' || "code"`,
  season_match: `"id"::text || '|' || "seasonId"::text || '|' || coalesce("homeUsername",'') || '|' || coalesce("awayUsername",'') || '|' || coalesce("homeGames"::text,'') || '|' || coalesce("awayGames"::text,'') || '|' || "status"`,
  season_standing: `"id"::text || '|' || "entrantId"::text || '|' || "points"::text || '|' || "wins"::text || '|' || "losses"::text || '|' || "rank"::text`,
  season_playoff_match: `"id"::text || '|' || "seasonId"::text || '|' || coalesce("homeUsername",'') || '|' || coalesce("awayUsername",'') || '|' || coalesce("homeGames"::text,'') || '|' || coalesce("awayGames"::text,'') || '|' || coalesce("winnerEntrantId"::text,'')`,

  // Tournaments and their results
  comp_tournament: `"id"::text || '|' || "name" || '|' || "competitionYear"::text || '|' || coalesce("championHandle",'')`,
  comp_tournament_match: `"id"::text || '|' || coalesce("homeUsername",'') || '|' || coalesce("awayUsername",'') || '|' || coalesce("homeGames"::text,'') || '|' || coalesce("awayGames"::text,'')`,
  comp_playoff_match: `"id"::text || '|' || coalesce("homeUsername",'') || '|' || coalesce("awayUsername",'') || '|' || coalesce("homeGames"::text,'') || '|' || coalesce("awayGames"::text,'')`,
  comp_registration: `"id"::text || '|' || "tournamentId"::text || '|' || "username" || '|' || coalesce("playerId",'')`,

  // The ranking record itself
  rating_ledger: `"matchKey" || '|' || "playerId" || '|' || "result" || '|' || "preRating"::text || '|' || "postRating"::text || '|' || "sequence"::text`,

  // Media, which a redesign must also leave alone
  media_upload: `"id"::text || '|' || "filename" || '|' || "mimeType" || '|' || "bytes"::text`,
}

async function fingerprint(table: string, expr: string) {
  const q = table.startsWith('"') ? `"public".${table}` : `"public"."${table}"`
  const rows = await prisma.$queryRawUnsafe<{ n: bigint; sum: string | null }[]>(
    `SELECT count(*) AS n, md5(string_agg(f, '\n' ORDER BY f)) AS sum
       FROM (SELECT ${expr} AS f FROM ${q}) t`,
  )
  return { rows: Number(rows[0]?.n ?? 0), checksum: rows[0]?.sum ?? null }
}

const out: Record<string, { rows: number; checksum: string | null }> = {}
for (const [table, expr] of Object.entries(FINGERPRINTS)) {
  try {
    out[table.replace(/"/g, '')] = await fingerprint(table, expr)
  } catch (e) {
    out[table.replace(/"/g, '')] = { rows: -1, checksum: `ERROR: ${e instanceof Error ? e.message : String(e)}` }
  }
}

console.log(JSON.stringify(out, null, 2))
await prisma.$disconnect()
