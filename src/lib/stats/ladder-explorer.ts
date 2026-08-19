import 'server-only'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { ELO_START } from '@/lib/stats/elo'
import { resolvePublicIdentity, slugifyIdentity } from '@/lib/identity/public-identity'
import { UNASSIGNED_DIVISION, completenessOf, type Completeness } from './rankings-facts'

// Re-exported so callers that already import the aggregate do not need a second import for the
// two facts that describe its rows. The definitions live in a dependency-free module because the
// browser table needs them too and cannot import anything marked `server-only`.
export { UNASSIGNED_DIVISION, completenessOf }
export type { Completeness }

/**
 * The Ladder statistics explorer.
 *
 * One batched aggregate per scope-and-view. Every figure comes from stored data: `rating_ledger`, the
 * per-match record that already drives the Ladder, joined to the source match rows for game scores
 * (which the ledger does not carry) and to `season_standing` for the group-stage figures the ledger
 * cannot express, such as standings points and group placings.
 *
 * Raw SQL rather than Prisma calls for one reason: the alternative is a query per player per column,
 * which is exactly the N+1 the spec rules out. This is a fixed number of statements no matter how many
 * players are on the Ladder.
 *
 * Scope comes from stored relations, never from a name or a label. A Season group match is a ledger row
 * with `seasonId` set and `stage = 'GROUP'`; a Tournament match is one with `tournamentId` set. Nothing
 * here infers a competition type from text.
 *
 * ── What is derivable, and what is deliberately absent ───────────────────────────────────────────
 * Derivable: match and game records, ratings and peaks, streaks, per-stage splits, competitions
 * entered, finals and semifinal appearances (from the stored round label), Season titles (from
 * `season.championPlayerId`), runner-up finishes, standings points, group placings, perfect group
 * stages, and playoff qualification.
 *
 * Absent rather than invented: this database holds no historical ranking formula — `RankingSystem` and
 * `RankingSnapshot` are empty and the points engine was retired — so a player's rank *as it stood on
 * some past date* cannot be reproduced. "Highest achieved" therefore means the highest rating and
 * longest streak actually recorded in the ledger, which is a real measurement, not a reconstructed
 * historical position.
 */

export type LadderScope = 'current' | 'all-time'
export type RecordView = 'overall' | 'group' | 'playoff' | 'tournament'

export const RECORD_VIEWS: { id: RecordView; label: string; hint: string }[] = [
  { id: 'overall', label: 'Overall', hint: 'Every recorded match, Seasons and Tournaments together' },
  { id: 'group', label: 'Group Play', hint: 'Season group stages only' },
  { id: 'playoff', label: 'Playoffs', hint: 'Season playoff brackets only' },
  { id: 'tournament', label: 'Cups', hint: 'Standalone Cups only' },
]

/** The rolling window the Current scope uses, matching the official ladder exactly. */
const WINDOW_DAYS = 365



/**
 * Filters that change WHICH MATCHES COUNT, and therefore have to be applied in the aggregate.
 *
 * This is the important distinction in the filter bar. Narrowing to one Season must recompute every
 * record from that Season alone — a player who went 7-0 overall and 2-0 in that Season has to read
 * 2-0. Hiding rows client-side would leave the career figures on screen under a Season heading, which
 * would be a lie. Filters that merely SELECT WHICH PLAYERS APPEAR (a name search, a minimum match
 * count, champions only) do not change any figure and are applied to the returned rows instead.
 */
export interface ExplorerFilters {
  /** Competition series. Seasons only: a Tournament has no series. */
  competitionSeriesId?: number | null
  year?: number | null
  seasonId?: number | null
  tournamentId?: number | null
  /**
   * Season division code, or the literal 'unassigned' for Seasons with none recorded.
   *
   * Seasons only. A Tournament has no division, so selecting one excludes Tournament matches
   * entirely rather than silently treating them as unassigned.
   */
  division?: string | null
  /** Inclusive competition-year range. Independent of `year`, which pins a single year. */
  fromYear?: number | null
  toYear?: number | null
}

export interface ExplorerRow {
  playerId: string
  /** Preferred name. Never shown alone where an ID exists — see `label`. */
  preferredName: string
  cueverseId: string | null
  /** "CueVerse ID (Preferred Name)", from the shared public-identity formatter. */
  label: string
  /** Profile slug for /players/<slug>. */
  slug: string

  /** Official standing for this scope and view. Assigned once and never rewritten by sorting. */
  rank: number

  wins: number
  losses: number
  draws: number
  played: number
  matchWinPct: number

  gamesWon: number
  gamesLost: number
  gameDiff: number
  gameWinPct: number

  rating: number
  peakRating: number
  /** Signed: positive is an active winning run, negative a losing one. */
  currentStreak: number
  longestStreak: number

  competitionsEntered: number
  forfeits: number
  idleDays: number | null

  // Splits, always present so a reader can see where a record came from.
  /**
   * Per-stage DRAWS, counted rather than derived.
   *
   * A Season record is W–L–D and a playoff record is W–L, so the draw has to be attributable to a
   * stage. Subtracting one stage's draws from the overall total would silently absorb any draw the
   * aggregate could not attribute, which is exactly the kind of quiet arithmetic that turns a
   * missing row into a plausible-looking number.
   */
  groupDraws: number
  playoffDraws: number
  tournamentDraws: number
  groupWins: number
  groupLosses: number
  playoffWins: number
  playoffLosses: number
  tournamentWins: number
  tournamentLosses: number

  seasonTitles: number
  tournamentTitles: number
  runnerUps: number
  finalsAppearances: number
  semifinalAppearances: number
  playoffAppearances: number

  // Group-stage figures, from season_standing. Null when the player has no group history at all.
  groupPoints: number | null
  groupsEntered: number | null
  groupFirstPlaces: number | null
  perfectGroupStages: number | null
  playoffQualifications: number | null
  qualificationPct: number | null

  isTeamPlayer: boolean
  /** Player.active. Drives the "active players only" filter. */
  active: boolean

  /**
   * Historical aliases recorded against the canonical Player: old Yahoo handles, former CueVerse
   * IDs, archive spellings. Carried on the row so a search for a name someone used in 2007 still
   * finds them, without a second round trip or a second identity lookup.
   */
  aliases: string[]

  /**
   * Matches in scope whose GAME score is recorded, as opposed to only the match result.
   *
   * Older archived seasons often preserve who won without preserving the frames, so a game
   * differential computed over them would be measuring how much was written down rather than how
   * anyone played. Compared against `played - forfeits` this says whether a row's game figures are
   * complete, partial or absent - see `completenessOf`.
   */
  matchesWithGameData: number
}


/**
 * The ledger with game scores joined on.
 *
 * `matchKey` is the join. The ledger stamps a stable key per match (`season-group:<id>`,
 * `season-playoff:<id>`, `group:<id>`, `playoff:<id>`), so the source row is found by key rather than
 * guessed. Games are attributed by comparing the ledger's stored player name against the match's home
 * and away names: both were written from the same row, so they agree.
 *
 * A forfeit counts as a match and contributes no games. The schema records that a forfeit happened, not
 * frames that were played, and inventing a scoreline for one would be manufacturing data.
 */
export const LEDGER_WITH_GAMES = `
  WITH match_games AS (
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
  ),
  ledger AS (
    SELECT
      rl."playerId", rl."playerName", rl."opponentName", rl."matchKey", rl."stage", rl."roundLabel",
      rl."seasonId", rl."tournamentId", rl."result", rl."isForfeit", rl."isTeamMatch",
      rl."postRating", rl."sequence", rl."completedAt",
      CASE WHEN rl."seasonId" IS NOT NULL THEN 'season' ELSE 'tournament' END AS kind,
      coalesce('s' || rl."seasonId", 't' || rl."tournamentId") AS comp_key,
      -- Only Seasons belong to a Competition; a Tournament carries a year but no series.
      sea."competitionSeriesId" AS series_id,
      sea."division" AS season_division,
      coalesce(sea."competitionYear", tou."competitionYear") AS comp_year,
      -- Whether the GAME score exists, distinct from whether it is zero. A forfeit has no frames by
      -- definition; a missing source row means the frames were never recorded. Both produce 0 games
      -- below, and only this flag tells them apart.
      (mg.match_key IS NOT NULL AND NOT rl."isForfeit") AS has_game_data,
      CASE
        WHEN rl."isForfeit" THEN 0
        WHEN mg.home_name = rl."playerName" THEN coalesce(mg.home_games, 0)
        WHEN mg.away_name = rl."playerName" THEN coalesce(mg.away_games, 0)
        ELSE 0
      END AS games_for,
      CASE
        WHEN rl."isForfeit" THEN 0
        WHEN mg.home_name = rl."playerName" THEN coalesce(mg.away_games, 0)
        WHEN mg.away_name = rl."playerName" THEN coalesce(mg.home_games, 0)
        ELSE 0
      END AS games_against
    FROM "public"."rating_ledger" rl
    LEFT JOIN match_games mg ON mg.match_key = rl."matchKey"
    LEFT JOIN "public"."season" sea ON sea."id" = rl."seasonId"
    LEFT JOIN "public"."comp_tournament" tou ON tou."id" = rl."tournamentId"
  )
`

/** The predicate that selects a record view, built from stored relations. */
function viewFilter(view: RecordView, a: string): string {
  switch (view) {
    case 'group': return `${a}.kind = 'season' AND ${a}."stage" = 'GROUP'`
    case 'playoff': return `${a}.kind = 'season' AND ${a}."stage" = 'PLAYOFF'`
    case 'tournament': return `${a}.kind = 'tournament'`
    default: return 'true'
  }
}

/**
 * Rows for one scope and view.
 *
 * `current` replays only the last year, exactly as the Ladder page does, so a figure here and a figure
 * there cannot disagree. Deduplication is inherent: `rating_ledger` is unique on (matchKey, playerId),
 * so a canonical match referenced twice still yields one row per player.
 */
export async function computeExplorer(
  scope: LadderScope,
  view: RecordView,
  filters: ExplorerFilters = {},
  now = new Date(),
): Promise<ExplorerRow[]> {
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * 86_400_000)

  // Predicates are numbered as they are added, so the set can vary without the placeholders drifting.
  const clauses: string[] = []
  const params: unknown[] = []
  const add = (frag: (n: number) => string, value: unknown) => {
    params.push(value)
    clauses.push(frag(params.length))
  }

  if (scope === 'current') add((n) => `l."completedAt" >= $${n}`, windowStart)
  if (filters.competitionSeriesId != null) add((n) => `l.series_id = $${n}`, filters.competitionSeriesId)
  if (filters.year != null) add((n) => `l.comp_year = $${n}`, filters.year)
  if (filters.seasonId != null) add((n) => `l."seasonId" = $${n}`, filters.seasonId)
  if (filters.tournamentId != null) add((n) => `l."tournamentId" = $${n}`, filters.tournamentId)
  if (filters.fromYear != null) add((n) => `l.comp_year >= $${n}`, filters.fromYear)
  if (filters.toYear != null) add((n) => `l.comp_year <= $${n}`, filters.toYear)
  if (filters.division === UNASSIGNED_DIVISION) {
    // Seasons with no division recorded. A Tournament has no division at all, which is a different
    // thing from an unassigned Season, so Tournament rows are excluded rather than folded in.
    clauses.push(`l.kind = 'season' AND l.season_division IS NULL`)
  } else if (filters.division) {
    add((n) => `l.season_division = $${n}`, filters.division)
  }

  const scopeClause = clauses.length ? `AND ${clauses.join(' AND ')}` : ''

  /**
   * Whether this table is showing the population the official ladder ranks.
   *
   * Decided up front so the ladder can be fetched CONCURRENTLY with the aggregate below. Both read
   * the same ledger and neither needs the other's answer, so running them one after the other spent
   * their two costs end to end — a second of wall time on a full archive, for work that overlaps.
   */
  const unfiltered = view === 'overall'
    && filters.competitionSeriesId == null && filters.year == null
    && filters.seasonId == null && filters.tournamentId == null
    && !filters.division && filters.fromYear == null && filters.toYear == null

  const officialRanks = unfiltered
    ? import('./ladder')
      .then((m) => m.getLadder(scope))
      .then((rows) => new Map(rows.map((r) => [r.playerId, r.rank])))
      .catch((err) => {
        console.error('[ladder-explorer] official ranks unavailable:', err instanceof Error ? err.message : err)
        return null
      })
    : Promise.resolve(null)

  const sql = `
    ${LEDGER_WITH_GAMES},
    -- Everything inside the time scope, whatever the view. Rating and peak are read from HERE, not
    -- from the view-filtered set: a player's rating is their rating, not "their rating counting only
    -- playoff matches". Narrowing it per view would print a different number for the same player on
    -- every tab and none of them would be the Ladder's.
    in_scope AS (
      SELECT l.* FROM ledger l WHERE true ${scopeClause}
    ),
    -- The view-filtered subset. Records, splits and appearances come from here.
    scoped AS (
      SELECT s.* FROM in_scope s WHERE ${viewFilter(view, 's')}
    ),
    agg AS (
      SELECT
        s."playerId",
        max(s."playerName")                                              AS player_name,
        count(*) FILTER (WHERE s."result" = 'WIN')::int                  AS wins,
        count(*) FILTER (WHERE s."result" = 'LOSS')::int                 AS losses,
        count(*) FILTER (WHERE s."result" = 'DRAW')::int                 AS draws,
        count(*) FILTER (WHERE s."isForfeit")::int                       AS forfeits,
        count(*) FILTER (WHERE s.has_game_data)::int                     AS matches_with_games,
        coalesce(sum(s.games_for), 0)::int                               AS games_won,
        coalesce(sum(s.games_against), 0)::int                           AS games_lost,
        count(DISTINCT s.comp_key)::int                                  AS competitions,
        max(s."completedAt")                                             AS last_played,
        bool_or(s."isTeamMatch")                                         AS is_team,
        count(*) FILTER (WHERE s.kind = 'season' AND s."stage" = 'GROUP'   AND s."result" = 'WIN')::int  AS group_wins,
        count(*) FILTER (WHERE s.kind = 'season' AND s."stage" = 'GROUP'   AND s."result" = 'LOSS')::int AS group_losses,
        count(*) FILTER (WHERE s.kind = 'season' AND s."stage" = 'GROUP'   AND s."result" = 'DRAW')::int AS group_draws,
        count(*) FILTER (WHERE s.kind = 'season' AND s."stage" = 'PLAYOFF' AND s."result" = 'WIN')::int  AS playoff_wins,
        count(*) FILTER (WHERE s.kind = 'season' AND s."stage" = 'PLAYOFF' AND s."result" = 'LOSS')::int AS playoff_losses,
        -- A knockout cannot be drawn, so this should always be zero. It is counted anyway: if it is
        -- ever non-zero the data is telling us something, and a hardcoded 0 would hide it.
        count(*) FILTER (WHERE s.kind = 'season' AND s."stage" = 'PLAYOFF' AND s."result" = 'DRAW')::int AS playoff_draws,
        count(*) FILTER (WHERE s.kind = 'tournament' AND s."result" = 'WIN')::int  AS tournament_wins,
        count(*) FILTER (WHERE s.kind = 'tournament' AND s."result" = 'LOSS')::int AS tournament_losses,
        count(*) FILTER (WHERE s.kind = 'tournament' AND s."result" = 'DRAW')::int AS tournament_draws,
        count(DISTINCT CASE WHEN s."roundLabel" ILIKE '%final%'
                             AND s."roundLabel" NOT ILIKE '%semi%'
                             AND s."roundLabel" NOT ILIKE '%quarter%'
                            THEN s.comp_key END)::int                    AS finals_appearances,
        count(DISTINCT CASE WHEN s."roundLabel" ILIKE '%semi%'
                            THEN s.comp_key END)::int                    AS semifinal_appearances,
        count(DISTINCT CASE WHEN s."stage" = 'PLAYOFF'
                            THEN s.comp_key END)::int                    AS playoff_appearances
      FROM scoped s
      GROUP BY s."playerId"
    ),
    -- The player's rating and peak across the whole scope, so every view agrees with the Ladder.
    -- The peak floors at the starting rating, matching getLadder's highestRating.
    latest AS (
      SELECT DISTINCT ON (s."playerId") s."playerId", s."postRating"::int AS rating
        FROM in_scope s
       ORDER BY s."playerId", s."sequence" DESC
    ),
    peak AS (
      SELECT s."playerId", greatest(max(s."postRating"), ${ELO_START})::int AS peak_rating
        FROM in_scope s
       GROUP BY s."playerId"
    ),
    runs AS (
      SELECT g."playerId", g."result", count(*) AS run_length, max(g."sequence") AS run_end
        FROM (
          SELECT
            s."playerId", s."result", s."sequence",
            row_number() OVER (PARTITION BY s."playerId" ORDER BY s."sequence")
              - row_number() OVER (PARTITION BY s."playerId", s."result" ORDER BY s."sequence") AS grp
          FROM scoped s
          -- Ties are filtered out BEFORE the window functions, which is what makes a tie skipped
          -- over rather than treated as a break: with the draw removed, the wins on either side of
          -- it become adjacent and count as one run. Filtering after the numbering would have made
          -- every draw end a streak.
          WHERE s."result" IN ('WIN', 'LOSS')
        ) g
       GROUP BY g."playerId", g."result", g.grp
    ),
    streaks AS (
      SELECT
        r."playerId",
        coalesce(max(r.run_length) FILTER (WHERE r."result" = 'WIN'), 0)::int AS longest_win_run,
        (array_agg(r."result"   ORDER BY r.run_end DESC))[1]                 AS last_result,
        (array_agg(r.run_length ORDER BY r.run_end DESC))[1]::int            AS last_run
      FROM runs r
      GROUP BY r."playerId"
    ),
    champs AS (
      SELECT se."championPlayerId" AS "playerId", count(*)::int AS season_titles
        FROM "public"."season" se
       WHERE se."lifecycleState" = 'COMPLETED' AND se."championPlayerId" IS NOT NULL
       GROUP BY 1
    ),
    runners AS (
      SELECT e."playerId", count(*)::int AS runner_ups
        FROM "public"."season" se
        JOIN "public"."season_entrant" e
          ON e."seasonId" = se."id" AND e."playerId" IS NOT NULL
       WHERE se."lifecycleState" = 'COMPLETED'
         AND se."runnerUpHandle" IS NOT NULL
         AND lower(se."runnerUpHandle") = lower(e."username")
       GROUP BY e."playerId"
    ),
    tchamps AS (
      SELECT p."id" AS "playerId", count(*)::int AS tournament_titles
        FROM "public"."comp_tournament" t
        JOIN "public"."Player" p
          ON p."cueverseId" IS NOT NULL
         AND lower(p."cueverseId") = lower(t."championHandle")
       WHERE t."championHandle" IS NOT NULL
       GROUP BY 1
    ),
    grp AS (
      SELECT e."playerId",
             coalesce(sum(st."points"), 0)::int                               AS group_points,
             count(*)::int                                                    AS groups_entered,
             count(*) FILTER (WHERE st."rank" = 1)::int                       AS first_places,
             count(*) FILTER (WHERE st."losses" = 0 AND st."played" > 0)::int  AS perfect_stages
        FROM "public"."season_standing" st
        JOIN "public"."season_entrant" e
          ON e."id" = st."entrantId" AND e."playerId" IS NOT NULL
       GROUP BY e."playerId"
    ),
    aliases AS (
      SELECT pa."playerId", array_agg(DISTINCT pa."alias") AS alias_list
        FROM "public"."PlayerAlias" pa
       GROUP BY pa."playerId"
    ),
    quals AS (
      SELECT e."playerId",
             count(*) FILTER (WHERE e."qualification" IN ('AUTOMATIC', 'WILDCARD'))::int AS qualifications,
             count(*)::int AS season_entries
        FROM "public"."season_entrant" e
       WHERE e."playerId" IS NOT NULL
       GROUP BY e."playerId"
    )
    SELECT
      a.*,
      coalesce(lt.rating, ${ELO_START})::int  AS rating,
      coalesce(pk.peak_rating, ${ELO_START})::int AS peak_rating,
      st.longest_win_run, st.last_result, coalesce(st.last_run, 0)::int AS last_run,
      coalesce(c.season_titles, 0)::int      AS season_titles,
      coalesce(ru.runner_ups, 0)::int        AS runner_ups,
      coalesce(tc.tournament_titles, 0)::int AS tournament_titles,
      g.group_points, g.groups_entered, g.first_places, g.perfect_stages,
      q.qualifications, q.season_entries,
      coalesce(al.alias_list, ARRAY[]::text[]) AS aliases,
      p."primaryName", p."cueverseId", coalesce(p."active", true) AS active
    FROM agg a
    LEFT JOIN latest  lt ON lt."playerId" = a."playerId"
    LEFT JOIN peak    pk ON pk."playerId" = a."playerId"
    LEFT JOIN streaks st ON st."playerId" = a."playerId"
    LEFT JOIN champs  c  ON c."playerId"  = a."playerId"
    LEFT JOIN runners ru ON ru."playerId" = a."playerId"
    LEFT JOIN tchamps tc ON tc."playerId" = a."playerId"
    LEFT JOIN grp     g  ON g."playerId"  = a."playerId"
    LEFT JOIN quals   q  ON q."playerId"  = a."playerId"
    LEFT JOIN aliases al ON al."playerId" = a."playerId"
    LEFT JOIN "public"."Player" p ON p."id" = a."playerId"
  `

  type Raw = Record<string, unknown>
  let rows: Raw[]
  try {
    rows = await prisma.$queryRawUnsafe<Raw[]>(sql, ...params)
  } catch (err) {
    // A failed aggregate must not take the Ladder page down; it degrades to no explorer data.
    console.error('[ladder-explorer] aggregate failed:', err instanceof Error ? err.message : err)
    return []
  }

  const num = (v: unknown): number => (v == null ? 0 : Number(v))
  const opt = (v: unknown): number | null => (v == null ? null : Number(v))
  const pct = (part: number, whole: number): number =>
    whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10

  const mapped: ExplorerRow[] = rows.map((r) => {
    const wins = num(r.wins)
    const losses = num(r.losses)
    const draws = num(r.draws)
    const played = wins + losses + draws
    const gamesWon = num(r.games_won)
    const gamesLost = num(r.games_lost)
    const lastResult = r.last_result as string | null
    const lastRun = num(r.last_run)
    const lastPlayed = r.last_played ? new Date(r.last_played as string) : null
    const qualifications = opt(r.qualifications)
    const seasonEntries = num(r.season_entries)

    // Identity through the shared formatter, so the Ladder reads the same as every other public
    // surface: the CueVerse ID leads because it is the half that actually identifies someone. The
    // ledger's stored name is the last resort, so a row can never render blank.
    const identity = resolvePublicIdentity({
      preferredName: (r.primaryName as string) || (r.player_name as string) || null,
      cueverseId: (r.cueverseId as string) ?? null,
    })

    return {
      playerId: String(r.playerId),
      preferredName: identity.preferredName,
      cueverseId: identity.cueverseId,
      label: identity.label,
      slug: slugifyIdentity(identity.preferredName, identity.cueverseId),
      rank: 0,
      wins,
      losses,
      draws,
      played,
      matchWinPct: pct(wins, played),
      gamesWon,
      gamesLost,
      gameDiff: gamesWon - gamesLost,
      gameWinPct: pct(gamesWon, gamesWon + gamesLost),
      rating: num(r.rating),
      peakRating: num(r.peak_rating),
      currentStreak: lastResult === 'WIN' ? lastRun : lastResult === 'LOSS' ? -lastRun : 0,
      longestStreak: num(r.longest_win_run),
      competitionsEntered: num(r.competitions),
      forfeits: num(r.forfeits),
      idleDays: lastPlayed
        ? Math.max(0, Math.floor((now.getTime() - lastPlayed.getTime()) / 86_400_000))
        : null,
      groupDraws: num(r.group_draws),
      playoffDraws: num(r.playoff_draws),
      tournamentDraws: num(r.tournament_draws),
      groupWins: num(r.group_wins),
      groupLosses: num(r.group_losses),
      playoffWins: num(r.playoff_wins),
      playoffLosses: num(r.playoff_losses),
      tournamentWins: num(r.tournament_wins),
      tournamentLosses: num(r.tournament_losses),
      seasonTitles: num(r.season_titles),
      tournamentTitles: num(r.tournament_titles),
      runnerUps: num(r.runner_ups),
      finalsAppearances: num(r.finals_appearances),
      semifinalAppearances: num(r.semifinal_appearances),
      playoffAppearances: num(r.playoff_appearances),
      groupPoints: opt(r.group_points),
      groupsEntered: opt(r.groups_entered),
      groupFirstPlaces: opt(r.first_places),
      perfectGroupStages: opt(r.perfect_stages),
      playoffQualifications: qualifications,
      qualificationPct: qualifications != null && seasonEntries > 0
        ? pct(qualifications, seasonEntries)
        : null,
      isTeamPlayer: Boolean(r.is_team),
      active: r.active !== false,
      aliases: Array.isArray(r.aliases) ? (r.aliases as string[]).filter(Boolean) : [],
      matchesWithGameData: num(r.matches_with_games),
    }
  })

  /**
   * ── Official standing ───────────────────────────────────────────────────────────────────────────
   *
   * There is ONE official ladder on this site, and it is `getLadder` in ./ladder — the service the
   * homepage Top 10 and every player profile already read. When this table is showing the same
   * population that service ranks (no competition filters, every record view folded together), the
   * ranks are TAKEN FROM IT rather than recomputed here.
   *
   * That is not deference for its own sake. Two implementations of "who is first" drift: this table
   * and the ladder briefly disagreed about three players tied on 1521 and, after the tie-break keys
   * were aligned by hand, about a different two tied on 1490 — because win percentage counts draws
   * in one place and not the other. A reader has no way to tell which page is lying. Deriving the
   * rank from the authority removes the question instead of answering it twice.
   *
   * ── When a filter is applied ────────────────────────────────────────────────────────────────────
   *
   * Narrowing to one Season, one division or one record view asks a question the official ladder
   * does not answer, so a rank is DERIVED here from the filtered figures: rating, then tournament
   * titles, then match wins, then the preferred name as a stable identifier. It is a ranking of the
   * filtered set and the page says so — it never replaces the official ladder position.
   *
   * Either way the rank is assigned once, here. Sorting the table never rewrites it.
   */
  const rankOf = await officialRanks
  if (rankOf) {
    // A player the ladder does not rank keeps a derived position AFTER everyone it does, rather
    // than being given rank 0 or dropped from the table.
    let overflow = rankOf.size
    mapped.sort((a, b) =>
      (rankOf.get(a.playerId) ?? Number.MAX_SAFE_INTEGER) - (rankOf.get(b.playerId) ?? Number.MAX_SAFE_INTEGER)
      || a.preferredName.toLowerCase().localeCompare(b.preferredName.toLowerCase()))
    mapped.forEach((row) => { row.rank = rankOf.get(row.playerId) ?? ++overflow })
    return mapped
  }

  mapped.sort((a, b) =>
    b.rating - a.rating
    || b.tournamentTitles - a.tournamentTitles
    || b.wins - a.wins
    || a.preferredName.toLowerCase().localeCompare(b.preferredName.toLowerCase()))
  mapped.forEach((row, i) => { row.rank = i + 1 })

  return mapped
}

export const LADDER_EXPLORER_TAG = 'ladder-explorer'

/** Cached per scope, view and filter set: small aggregates rather than one query per visitor. */
export const getExplorer = unstable_cache(
  async (scope: LadderScope, view: RecordView, filters: ExplorerFilters = {}) =>
    computeExplorer(scope, view, filters),
  ['ladder-explorer'],
  { tags: [LADDER_EXPLORER_TAG], revalidate: 300 },
)

// --------------------------------------------------------------------------- filter options

export interface ExplorerFacets {
  competitions: { id: number; name: string }[]
  years: number[]
  seasons: { id: number; label: string; year: number; competitionSeriesId: number }[]
  tournaments: { id: number; label: string; year: number }[]
  /** Division codes actually recorded on a Season that has ranked matches. Never invented. */
  divisions: string[]
  /** Whether any ranked Season has no division recorded, which is what "Unassigned" selects. */
  hasUnassignedDivision: boolean
  /**
   * Canonical competition eras.
   *
   * ALWAYS EMPTY today, and deliberately so: this database has no era model and no era metadata on
   * any record, so any boundary offered here would be one this code invented. The field exists so
   * the filter, the URL and the tests are already shaped for eras when a canonical source appears;
   * until then the year range below is the real, evidence-backed way to narrow by time.
   */
  eras: { id: string; label: string; fromYear: number; toYear: number }[]
  /** The span of competition years that actually carry ranked matches. Null when there are none. */
  yearRange: { min: number; max: number } | null
}

/**
 * The values the filter bar can actually offer.
 *
 * Restricted to competitions that HAVE ledger rows. An option that selects nothing is worse than no
 * option: it reads as missing data rather than as an empty intersection. Seasons carry their
 * competition and year so the client can narrow the Season list when a Competition or Year is chosen
 * without another round trip.
 */
export async function computeFacets(): Promise<ExplorerFacets> {
  type Row = Record<string, unknown>
  try {
    const [seasons, tournaments] = await Promise.all([
      prisma.$queryRaw<Row[]>`
        SELECT se."id", se."number", se."competitionYear" AS year, se."competitionSeriesId" AS series,
               se."division", cs."name" AS series_name
          FROM "public"."season" se
          JOIN "public"."competition_series" cs ON cs."id" = se."competitionSeriesId"
         WHERE EXISTS (SELECT 1 FROM "public"."rating_ledger" rl WHERE rl."seasonId" = se."id")
         ORDER BY se."competitionYear" DESC, se."number" DESC`,
      prisma.$queryRaw<Row[]>`
        SELECT t."id", t."name", t."competitionYear" AS year
          FROM "public"."comp_tournament" t
         WHERE EXISTS (SELECT 1 FROM "public"."rating_ledger" rl WHERE rl."tournamentId" = t."id")
         ORDER BY t."competitionYear" DESC, t."name" ASC`,
    ])

    const competitions = new Map<number, string>()
    const years = new Set<number>()
    const divisions = new Set<string>()
    let hasUnassignedDivision = false

    const seasonRows = seasons.map((r) => {
      const seriesId = Number(r.series)
      const year = Number(r.year)
      competitions.set(seriesId, String(r.series_name))
      years.add(year)
      // Offered only where a Season actually records one. Nothing is derived from a name or a year.
      const division = (r.division as string | null)?.trim()
      if (division) divisions.add(division)
      else hasUnassignedDivision = true
      return {
        id: Number(r.id),
        label: `${r.series_name} Season ${r.number} — ${year}`,
        year,
        competitionSeriesId: seriesId,
      }
    })

    const tournamentRows = tournaments.map((r) => {
      const year = Number(r.year)
      years.add(year)
      return { id: Number(r.id), label: String(r.name), year }
    })

    const sortedYears = [...years].sort((a, b) => b - a)
    return {
      competitions: [...competitions].map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      years: sortedYears,
      seasons: seasonRows,
      tournaments: tournamentRows,
      divisions: [...divisions].sort((a, b) => a.localeCompare(b)),
      hasUnassignedDivision,
      // No canonical era metadata exists. See the field's own note: an empty list is the honest
      // answer, and the year range is what narrows by time instead.
      eras: [],
      yearRange: sortedYears.length
        ? { min: sortedYears[sortedYears.length - 1], max: sortedYears[0] }
        : null,
    }
  } catch (err) {
    console.error('[ladder-explorer] facets failed:', err instanceof Error ? err.message : err)
    return {
      competitions: [], years: [], seasons: [], tournaments: [],
      divisions: [], hasUnassignedDivision: false, eras: [], yearRange: null,
    }
  }
}

export const getFacets = unstable_cache(computeFacets, ['ladder-explorer-facets'], {
  tags: [LADDER_EXPLORER_TAG],
  revalidate: 300,
})

// The expanded-row detail used to live here. It now lives in ./rankings-detail, which carries the
// career summary, recent form, rating history and head-to-head as well — one implementation of what
// a player's history means rather than two that could disagree.

// --------------------------------------------------------------------------- last updated

export interface RankingsFreshness {
  /**
   * The most recent canonical result feeding the rankings, as an ISO string. Null when nothing is
   * ranked yet.
   *
   * A string rather than a Date because this crosses `unstable_cache`, which serialises what it
   * stores — a cached Date comes back as a string with a Date's type, and the first `.toISOString()`
   * throws. Returning the string makes the wire format and the declared type the same thing.
   */
  lastResultAt: string | null
  /** What that result belonged to, so the timestamp can be traced rather than merely trusted. */
  source: { kind: 'season' | 'tournament'; id: number; label: string } | null
  /** Total ranked matches behind the figure, as a sanity check on the timestamp. */
  rankedMatches: number
}

/**
 * When the rankings last changed, and what changed them.
 *
 * Read from the newest `rating_ledger.completedAt`, never from the clock. A "last updated" that
 * reports the page load says only that someone opened the page — it looks like freshness while
 * carrying no information at all, and it would keep ticking over a table that had not moved in a
 * year.
 *
 * `completedAt` is the match's own completion time as recorded when the competition closed, so the
 * figure survives a rebuild of this page and cannot be advanced by a deploy.
 */
export async function computeFreshness(): Promise<RankingsFreshness> {
  type Row = Record<string, unknown>
  try {
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT rl."completedAt", rl."seasonId", rl."tournamentId",
             cs."name" AS series_name, se."number" AS season_number, se."competitionYear" AS season_year,
             t."name" AS tournament_name,
             (SELECT count(*) FROM "public"."rating_ledger") AS ranked
        FROM "public"."rating_ledger" rl
        LEFT JOIN "public"."season" se ON se."id" = rl."seasonId"
        LEFT JOIN "public"."competition_series" cs ON cs."id" = se."competitionSeriesId"
        LEFT JOIN "public"."comp_tournament" t ON t."id" = rl."tournamentId"
       ORDER BY rl."completedAt" DESC, rl."sequence" DESC
       LIMIT 1`
    const r = rows[0]
    if (!r) return { lastResultAt: null, source: null, rankedMatches: 0 }

    const source: RankingsFreshness['source'] = r.seasonId != null
      ? {
          kind: 'season',
          id: Number(r.seasonId),
          label: `${r.series_name ?? 'Season'} Season ${r.season_number} — ${r.season_year}`,
        }
      : r.tournamentId != null
        ? { kind: 'tournament', id: Number(r.tournamentId), label: String(r.tournament_name ?? 'Tournament') }
        : null

    return {
      lastResultAt: r.completedAt ? new Date(r.completedAt as string).toISOString() : null,
      source,
      rankedMatches: Number(r.ranked ?? 0),
    }
  } catch (err) {
    console.error('[ladder-explorer] freshness failed:', err instanceof Error ? err.message : err)
    return { lastResultAt: null, source: null, rankedMatches: 0 }
  }
}

export const getFreshness = unstable_cache(computeFreshness, ['rankings-freshness'], {
  tags: [LADDER_EXPLORER_TAG],
  revalidate: 300,
})
