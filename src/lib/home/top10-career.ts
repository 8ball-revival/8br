import 'server-only'
import { prisma } from '@/lib/prisma'
import { resolveCanonicalPlayerIds } from '@/lib/players/merge'

/**
 * Career performance across competitions, for the Top 10 panel.
 *
 * This is a TRANSPARENT career view — championships, finals, wins — not a reconstruction of any
 * official historical ranking formula. No such formula exists in this codebase (RankingSystem and
 * RankingSnapshot hold no rows, and the archive carries per-category Hall of Fame leaderboards rather
 * than a composite score). So rather than inventing a score and presenting it as authority, every
 * ordering below is a sequence of plainly stated, individually checkable figures. A reader can see
 * why somebody is first: they won more titles, and the tiebreaks are stated in order.
 *
 * The Current Ladder mode does not come through here at all. That one IS an official rating, and it
 * is served unmodified by the Ladder's own service.
 *
 * Every figure comes from `rating_ledger` — the same per-match record that drives the Ladder — joined
 * to the source match rows for game scores. Byes, administrative advancements and unplayed matches
 * never enter the ledger, so they cannot reach these totals; forfeits are recorded as official results
 * with no games, so they count as matches won or lost but contribute no game differential.
 */

export type CareerScope =
  | { kind: 'all' }
  | { kind: 'season' }
  | { kind: 'tournament' }
  | { kind: 'competition'; competitionSeriesId: number }

export interface CareerRow {
  playerId: string | null
  name: string
  handle: string | null
  slug: string | null
  championships: number
  finals: number
  wins: number
  losses: number
  matchWinPct: number
  gameDiff: number
}

/** Games live on the source match rows; the ledger stores results and ratings, not scorelines. */
const MATCH_GAMES = `
  SELECT 'season-group:' || m."id" AS match_key, m."homeUsername" AS home_name,
         m."awayUsername" AS away_name, m."homeGames" AS home_games, m."awayGames" AS away_games
    FROM "public"."season_match" m
   WHERE m."homeGames" IS NOT NULL AND m."awayGames" IS NOT NULL
  UNION ALL
  SELECT 'season-playoff:' || m."id", m."homeUsername", m."awayUsername", m."homeGames", m."awayGames"
    FROM "public"."season_playoff_match" m
   WHERE m."homeGames" IS NOT NULL AND m."awayGames" IS NOT NULL
  UNION ALL
  SELECT 'group:' || m."id", m."homeUsername", m."awayUsername", m."homeGames", m."awayGames"
    FROM "public"."comp_tournament_match" m
   WHERE m."homeGames" IS NOT NULL AND m."awayGames" IS NOT NULL
  UNION ALL
  SELECT 'playoff:' || m."id", m."homeUsername", m."awayUsername", m."homeGames", m."awayGames"
    FROM "public"."comp_playoff_match" m
   WHERE m."homeGames" IS NOT NULL AND m."awayGames" IS NOT NULL
`

/**
 * Per-player match record for a scope.
 *
 * "Finals reached" counts DISTINCT competitions in which the player appeared in a final — a final is
 * one match, but a player who reached two finals in one competition (impossible today, but a double
 * elimination bracket can produce a reset) must not be counted twice. Semi- and quarter-finals are
 * excluded by name, which is how the round is recorded.
 */
async function matchRecord(scope: CareerScope): Promise<Map<string, {
  name: string; handle: string | null; wins: number; losses: number; draws: number
  gamesFor: number; gamesAgainst: number; finals: number
}>> {
  const where =
    scope.kind === 'season' ? `rl."seasonId" IS NOT NULL`
      : scope.kind === 'tournament' ? `rl."tournamentId" IS NOT NULL`
        : scope.kind === 'competition' ? `rl."seasonId" IN (SELECT id FROM "public"."season" WHERE "competitionSeriesId" = $1)`
          : `true`

  const params = scope.kind === 'competition' ? [scope.competitionSeriesId] : []

  const sql = `
    WITH match_games AS (${MATCH_GAMES}),
    scoped AS (
      SELECT rl."playerId", rl."playerName", rl."result", rl."isForfeit", rl."roundLabel",
             coalesce('s' || rl."seasonId", 't' || rl."tournamentId") AS comp_key,
             CASE WHEN rl."isForfeit" THEN 0
                  WHEN mg.home_name = rl."playerName" THEN coalesce(mg.home_games, 0)
                  WHEN mg.away_name = rl."playerName" THEN coalesce(mg.away_games, 0)
                  ELSE 0 END AS games_for,
             CASE WHEN rl."isForfeit" THEN 0
                  WHEN mg.home_name = rl."playerName" THEN coalesce(mg.away_games, 0)
                  WHEN mg.away_name = rl."playerName" THEN coalesce(mg.home_games, 0)
                  ELSE 0 END AS games_against
        FROM "public"."rating_ledger" rl
        LEFT JOIN match_games mg ON mg.match_key = rl."matchKey"
       WHERE ${where}
    )
    SELECT s."playerId",
           max(s."playerName")                                AS player_name,
           count(*) FILTER (WHERE s."result" = 'WIN')::int     AS wins,
           count(*) FILTER (WHERE s."result" = 'LOSS')::int    AS losses,
           count(*) FILTER (WHERE s."result" = 'DRAW')::int    AS draws,
           coalesce(sum(s.games_for), 0)::int                  AS games_for,
           coalesce(sum(s.games_against), 0)::int              AS games_against,
           count(DISTINCT CASE
             WHEN s."roundLabel" ILIKE '%final%'
              AND s."roundLabel" NOT ILIKE '%semi%'
              AND s."roundLabel" NOT ILIKE '%quarter%'
             THEN s.comp_key END)::int                         AS finals
      FROM scoped s
     GROUP BY s."playerId"
  `

  type Row = {
    playerId: string; player_name: string; wins: number; losses: number; draws: number
    games_for: number; games_against: number; finals: number
  }

  let rows: Row[] = []
  try {
    rows = await prisma.$queryRawUnsafe<Row[]>(sql, ...params)
  } catch (err) {
    console.warn('[top10-career] match record query failed:', err instanceof Error ? err.message : err)
    return new Map()
  }

  // Collapse merged identities: a member who played under two profiles has one career.
  const canonical = await resolveCanonicalPlayerIds(rows.map((r) => r.playerId).filter(Boolean))

  const out = new Map<string, {
    name: string; handle: string | null; wins: number; losses: number; draws: number
    gamesFor: number; gamesAgainst: number; finals: number
  }>()

  for (const r of rows) {
    const key = canonical.get(r.playerId) ?? r.playerId
    const cur = out.get(key) ?? {
      name: r.player_name, handle: null, wins: 0, losses: 0, draws: 0,
      gamesFor: 0, gamesAgainst: 0, finals: 0,
    }
    cur.wins += Number(r.wins)
    cur.losses += Number(r.losses)
    cur.draws += Number(r.draws)
    cur.gamesFor += Number(r.games_for)
    cur.gamesAgainst += Number(r.games_against)
    cur.finals += Number(r.finals)
    out.set(key, cur)
  }

  return out
}

/** Championships in scope, keyed the same way, so the two can be joined. */
async function championships(scope: CareerScope): Promise<Map<string, number>> {
  const counts = new Map<string, number>()

  const wantSeasons = scope.kind !== 'tournament'
  const wantTournaments = scope.kind === 'all' || scope.kind === 'tournament'

  if (wantSeasons) {
    const seasons = await prisma.season.findMany({
      where: {
        lifecycleState: 'COMPLETED',
        championPlayerId: { not: null },
        ...(scope.kind === 'competition' ? { competitionSeriesId: scope.competitionSeriesId } : {}),
      },
      select: { championPlayerId: true },
    })
    const canonical = await resolveCanonicalPlayerIds(
      seasons.map((s) => s.championPlayerId).filter((id): id is string => id != null),
    )
    for (const s of seasons) {
      if (!s.championPlayerId) continue
      const key = canonical.get(s.championPlayerId) ?? s.championPlayerId
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }

  if (wantTournaments) {
    // Tournaments record a champion by name rather than a linked id, so they are matched back to a
    // player through the ledger's stored name. A champion who never appears in the ledger cannot be
    // attributed to a player id and is left out rather than guessed at.
    const tournaments = await prisma.tournament.findMany({
      where: { status: 'COMPLETED', championName: { not: null } },
      select: { championName: true },
    })
    const names = tournaments.map((t) => (t.championName ?? '').trim().toLowerCase()).filter(Boolean)
    if (names.length) {
      const matched = await prisma.$queryRawUnsafe<{ playerId: string; nm: string }[]>(
        `SELECT DISTINCT "playerId", lower("playerName") AS nm
           FROM "public"."rating_ledger" WHERE lower("playerName") = ANY($1)`,
        names,
      ).catch(() => [])
      const byName = new Map(matched.map((m) => [m.nm, m.playerId]))
      const canonical = await resolveCanonicalPlayerIds([...byName.values()])
      for (const n of names) {
        const pid = byName.get(n)
        if (!pid) continue
        const key = canonical.get(pid) ?? pid
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
  }

  return counts
}

/**
 * The Top 10 for a career scope.
 *
 * Ordering, in the order it is applied:
 *   1. total championships
 *   2. finals reached
 *   3. legitimate completed match wins
 *   4. match win percentage
 *   5. game differential
 *   6. CueVerse ID, then player id — a stable tiebreaker, so equal careers always list in the same
 *      order rather than shuffling between requests
 */
export async function careerTop10(scope: CareerScope, limit = 10): Promise<CareerRow[]> {
  const [record, titles] = await Promise.all([matchRecord(scope), championships(scope)])

  // Everyone who either played a match or won a title in scope.
  const keys = new Set<string>([...record.keys(), ...titles.keys()])
  if (keys.size === 0) return []

  const players = await prisma.player.findMany({
    where: { id: { in: [...keys] } },
    select: { id: true, primaryName: true, cueverseId: true },
  })
  const byId = new Map(players.map((p) => [p.id, p]))

  const rows = [...keys].map((key) => {
    const r = record.get(key)
    const p = byId.get(key)
    const wins = r?.wins ?? 0
    const losses = r?.losses ?? 0
    const draws = r?.draws ?? 0
    const decided = wins + losses + draws
    return {
      playerId: key,
      name: p?.primaryName ?? r?.name ?? 'Unknown',
      handle: p?.cueverseId ?? null,
      slug: p?.cueverseId ?? null,
      championships: titles.get(key) ?? 0,
      finals: r?.finals ?? 0,
      wins,
      losses,
      matchWinPct: decided === 0 ? 0 : Math.round((wins / decided) * 1000) / 10,
      gameDiff: (r?.gamesFor ?? 0) - (r?.gamesAgainst ?? 0),
    } satisfies CareerRow
  })

  rows.sort((a, b) =>
    b.championships - a.championships
    || b.finals - a.finals
    || b.wins - a.wins
    || b.matchWinPct - a.matchWinPct
    || b.gameDiff - a.gameDiff
    || (a.handle ?? a.name).localeCompare(b.handle ?? b.name, undefined, { sensitivity: 'base' })
    || (a.playerId ?? '').localeCompare(b.playerId ?? ''))

  return rows.slice(0, limit)
}

/** Two rows tie when every ranked figure matches — the tiebreaker decides order, not standing. */
export function careerTied(a: CareerRow, b: CareerRow): boolean {
  return a.championships === b.championships
    && a.finals === b.finals
    && a.wins === b.wins
    && a.matchWinPct === b.matchWinPct
    && a.gameDiff === b.gameDiff
}
