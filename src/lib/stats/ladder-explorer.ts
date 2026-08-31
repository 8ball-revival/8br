import type { CompetitionPlatform } from '@prisma/client'
import 'server-only'
import { inWindow, ratingsForScope, replayRatings, windowCutoff } from '@/lib/stats/rating-history'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { ELO_START, isRatingNeutral, withChampionStep } from '@/lib/stats/elo'
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

/*
 * The list itself lives in `rankings-columns`, which carries no server-only import.
 *
 * It is a description of the four views - ids, labels and hints - not a query, so nothing about it
 * needs the database. While it was declared here, a client component that wanted the labels had to
 * import from a `server-only` module to get them, which pulls Prisma, Payload and `pg` into the
 * browser bundle and fails the build with a wall of unresolved node builtins. Re-exported so every
 * existing server-side importer is unaffected.
 */
export { RECORD_VIEWS } from './rankings-columns'


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
  /**
   * Which platform's ranking universe this is.
   *
   * Not a filter over a shared ladder — the ladder itself is per platform. A Yahoo rating and a
   * CueVerse rating are produced by separate replays that start from the same 1500 and never see
   * each other's matches, so there is no combined figure for this to narrow. Absent means CueVerse,
   * which is the default everywhere.
   */
  platform?: CompetitionPlatform | null
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
  /** Seasons, Tournaments, or both. Narrows which KIND of record contributes, not which year. */
  eventType?: 'all' | 'seasons' | 'cups' | null
}

/**
 * Load the ledger and hand it to the canonical rating service.
 *
 * Deliberately its own read rather than a join into the aggregate above: the replay needs every row
 * in completion order, and the aggregate needs one row per player. Trying to serve both from one
 * query is what produced two different notions of "the rating" in the first place.
 */
/**
 * Which filters make this a PERIOD rather than the whole record.
 *
 * A period ladder is a self-contained competition: everybody starts at the standard initial rating
 * and only the results inside the period are played. That is what a reader asking for "2008", or for
 * "the WCC", means -- how did people perform HERE -- and it is the only reading under which the
 * number shown and the record printed beside it describe the same thing.
 *
 * The alternative, which this replaces, carried each player's rating in from every earlier result
 * and set it against a record drawn only from the period. Somebody who arrived in 2008 already rated
 * 1680 appeared to have earned it that year.
 */
function isPeriodScoped(filters: ExplorerFilters): boolean {
  return filters.year != null
    || filters.fromYear != null
    || filters.toYear != null
    || filters.competitionSeriesId != null
    || filters.seasonId != null
    || filters.tournamentId != null
    || !!filters.division
    || (filters.eventType != null && filters.eventType !== 'all')
}

async function ratingsForScope_(scope: 'current' | 'all-time', now: Date, filters: ExplorerFilters) {
  const platform: CompetitionPlatform = filters.platform ?? 'CUEVERSE'
  const rows = await prisma.ratingLedger.findMany({
    where: { platform },
    orderBy: { sequence: 'asc' },
    select: {
      playerId: true, playerName: true, matchKey: true, sequence: true, tournamentId: true,
      seasonId: true,
      completedAt: true, actual: true, result: true, isForfeit: true, isTeamMatch: true,
      teamName: true, ratingChange: true, postRating: true,
      // The replay needs it: a Yahoo Tournament result is recorded but rating-neutral.
      platform: true,
    },
  })

  /*
   * The Competition Year of each row, from the record it belongs to.
   *
   * The same `coalesce(season.competitionYear, tournament.competitionYear)` the aggregate query
   * uses, resolved once here rather than per row — a ledger row names its Season or its Tournament,
   * never both.
   */
  const [seasons, tournaments] = await Promise.all([
    prisma.season.findMany({ select: { id: true, competitionYear: true, competitionSeriesId: true, division: true } }),
    prisma.tournament.findMany({ select: { id: true, competitionYear: true } }),
  ])
  const seasonMeta = new Map(seasons.map((x) => [x.id, x]))
  const tournamentYear = new Map(tournaments.map((x) => [x.id, x.competitionYear]))
  const yearOf = (r: { seasonId: number | null; tournamentId: number | null }) =>
    (r.seasonId != null ? seasonMeta.get(r.seasonId)?.competitionYear
      : r.tournamentId != null ? tournamentYear.get(r.tournamentId) : null) ?? null

  /*
   * The replay reads the SAME result stream the records are drawn from.
   *
   * Every predicate here mirrors one in `scopeClause` above, and every one resolves against the
   * canonical record rather than a timestamp: a Season imported in 2026 belongs to the year it was
   * played, and an administrative stamp on a Tournament says when somebody typed it in. Two
   * different notions of "in scope" is exactly how a ladder ends up disagreeing with the table
   * printed beside it.
   */
  const inScope = (r: { seasonId: number | null; tournamentId: number | null }) => {
    const season = r.seasonId != null ? seasonMeta.get(r.seasonId) : undefined
    const year = yearOf(r)
    if (filters.year != null && year !== filters.year) return false
    if (filters.fromYear != null && (year == null || year < filters.fromYear)) return false
    if (filters.toYear != null && (year == null || year > filters.toYear)) return false
    if (filters.eventType === 'seasons' && r.seasonId == null) return false
    if (filters.eventType === 'cups' && r.seasonId != null) return false
    if (filters.competitionSeriesId != null && season?.competitionSeriesId !== filters.competitionSeriesId) return false
    if (filters.seasonId != null && r.seasonId !== filters.seasonId) return false
    if (filters.tournamentId != null && r.tournamentId !== filters.tournamentId) return false
    if (filters.division === UNASSIGNED_DIVISION) {
      if (r.seasonId == null || season?.division != null) return false
    } else if (filters.division && season?.division !== filters.division) return false
    return true
  }

  const period = isPeriodScoped(filters)
  const stream = period ? rows.filter(inScope) : rows
  /*
   * A period is replayed; the unbounded All-Time ladder is still read from storage.
   *
   * `storedRatings` returns the running figure the ledger wrote, which is the right answer for "the
   * whole record" and the wrong one for any subset of it -- it knows about every match, including
   * the ones the filter just excluded.
   */
  const ratings = period
    ? replayRatings(scope === 'current'
        ? stream.filter((r) => inWindow(r.completedAt, windowCutoff(now)))
        : stream)
    : ratingsForScope(stream, scope, windowCutoff(now), { toYear: null, yearOf })

  /*
   * The championship step, applied to the one canonical rating rather than in the SQL.
   *
   * The aggregate query also selects a rating, but it is only a fallback for a player the replay
   * never saw; stepping it there as well would have produced two answers again — the exact fault the
   * comment above this function warns about. Titles are counted per platform for the same reason the
   * ladder counts them that way.
   */
  const champs = await prisma.season.groupBy({
    by: ['championPlayerId'],
    where: {
      lifecycleState: 'COMPLETED',
      championPlayerId: { not: null },
      platform,
      /*
       * Titles inside the period only.
       *
       * The step is a standing bonus for having won, so on a 2008 ladder it has to reflect what had
       * been won by then. Crediting a 2013 title to a 2008 standing would lift a player above the
       * people who actually beat them that year.
       */
      ...(filters.year != null ? { competitionYear: filters.year } : {}),
      ...(filters.year == null && (filters.fromYear != null || filters.toYear != null)
        ? {
            competitionYear: {
              ...(filters.fromYear != null ? { gte: filters.fromYear } : {}),
              ...(filters.toYear != null ? { lte: filters.toYear } : {}),
            },
          }
        : {}),
      ...(filters.competitionSeriesId != null ? { competitionSeriesId: filters.competitionSeriesId } : {}),
      ...(filters.seasonId != null ? { id: filters.seasonId } : {}),
      // A tournaments-only ladder contains no Season titles at all.
      ...(filters.eventType === 'cups' || filters.tournamentId != null ? { id: -1 } : {}),
    },
    _count: { _all: true },
  })
  const titlesOf = new Map(champs.map((c) => [c.championPlayerId!, c._count._all]))

  /*
    Tournament wins, bounded by the same period the Season titles are.

    Resolved by the ladder's own function rather than re-derived here — who won a Tournament is the
    part with judgement in it (the deepest decided match, the Swiss fallback, a team win belonging
    to every member), and two answers to that is how the two readers drift apart.

    A Seasons-only ladder counts none of them, mirroring the `id: -1` above that gives a
    Tournaments-only ladder no Season titles: a filter that excludes an event type has to exclude
    the honour that comes from it, or the step would credit a win the table is not showing.
  */
  const { tournamentWinsByPlayer } = await import('./ladder')
  const seasonsOnly = filters.eventType === 'seasons' || filters.seasonId != null || !!filters.division
  const winsOf = seasonsOnly ? new Map<string, never[]>() : await tournamentWinsByPlayer()
  const inPeriod = (w: { tournamentId: number; competitionYear: number | null; competitionSeriesId: number | null; platform: string }) => {
    if (w.platform !== platform) return false
    // A rating-neutral Tournament moves no rating, so winning one earns no step either.
    if (isRatingNeutral(w.platform, w.tournamentId)) return false
    if (filters.competitionSeriesId != null && w.competitionSeriesId !== filters.competitionSeriesId) return false
    if (filters.tournamentId != null) return true
    const y = w.competitionYear
    if (y == null) return true
    if (filters.year != null) return y === filters.year
    if (filters.fromYear != null && y < filters.fromYear) return false
    if (filters.toYear != null && y > filters.toYear) return false
    return true
  }

  for (const [playerId, v] of ratings) {
    const titles = titlesOf.get(playerId) ?? 0
    const wins = (winsOf.get(playerId) ?? []).filter(inPeriod).length
    if (titles > 0 || wins > 0) {
      v.rating = withChampionStep(v.rating, titles, wins)
      v.highestRating = withChampionStep(v.highestRating, titles, wins)
    }
  }
  return ratings
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
  /** Distinct Seasons entered and not withdrawn from — how many Seasons this player took part in. */
  seasonsPlayed: number
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
  /**
   * Season championships in the 8BRCAM series alone, under the same filters.
   *
   * A subset of `seasonTitles`, and identical to it wherever every Season in scope is 8BRCAM —
   * which is the whole Yahoo archive today. It is carried separately so the archive's championship
   * column keeps meaning "8BRCAM championships" rather than "championships that happen to be
   * 8BRCAM because nothing else exists yet".
   */
  brcamSeasonTitles: number
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
/**
 * The ledger CTE, scoped to one platform.
 *
 * Scoping here rather than in each consumer is deliberate: this CTE feeds the ranking aggregate, the
 * player detail panels and the export, and a platform filter that had to be remembered separately in
 * four places is a filter that will eventually be forgotten in one of them — producing a table that
 * mixes two rating universes without saying so.
 *
 * The value is interpolated rather than bound because it is a Postgres enum in a CTE definition, and
 * it is safe to interpolate because it is validated against the enum first and can only ever be one
 * of two literals.
 */
export function ledgerWithGames(platform: CompetitionPlatform = 'CUEVERSE'): string {
  const safe: CompetitionPlatform = platform === 'YAHOO' ? 'YAHOO' : 'CUEVERSE'
  return LEDGER_WITH_GAMES.replace(
    'LEFT JOIN "public"."comp_tournament" tou ON tou."id" = rl."tournamentId"',
    `LEFT JOIN "public"."comp_tournament" tou ON tou."id" = rl."tournamentId"
    WHERE rl."platform" = '${safe}'`,
  )
}

const LEDGER_WITH_GAMES = `
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
    case 'tournament': return `${a}.kind = 'Tournament'`
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
  // Seasons and Tournaments live in one ledger distinguished by `kind`, so the event filter is a predicate
  // rather than a different query.
  if (filters.eventType === 'seasons') clauses.push(`l.kind = 'season'`)
  if (filters.eventType === 'cups') clauses.push(`l.kind <> 'season'`)
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

  /*
   * The platform, as a SQL literal.
   *
   * Interpolated rather than parameterised because it also appears inside CTEs that take no
   * parameters, and it is not user input: `CompetitionPlatform` is a closed enum and anything that
   * is not YAHOO is CueVerse. Every championship CTE below reads it, so the ladder and its title
   * counts can never describe different universes.
   */
  const platformLiteral = filters.platform === 'YAHOO' ? 'YAHOO' : 'CUEVERSE'


  /**
   * The scope a RATING is read from, which is not the scope a record is read from.
   *
   * A rating is a running figure: it is whatever the player's last result left it at. Reading it
   * from the filtered set would restart everyone at 1500 on the first day of the From year and
   * print a number that never existed — a player who arrived in 2010 already rated 1680 would be
   * shown as a beginner.
   *
   * So the rating is bounded at the TOP only. Everything up to the end of the To year counts,
   * whichever competition or division it happened in; nothing after it does, because a snapshot of
   * 2012 must not know about 2013. The From year narrows which records and which players are shown
   * and has no business erasing rating history that legitimately happened before it.
   */
  const ratingParams: unknown[] = []
  const ratingClauses: string[] = []
  /* Read lazily so the competition scope above can number its placeholders after this block. */
  const ratingParamsLength = () => ratingParams.length
  /*
   * The time window still applies.
   *
   * `current` means the rolling 365-day ladder, and its ratings are the ones getLadder publishes —
   * so dropping this predicate would print all-time ratings under a Current heading and silently
   * disagree with the official ladder. What the rating scope drops is the FROM bound and the
   * competition, division and event filters, not the window itself.
   */
  if (scope === 'current') {
    ratingParams.push(windowStart)
    ratingClauses.push(`l."completedAt" >= $${params.length + ratingParams.length}`)
  }
  if (filters.toYear != null) {
    ratingParams.push(filters.toYear)
    ratingClauses.push(`l.comp_year <= $${params.length + ratingParams.length}`)
  }
  const ratingClause = ratingClauses.length ? `AND ${ratingClauses.join(' AND ')}` : ''

  /*
   * The competitions this ladder is made of — ONE list, used by everything.
   *
   * The aggregate below draws championships, runner-up finishes, group points and seasons-played
   * from the Season and Tournament tables directly, and until now none of those reads knew about the
   * filter. A 2012-2014 ladder therefore showed a player's 2012-2014 record beside their LIFETIME
   * championship count and lifetime seasons-played: the ranking was filtered and the honours were
   * not, which is worse than either alone because the two disagree on the same row.
   *
   * So the filter is resolved once, into a set of season ids and a set of tournament ids, and every
   * one of those reads joins it. There is no second definition of "in scope" left to drift.
   *
   * Years come from `competitionYear` — the year the competition was PLAYED. Every Yahoo season in
   * this database was imported in 2026; anything reading a timestamp would file the whole archive
   * under one year.
   */
  const compParams: unknown[] = []
  const compN = () => `$${params.length + ratingParamsLength() + compParams.length}`
  const seasonWhere: string[] = [`se."platform" = '${platformLiteral}'`]
  const tournamentWhere: string[] = [`t."platform" = '${platformLiteral}'`]

  // A tournaments-only ladder contains no seasons at all, and vice versa. An explicit single
  // competition narrows its own kind and excludes the other outright.
  if (filters.eventType === 'cups' || filters.tournamentId != null) seasonWhere.push('false')
  if (filters.eventType === 'seasons' || filters.seasonId != null || filters.division) tournamentWhere.push('false')

  if (filters.year != null) {
    compParams.push(filters.year); seasonWhere.push(`se."competitionYear" = ${compN()}`)
    compParams.push(filters.year); tournamentWhere.push(`t."competitionYear" = ${compN()}`)
  }
  if (filters.fromYear != null) {
    compParams.push(filters.fromYear); seasonWhere.push(`se."competitionYear" >= ${compN()}`)
    compParams.push(filters.fromYear); tournamentWhere.push(`t."competitionYear" >= ${compN()}`)
  }
  if (filters.toYear != null) {
    compParams.push(filters.toYear); seasonWhere.push(`se."competitionYear" <= ${compN()}`)
    compParams.push(filters.toYear); tournamentWhere.push(`t."competitionYear" <= ${compN()}`)
  }
  if (filters.competitionSeriesId != null) {
    compParams.push(filters.competitionSeriesId); seasonWhere.push(`se."competitionSeriesId" = ${compN()}`)
    // A Tournament has no series, so narrowing to one excludes tournaments rather than matching none.
    tournamentWhere.push('false')
  }
  if (filters.seasonId != null) { compParams.push(filters.seasonId); seasonWhere.push(`se."id" = ${compN()}`) }
  if (filters.tournamentId != null) { compParams.push(filters.tournamentId); tournamentWhere.push(`t."id" = ${compN()}`) }
  if (filters.division === UNASSIGNED_DIVISION) {
    seasonWhere.push(`se."division" IS NULL`)
  } else if (filters.division) {
    compParams.push(filters.division); seasonWhere.push(`se."division" = ${compN()}`)
  }

  const compScopeSql = `
    -- Every Season this ladder counts, and nothing else.
    season_scope AS (
      SELECT se."id" FROM "public"."season" se WHERE ${seasonWhere.join(' AND ')}
    ),
    -- Every Tournament this ladder counts, and nothing else.
    tournament_scope AS (
      SELECT t."id" FROM "public"."comp_tournament" t WHERE ${tournamentWhere.join(' AND ')}
    ),`

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
    && (filters.eventType == null || filters.eventType === 'all')

  const officialRanks = unfiltered
    ? import('./ladder')
      /*
       * The official ranks must come from the SAME platform the table is showing.
       *
       * Without the platform this defaulted to CueVerse while the table showed Yahoo, so the rank
       * map matched none of the rows, the "every row has an official rank" guard failed, and the
       * table quietly fell back to its own ordering. Ratings still agreed; ranks drifted by one
       * wherever two players were tied -- the least visible way for two pages to disagree.
       */
      .then((m) => m.getLadder(scope, new Date(), filters.platform ?? 'CUEVERSE'))
      .then((rows) => new Map(rows.map((r) => [r.playerId, r.rank])))
      .catch((err) => {
        console.error('[ladder-explorer] official ranks unavailable:', err instanceof Error ? err.message : err)
        return null
      })
    : Promise.resolve(null)

  const sql = `
    ${ledgerWithGames(filters.platform ?? 'CUEVERSE')},
    ${compScopeSql}
    -- Everything inside the time scope, whatever the view. Rating and peak are read from HERE, not
    -- from the view-filtered set: a player's rating is their rating, not "their rating counting only
    -- playoff matches". Narrowing it per view would print a different number for the same player on
    -- every tab and none of them would be the Ladder's.
    in_scope AS (
      SELECT l.* FROM ledger l WHERE true ${scopeClause}
    ),
    -- The fallback rating's stream. Under a period filter it is the SAME stream the records come
    -- from, so a player the canonical replay never saw still gets a number that belongs to this
    -- ladder rather than to their whole career. See the note on ratingClause.
    rating_scope AS (
      SELECT l.* FROM ledger l WHERE true ${isPeriodScoped(filters) ? scopeClause : ratingClause}
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
        FROM rating_scope s
       ORDER BY s."playerId", s."sequence" DESC
    ),
    peak AS (
      SELECT s."playerId", greatest(max(s."postRating"), ${ELO_START})::int AS peak_rating
        FROM rating_scope s
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
      -- Scoped to this platform: a title won on the other one belongs to a different ladder, and
      -- counting it here would both inflate the column and hand out the championship step for it.
      -- Tournament titles and runner-up counts below carry the same predicate for the same reason.
      --
      -- Counting DISTINCT season ids rather than rows: a Season with divisions is stored as one row
      -- per division, and a champion recorded on two of them is one championship, not two.
      -- (No backticks in here: this whole statement is a JS template literal.)
      SELECT se."championPlayerId" AS "playerId",
             count(DISTINCT se."id")::int AS season_titles,
             /*
              * The same count, narrowed to the 8BRCAM series.
              *
              * The archive's championship column asks a narrower question than "titles on this
              * ladder": how many 8BRCAM Season championships, within the filters in force. Today
              * every Yahoo Season is 8BRCAM, so the two agree — which is exactly why the predicate
              * belongs here rather than being left implicit. The moment a Yahoo-era Season from
              * another series is reconstructed, this column stays right and the other one changes.
              *
              * Matched by SLUG, not by a hardcoded id. The series id is data; the slug is the name
              * the rest of the codebase already uses for this competition.
              */
             count(DISTINCT se."id") FILTER (WHERE bs."id" IS NOT NULL)::int AS brcam_season_titles
        FROM "public"."season" se
        JOIN season_scope ss ON ss."id" = se."id"
        LEFT JOIN "public"."competition_series" bs
          ON bs."id" = se."competitionSeriesId" AND lower(bs."slug") = '8brcam'
       WHERE se."lifecycleState" = 'COMPLETED' AND se."championPlayerId" IS NOT NULL
       GROUP BY 1
    ),
    runners AS (
      SELECT e."playerId", count(*)::int AS runner_ups
        FROM "public"."season" se
        JOIN season_scope ss ON ss."id" = se."id"
        JOIN "public"."season_entrant" e
          ON e."seasonId" = se."id" AND e."playerId" IS NOT NULL
       WHERE se."lifecycleState" = 'COMPLETED'
         AND se."runnerUpHandle" IS NOT NULL
         AND lower(se."runnerUpHandle") = lower(e."username")
       GROUP BY e."playerId"
    ),
    /*
     * Who won the whole thing, taken from the bracket rather than from a name field.
     *
     * The highest round a Tournament has is its last, so its winner is the champion — true of a
     * single-elimination final and of a double-elimination grand final alike, since the grand final
     * carries the highest encoded round number. Reading it here means a title is counted the moment
     * the last match is decided, with nothing to keep in step.
     */
    tfinal AS (
      SELECT DISTINCT ON (pm."tournamentId")
             pm."tournamentId" AS tid, pm."winnerRegistrationId" AS reg
        FROM "public"."comp_playoff_match" pm
        JOIN tournament_scope ts ON ts."id" = pm."tournamentId"
        JOIN "public"."comp_tournament" t
          ON t."id" = pm."tournamentId" AND t."lifecycleState" = 'COMPLETED'
       WHERE pm."winnerRegistrationId" IS NOT NULL
       ORDER BY pm."tournamentId", pm."round" DESC, pm."slot" ASC
    ),
    /*
     * Tournament titles.
     *
     * Three ways in, because there are three shapes of champion:
     *   - a handle recorded on the Tournament, which is how Swiss (no bracket) and archive
     *     corrections say who won;
     *   - the person who won the final;
     *   - EVERY member of the team that won the final. A 5v5 title belongs to the five who played
     *     it, not to the team name — which is not a person and matches no CueVerse ID, so the old
     *     handle join credited nobody at all.
     *
     * Counted DISTINCT by tournament, so a champion found by more than one route still has one title.
     */
    tchamps AS (
      SELECT x."playerId", count(DISTINCT x.tid)::int AS tournament_titles
        FROM (
          SELECT p."id" AS "playerId", t."id" AS tid
            FROM "public"."comp_tournament" t
            JOIN tournament_scope ts ON ts."id" = t."id"
            JOIN "public"."Player" p
              ON p."cueverseId" IS NOT NULL
             AND lower(p."cueverseId") = lower(t."championHandle")
           WHERE t."championHandle" IS NOT NULL AND t."lifecycleState" = 'COMPLETED'

          UNION ALL

          SELECT r."playerId", f.tid
            FROM tfinal f
            JOIN "public"."comp_registration" r ON r."id" = f.reg

          UNION ALL

          SELECT tm."playerId", f.tid
            FROM tfinal f
            JOIN "public"."comp_tournament_team" tt ON tt."registrationId" = f.reg
            JOIN "public"."comp_tournament_team_member" tm ON tm."teamId" = tt."id"
        ) x
       WHERE x."playerId" IS NOT NULL
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
        -- Scoped like everything else. Unfiltered, this counted group stages from the other platform
        -- and from outside the selected years into a figure printed beside a filtered record.
        JOIN season_scope ss ON ss."id" = e."seasonId"
       GROUP BY e."playerId"
    ),
    aliases AS (
      -- The spelling, not the match key. The alias column is normalised for lookups, so showing it
      -- prints fsmbrian where the person wrote fsm_brian. Rows recorded before the spelling column
      -- existed have nothing to fall back to but the key, which is what they already showed.
      SELECT pa."playerId",
             array_agg(DISTINCT coalesce(nullif(btrim(pa."aliasDisplay"), ''), pa."alias")) AS alias_list
        FROM "public"."PlayerAlias" pa
       GROUP BY pa."playerId"
    ),
    quals AS (
      SELECT e."playerId",
             count(*) FILTER (WHERE e."qualification" IN ('AUTOMATIC', 'WILDCARD'))::int AS qualifications,
             count(*)::int AS season_entries,
             /*
              * Seasons the player actually took part in.
              *
              * DISTINCT on the Season, because a divisional pair can put one person in two entrant
              * rows for what a reader would call one Season. WITHDRAWN is excluded: pulling out
              * before it started is the opposite of taking part, and counting it would inflate the
              * figure for exactly the people who played least.
              */
             count(DISTINCT e."seasonId") FILTER (WHERE e."status" <> 'WITHDRAWN')::int AS seasons_played
        FROM "public"."season_entrant" e
        -- "Seasons" means seasons INSIDE this ladder. Unscoped it was a career total, so a
        -- 2012-2014 ladder credited a player with nineteen seasons next to a three-year record.
        JOIN season_scope ss ON ss."id" = e."seasonId"
       WHERE e."playerId" IS NOT NULL
       GROUP BY e."playerId"
    )
    SELECT
      a.*,
      coalesce(lt.rating, ${ELO_START})::int  AS rating,
      coalesce(pk.peak_rating, ${ELO_START})::int AS peak_rating,
      st.longest_win_run, st.last_result, coalesce(st.last_run, 0)::int AS last_run,
      coalesce(c.season_titles, 0)::int      AS season_titles,
      coalesce(c.brcam_season_titles, 0)::int AS brcam_season_titles,
      coalesce(ru.runner_ups, 0)::int        AS runner_ups,
      coalesce(tc.tournament_titles, 0)::int AS tournament_titles,
      g.group_points, g.groups_entered, g.first_places, g.perfect_stages,
      q.qualifications, q.season_entries, q.seasons_played,
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
    // The rating bound is appended after the scope predicates, matching how its placeholder
    // number was allocated above.
    rows = await prisma.$queryRawUnsafe<Raw[]>(sql, ...params, ...ratingParams, ...compParams)
  } catch (err) {
    // A failed aggregate must not take the Ladder page down; it degrades to no explorer data.
    console.error('[ladder-explorer] aggregate failed:', err instanceof Error ? err.message : err)
    return []
  }

  const num = (v: unknown): number => (v == null ? 0 : Number(v))
  const opt = (v: unknown): number | null => (v == null ? null : Number(v))
  const pct = (part: number, whole: number): number =>
    whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10

  /*
   * The rating and the peak come from the canonical replay, not from this query.
   *
   * The two definitions had genuinely drifted apart. SQL read the stored running rating — the
   * all-time figure — and called it Current; `getLadder` replayed the last 365 days from 1500. Most
   * matches fall inside the window, so the answers were close enough that the difference showed up
   * only as an occasional single point, which is the worst possible size of bug: too small to
   * notice, too real to dismiss.
   *
   * `ratingsForScope` is now the one definition of what a rating is. Both readers call it, so they
   * cannot disagree — not because they were reconciled, but because there is only one of them.
   *
   * The rest of this query is untouched: records, streaks, games and the qualification counts are
   * legitimately per-view and SQL is the right place for them.
   */
  const canonicalRatings = await ratingsForScope_(scope, now, filters)

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
      rating: canonicalRatings.get(String(r.playerId))?.rating ?? num(r.rating),
      peakRating: canonicalRatings.get(String(r.playerId))?.highestRating ?? num(r.peak_rating),
      currentStreak: lastResult === 'WIN' ? lastRun : lastResult === 'LOSS' ? -lastRun : 0,
      longestStreak: num(r.longest_win_run),
      competitionsEntered: num(r.competitions),
      seasonsPlayed: num(r.seasons_played),
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
      brcamSeasonTitles: num(r.brcam_season_titles),
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

  /*
   * Official ranks are used only if the ladder ranks EVERY row.
   *
   * The previous fallback appended an unranked player after everyone else, which produced ranks
   * that flatly contradicted the ratings beside them — a player rated 1490 sitting at #61 below one
   * rated 1395. Rating decides rank; a number that says otherwise is not a graceful degradation, it
   * is a wrong answer presented with the same confidence as a right one.
   *
   * A row missing from the ladder means the two disagree about identity — normally a player who
   * exists twice, once from the archive and once from a newly provisioned account. That is a data
   * fault worth noticing, so the table falls back to ranking the whole set by rating rather than
   * hiding it behind one plausible-looking row. The official ranks return by themselves once the
   * duplicate is resolved.
   */
  if (rankOf && mapped.every((row) => rankOf.has(row.playerId))) {
    mapped.sort((a, b) =>
      (rankOf.get(a.playerId) ?? 0) - (rankOf.get(b.playerId) ?? 0)
      || a.preferredName.toLowerCase().localeCompare(b.preferredName.toLowerCase()))
    mapped.forEach((row) => { row.rank = rankOf.get(row.playerId)! })
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
  ['ladder-explorer-v2-alias-display'],
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
export async function computeFacets(platform: CompetitionPlatform = 'CUEVERSE'): Promise<ExplorerFacets> {
  type Row = Record<string, unknown>
  try {
    /*
     * Scoped to one platform, like the ladder it describes.
     *
     * Without this the Yahoo filter offered CueVerse competitions and a 2026 year that the archive
     * has no results in -- an option that selects nothing, which reads as missing data rather than
     * as an empty intersection. It went unnoticed while CueVerse had no ranked matches at all; the
     * moment one Season was finalised the archive's year list gained a year twelve years after it
     * ended. Facets describe a ladder, so they belong to the same universe as the ladder.
     */
    const [seasons, tournaments] = await Promise.all([
      prisma.$queryRaw<Row[]>`
        SELECT se."id", se."number", se."competitionYear" AS year, se."competitionSeriesId" AS series,
               se."division", cs."name" AS series_name
          FROM "public"."season" se
          JOIN "public"."competition_series" cs ON cs."id" = se."competitionSeriesId"
         WHERE se."platform" = ${platform}::"public"."CompetitionPlatform"
           AND EXISTS (SELECT 1 FROM "public"."rating_ledger" rl WHERE rl."seasonId" = se."id")
         ORDER BY se."competitionYear" DESC, se."number" DESC`,
      prisma.$queryRaw<Row[]>`
        SELECT t."id", t."name", t."competitionYear" AS year
          FROM "public"."comp_tournament" t
         WHERE t."platform" = ${platform}::"public"."CompetitionPlatform"
           AND EXISTS (SELECT 1 FROM "public"."rating_ledger" rl WHERE rl."tournamentId" = t."id")
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

export const getFacets = unstable_cache(computeFacets, ['ladder-explorer-facets-v2'], {
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
export async function computeFreshness(platform: CompetitionPlatform = 'CUEVERSE'): Promise<RankingsFreshness> {
  type Row = Record<string, unknown>
  try {
    /*
     * Scoped to one platform, because the line it feeds sits under one platform's heading.
     *
     * Unscoped, the newest row in the whole ledger is a 2014 Yahoo result, so the current rankings
     * reported "last updated 2014" and counted 16,110 archived matches as their own. The two ladders
     * are separate replays; their freshness is separate too.
     */
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT rl."completedAt", rl."seasonId", rl."tournamentId",
             cs."name" AS series_name, se."number" AS season_number, se."competitionYear" AS season_year,
             t."name" AS tournament_name,
             (SELECT count(*) FROM "public"."rating_ledger" WHERE "platform" = ${platform}::"public"."CompetitionPlatform") AS ranked
        FROM "public"."rating_ledger" rl
        LEFT JOIN "public"."season" se ON se."id" = rl."seasonId"
        LEFT JOIN "public"."competition_series" cs ON cs."id" = se."competitionSeriesId"
        LEFT JOIN "public"."comp_tournament" t ON t."id" = rl."tournamentId"
       WHERE rl."platform" = ${platform}::"public"."CompetitionPlatform"
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
