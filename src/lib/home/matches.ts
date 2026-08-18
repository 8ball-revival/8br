import 'server-only'

/**
 * What counts as a real, completed match.
 *
 * Defined once, in SQL, and reused by Recent Results, By the Numbers and On This Day. Those three
 * surfaces are read together on one page, so if they each carried their own idea of "played" a
 * visitor would be able to see them disagree — a result listed that the match count did not include.
 *
 * The rules, and why each one is here:
 *
 *  - `status` must be COMPLETED or FORFEIT. The schema distinguishes those from SCHEDULED,
 *    NO_CONTEST, VOID, NO_SHOW and DISPUTED, so legitimacy is read from the data model rather than
 *    guessed at from the score.
 *  - Both scores must be recorded. A row with a null score has no result, whatever its status says.
 *  - Both competitors must be named. This is what excludes byes and empty bracket slots: a playoff
 *    slot with nobody in it, or a walkover into the next round, has a null or blank opponent.
 *  - A FORFEIT is carried through as a forfeit and never dressed up as a played scoreline. Its games
 *    are excluded from the games total, because no games were played — the schema records the
 *    outcome, not a frame count that happened.
 *
 * Deduplication: the four tables are genuinely separate entities — a Season group match, a Season
 * playoff match, a Tournament group match and a Tournament playoff match. There is no shared
 * canonical match row that two of them could both point at, so a UNION ALL across them counts each
 * real match exactly once. Identity is the pair (source table, primary key), which is what
 * `match_key` below carries so a caller can dedupe or link without re-deriving it.
 */

/** Statuses that represent a real, finished match. */
export const LEGITIMATE_STATUSES = ['COMPLETED', 'FORFEIT'] as const

/**
 * Every legitimate completed match, from all four match tables.
 *
 * Columns are uniform so callers can treat the union as one relation:
 *   match_key   stable identity, e.g. "season_playoff:412"
 *   source      which table it came from
 *   kind        'season' | 'tournament'
 *   stage       'group' | 'playoff'
 *   is_forfeit  true when the result was a forfeit rather than a played match
 */
export const LEGITIMATE_MATCHES = `
  SELECT
    'season_group:' || m."id"          AS match_key,
    'season_group'                     AS source,
    'season'                           AS kind,
    'group'                            AS stage,
    m."seasonId"                       AS competition_id,
    NULL::text                         AS round_label,
    m."homeUsername"                   AS home_name,
    m."awayUsername"                   AS away_name,
    m."homeGames"                      AS home_games,
    m."awayGames"                      AS away_games,
    m."completedAt"                    AS completed_at,
    (m."status" = 'FORFEIT')           AS is_forfeit
  FROM "public"."season_match" m
  WHERE m."status" IN ('COMPLETED', 'FORFEIT')
    AND m."homeGames" IS NOT NULL AND m."awayGames" IS NOT NULL
    AND m."completedAt" IS NOT NULL
    AND btrim(coalesce(m."homeUsername", '')) <> ''
    AND btrim(coalesce(m."awayUsername", '')) <> ''

  UNION ALL

  SELECT
    'season_playoff:' || m."id",
    'season_playoff',
    'season',
    'playoff',
    m."seasonId",
    m."label",
    m."homeUsername",
    m."awayUsername",
    m."homeGames",
    m."awayGames",
    m."completedAt",
    (m."status" = 'FORFEIT')
  FROM "public"."season_playoff_match" m
  WHERE m."status" IN ('COMPLETED', 'FORFEIT')
    AND m."homeGames" IS NOT NULL AND m."awayGames" IS NOT NULL
    AND m."completedAt" IS NOT NULL
    AND btrim(coalesce(m."homeUsername", '')) <> ''
    AND btrim(coalesce(m."awayUsername", '')) <> ''

  UNION ALL

  SELECT
    'tournament_group:' || m."id",
    'tournament_group',
    'tournament',
    'group',
    m."tournamentId",
    NULL::text,
    m."homeUsername",
    m."awayUsername",
    m."homeGames",
    m."awayGames",
    m."completedAt",
    (m."status" = 'FORFEIT')
  FROM "public"."comp_tournament_match" m
  WHERE m."status" IN ('COMPLETED', 'FORFEIT')
    AND m."homeGames" IS NOT NULL AND m."awayGames" IS NOT NULL
    AND m."completedAt" IS NOT NULL
    AND btrim(coalesce(m."homeUsername", '')) <> ''
    AND btrim(coalesce(m."awayUsername", '')) <> ''

  UNION ALL

  SELECT
    'tournament_playoff:' || m."id",
    'tournament_playoff',
    'tournament',
    'playoff',
    m."tournamentId",
    m."label",
    m."homeUsername",
    m."awayUsername",
    m."homeGames",
    m."awayGames",
    m."completedAt",
    (m."status" = 'FORFEIT')
  FROM "public"."comp_playoff_match" m
  WHERE m."status" IN ('COMPLETED', 'FORFEIT')
    AND m."homeGames" IS NOT NULL AND m."awayGames" IS NOT NULL
    AND m."completedAt" IS NOT NULL
    AND btrim(coalesce(m."homeUsername", '')) <> ''
    AND btrim(coalesce(m."awayUsername", '')) <> ''
`

/**
 * The subset that contributes played games.
 *
 * A forfeit is a legitimate result but not a set of played frames, so it is counted as a match and
 * excluded from the game total. Inventing frames from a race format would be manufacturing data.
 */
export const PLAYED_GAME_MATCHES = `
  SELECT * FROM (${LEGITIMATE_MATCHES}) lm WHERE lm.is_forfeit = false
`
