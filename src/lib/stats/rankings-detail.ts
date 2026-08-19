import 'server-only'
import { prisma } from '@/lib/prisma'
import { LEDGER_WITH_GAMES, type LadderScope } from './ladder-explorer'

/**
 * Everything the expanded Rankings row and the comparison panel show about one player.
 *
 * Split from the table aggregate on purpose: this is fetched when a reader opens a row, so carrying
 * it for every player on every page load would mean computing a per-competition breakdown for four
 * hundred people to serve the two somebody actually looked at.
 *
 * ── The rule this file exists to keep ────────────────────────────────────────────────────────────
 * Every figure below is READ, never inferred. Where the record cannot support a statistic the
 * statistic is absent and says why, rather than being filled in with a plausible substitute. That
 * matters most for "strongest win", where the tempting substitute — the opponent's rating TODAY —
 * would describe a match that never happened.
 */

// --------------------------------------------------------------------------- round depth

/**
 * How deep a playoff round is, from the round label the competition stored.
 *
 * Higher is deeper. Deliberately a lookup rather than a parse: "Round 3" means a different depth in
 * a 16-player bracket than in a 64-player one, so a number pulled out of the text would be
 * comparing two different things. An unrecognised label returns null — unknown, not shallow.
 */
const ROUND_DEPTH: { test: RegExp; depth: number; name: string }[] = [
  { test: /grand\s*final/i, depth: 7, name: 'Grand Final' },
  { test: /^(?!.*semi)(?!.*quarter).*\bfinal\b/i, depth: 6, name: 'Final' },
  { test: /semi/i, depth: 5, name: 'Semifinal' },
  { test: /quarter/i, depth: 4, name: 'Quarterfinal' },
  { test: /round\s*of\s*8\b/i, depth: 4, name: 'Round of 8' },
  { test: /round\s*of\s*16\b/i, depth: 3, name: 'Round of 16' },
  { test: /round\s*of\s*32\b/i, depth: 2, name: 'Round of 32' },
  { test: /round\s*of\s*64\b/i, depth: 1, name: 'Round of 64' },
]

export function roundDepth(label: string | null | undefined): { depth: number; name: string } | null {
  const text = (label ?? '').trim()
  if (!text) return null
  for (const r of ROUND_DEPTH) if (r.test.test(text)) return { depth: r.depth, name: r.name }
  return null
}

// --------------------------------------------------------------------------- shapes

export interface CompetitionSplit {
  label: string
  year: number
  kind: 'season' | 'tournament'
  /** Link to the competition this record came from, so a figure can be traced to its source. */
  href: string | null
  wins: number
  losses: number
  draws: number
  gamesWon: number
  gamesLost: number
  /** Matches here whose frames were recorded. Below `wins+losses+draws` means partial game data. */
  matchesWithGameData: number
  reachedFinal: boolean
  won: boolean
  runnerUp: boolean
  /** Deepest playoff round reached in this competition, when the labels say. */
  deepestRound: string | null
}

export interface FormEntry {
  result: 'W' | 'L' | 'D'
  opponent: string
  /** "7–3", or null when the match result is recorded but the frames are not. */
  score: string | null
  isForfeit: boolean
  competition: string
  href: string | null
  /** ISO date of the match, from the stored completion time. */
  at: string
}

export interface BestSeason {
  seasonId: number
  label: string
  year: number
  wins: number
  losses: number
  draws: number
  played: number
  winPct: number
  gameDiff: number
}

export interface BestPlayoffRun {
  seasonId: number
  label: string
  year: number
  outcome: 'champion' | 'runner-up' | 'round'
  deepestRound: string | null
  wins: number
  losses: number
}

export interface StrongestWin {
  opponent: string
  /** The opponent's rating BEFORE this match, as the rating engine recorded it at the time. */
  opponentRatingBefore: number
  competition: string
  href: string | null
  at: string
}

export interface RatingPoint {
  /** Ledger sequence — the deterministic all-time order, so points cannot be reordered by date ties. */
  sequence: number
  rating: number
  at: string
}

export interface StageRecord { wins: number; losses: number; draws: number }

export interface PlayerDetail {
  playerId: string
  /** Newest first. */
  competitions: CompetitionSplit[]
  /** Most recent matches, newest first. */
  recentForm: FormEntry[]
  overallRecord: StageRecord
  groupRecord: StageRecord
  playoffRecord: StageRecord
  tournamentRecord: StageRecord
  peakRating: number | null
  longestWinStreak: number
  bestSeason: BestSeason | null
  bestPlayoffRun: BestPlayoffRun | null
  strongestWin: StrongestWin | null
  /** Why `strongestWin` is absent, when it is. Shown rather than silently omitted. */
  strongestWinUnavailable: string | null
  aliases: string[]
  /**
   * Real rating observations, oldest first. One point per ranked match — no interpolation, no
   * synthetic points between them. A period with no matches is a gap in the data and stays a gap.
   */
  ratingHistory: RatingPoint[]
}

export const EMPTY_DETAIL = (playerId: string): PlayerDetail => ({
  playerId,
  competitions: [],
  recentForm: [],
  overallRecord: { wins: 0, losses: 0, draws: 0 },
  groupRecord: { wins: 0, losses: 0, draws: 0 },
  playoffRecord: { wins: 0, losses: 0, draws: 0 },
  tournamentRecord: { wins: 0, losses: 0, draws: 0 },
  peakRating: null,
  longestWinStreak: 0,
  bestSeason: null,
  bestPlayoffRun: null,
  strongestWin: null,
  strongestWinUnavailable: null,
  aliases: [],
  ratingHistory: [],
})

// --------------------------------------------------------------------------- derived-stat rules

/**
 * The minimum matches a Season must contain before it can be anyone's best.
 *
 * Without a floor, "best season" is always whichever season someone played once and won — a 100%
 * record over a single match, which says nothing about a season. Three is the smallest number that
 * requires a run rather than a result, and it is stated in the tooltip so a reader can judge it.
 */
export const BEST_SEASON_MIN_MATCHES = 3

/**
 * Best season: highest match win percentage, then match wins, then game differential, then the
 * newest season, then the season id.
 *
 * Every step is a stored figure and the last is an identifier, so the answer is total and stable —
 * the same player always gets the same best season from the same data.
 */
export function pickBestSeason(candidates: BestSeason[]): BestSeason | null {
  const eligible = candidates.filter((c) => c.played >= BEST_SEASON_MIN_MATCHES)
  if (!eligible.length) return null
  return [...eligible].sort((a, b) =>
    b.winPct - a.winPct
    || b.wins - a.wins
    || b.gameDiff - a.gameDiff
    || b.year - a.year
    || a.seasonId - b.seasonId)[0]
}

const OUTCOME_RANK: Record<BestPlayoffRun['outcome'], number> = {
  champion: 3, 'runner-up': 2, round: 1,
}

/**
 * Best playoff run: a championship beats a runner-up finish, which beats any other run; between
 * two runs of the same kind the deeper canonical round wins, then the better playoff record, then
 * the newer season, then the season id.
 *
 * A run whose rounds cannot be read (depth null) sorts below one that can, because "we know they
 * played playoff matches" is genuinely less than "we know they reached the semifinal".
 */
export function pickBestPlayoffRun(
  candidates: (BestPlayoffRun & { depth: number | null })[],
): BestPlayoffRun | null {
  if (!candidates.length) return null
  const best = [...candidates].sort((a, b) =>
    OUTCOME_RANK[b.outcome] - OUTCOME_RANK[a.outcome]
    || (b.depth ?? -1) - (a.depth ?? -1)
    || b.wins - a.wins
    || a.losses - b.losses
    || b.year - a.year
    || a.seasonId - b.seasonId)[0]
  const { depth: _depth, ...run } = best
  return run
}

// --------------------------------------------------------------------------- the query

/**
 * Everything about one player, in a fixed number of statements regardless of how much history they
 * have. Six queries: per-competition, form, per-stage, rating history, strongest win, aliases.
 */
export async function computePlayerDetail(
  playerId: string,
  scope: LadderScope = 'all-time',
): Promise<PlayerDetail> {
  const empty = EMPTY_DETAIL(playerId)
  const WINDOW_DAYS = 365
  const windowStart = new Date(Date.now() - WINDOW_DAYS * 86_400_000)

  const scopeClause = scope === 'current' ? `AND l."completedAt" >= $2` : ''
  const params: unknown[] = scope === 'current' ? [playerId, windowStart] : [playerId]

  const perCompSql = `
    ${LEDGER_WITH_GAMES},
    mine AS (SELECT l.* FROM ledger l WHERE l."playerId" = $1 ${scopeClause}),
    per_comp AS (
      SELECT
        m.comp_key, m.kind, max(m.comp_year) AS year,
        count(*) FILTER (WHERE m."result" = 'WIN')::int  AS wins,
        count(*) FILTER (WHERE m."result" = 'LOSS')::int AS losses,
        count(*) FILTER (WHERE m."result" = 'DRAW')::int AS draws,
        coalesce(sum(m.games_for), 0)::int               AS games_won,
        coalesce(sum(m.games_against), 0)::int           AS games_lost,
        count(*) FILTER (WHERE m.has_game_data)::int     AS with_games,
        count(*) FILTER (WHERE m."stage" = 'PLAYOFF' AND m."result" = 'WIN')::int  AS playoff_wins,
        count(*) FILTER (WHERE m."stage" = 'PLAYOFF' AND m."result" = 'LOSS')::int AS playoff_losses,
        -- Every distinct playoff round label, so depth is decided from the labels rather than from
        -- a count of matches (a bye can inflate the count without a round being played).
        array_remove(array_agg(DISTINCT CASE WHEN m."stage" = 'PLAYOFF' THEN m."roundLabel" END), NULL) AS rounds,
        max(m."seasonId")     AS season_id,
        max(m."tournamentId") AS tournament_id
      FROM mine m
      GROUP BY m.comp_key, m.kind
    )
    SELECT
      pc.*,
      CASE WHEN pc.kind = 'season'
        THEN cs."name" || ' Season ' || se."number" || ' — ' || se."competitionYear"
        ELSE t."name" END AS label,
      (se."championPlayerId" = $1) AS won_season,
      (se."runnerUpHandle" IS NOT NULL
        AND lower(se."runnerUpHandle") = lower(coalesce(p."cueverseId", ''))) AS runner_up_season,
      (t."championHandle" IS NOT NULL
        AND lower(t."championHandle") = lower(coalesce(p."cueverseId", ''))) AS won_tournament
    FROM per_comp pc
    LEFT JOIN "public"."season" se ON se."id" = pc.season_id
    LEFT JOIN "public"."competition_series" cs ON cs."id" = se."competitionSeriesId"
    LEFT JOIN "public"."comp_tournament" t ON t."id" = pc.tournament_id
    LEFT JOIN "public"."Player" p ON p."id" = $1
    ORDER BY pc.year DESC, label ASC`

  const formSql = `
    ${LEDGER_WITH_GAMES},
    mine AS (SELECT l.* FROM ledger l WHERE l."playerId" = $1 ${scopeClause})
    SELECT m."result", m."opponentName", m."isForfeit", m.has_game_data,
           m.games_for, m.games_against, m."completedAt", m."seasonId", m."tournamentId",
           CASE WHEN m.kind = 'season'
             THEN cs."name" || ' Season ' || se."number" || ' — ' || se."competitionYear"
             ELSE t."name" END AS label
      FROM mine m
      LEFT JOIN "public"."season" se ON se."id" = m."seasonId"
      LEFT JOIN "public"."competition_series" cs ON cs."id" = se."competitionSeriesId"
      LEFT JOIN "public"."comp_tournament" t ON t."id" = m."tournamentId"
     ORDER BY m."sequence" DESC
     LIMIT 12`

  /**
   * Strongest recorded win, from the OPPONENT'S OWN ledger row for the same match.
   *
   * `preRating` there is what the rating engine used at the moment they played, which is the only
   * honest answer to "who is the best player they have beaten". Their rating today is a different
   * number about a different day.
   *
   * Two exclusions, both deliberate:
   *   - forfeits, because nobody played;
   *   - opponents with no earlier ranked match, whose `preRating` is the starting value everyone is
   *     issued rather than a measurement of them.
   */
  const strongestWinSql = `
    SELECT opp."playerName" AS opponent, opp."preRating" AS opponent_pre, me."completedAt",
           me."seasonId", me."tournamentId",
           CASE WHEN me."seasonId" IS NOT NULL
             THEN cs."name" || ' Season ' || se."number" || ' — ' || se."competitionYear"
             ELSE t."name" END AS label
      FROM "public"."rating_ledger" me
      JOIN "public"."rating_ledger" opp
        ON opp."matchKey" = me."matchKey" AND opp."playerId" <> me."playerId"
      LEFT JOIN "public"."season" se ON se."id" = me."seasonId"
      LEFT JOIN "public"."competition_series" cs ON cs."id" = se."competitionSeriesId"
      LEFT JOIN "public"."comp_tournament" t ON t."id" = me."tournamentId"
     WHERE me."playerId" = $1
       AND me."result" = 'WIN'
       AND NOT me."isForfeit"
       AND EXISTS (
         SELECT 1 FROM "public"."rating_ledger" prior
          WHERE prior."playerId" = opp."playerId" AND prior."sequence" < opp."sequence")
     ORDER BY opp."preRating" DESC, me."sequence" DESC
     LIMIT 1`

  type Raw = Record<string, unknown>
  let comps: Raw[] = []
  let form: Raw[] = []
  let stages: Raw[] = []
  let history: Raw[] = []
  let strongest: Raw[] = []
  let aliasRows: { alias: string }[] = []

  try {
    ;[comps, form, stages, history, strongest, aliasRows] = await Promise.all([
      prisma.$queryRawUnsafe<Raw[]>(perCompSql, ...params),
      prisma.$queryRawUnsafe<Raw[]>(formSql, ...params),
      prisma.$queryRawUnsafe<Raw[]>(
        `SELECT "stage", "seasonId" IS NOT NULL AS is_season,
                count(*) FILTER (WHERE "result" = 'WIN')::int  AS wins,
                count(*) FILTER (WHERE "result" = 'LOSS')::int AS losses,
                count(*) FILTER (WHERE "result" = 'DRAW')::int AS draws
           FROM "public"."rating_ledger" WHERE "playerId" = $1
          GROUP BY "stage", is_season`,
        playerId,
      ),
      prisma.$queryRawUnsafe<Raw[]>(
        `SELECT "sequence", "postRating", "completedAt", "result"
           FROM "public"."rating_ledger" WHERE "playerId" = $1 ORDER BY "sequence" ASC`,
        playerId,
      ),
      prisma.$queryRawUnsafe<Raw[]>(strongestWinSql, playerId),
      prisma.$queryRawUnsafe<{ alias: string }[]>(
        `SELECT "alias" FROM "public"."PlayerAlias" WHERE "playerId" = $1 ORDER BY "alias"`,
        playerId,
      ),
    ])
  } catch (err) {
    console.error('[rankings-detail] failed:', err instanceof Error ? err.message : err)
    return empty
  }

  const n = (v: unknown) => (v == null ? 0 : Number(v))
  // The per-competition query aliases its ids as season_id / tournament_id while the form query
  // keeps the ledger's own seasonId / tournamentId. Reading both is what makes one helper correct
  // for both — the first version read only the camelCase pair and silently returned null for every
  // competition row, which is a broken link that looks exactly like "no link available".
  const href = (r: Raw) => {
    const seasonId = r.seasonId ?? r.season_id
    const tournamentId = r.tournamentId ?? r.tournament_id
    return seasonId != null ? `/seasons/${Number(seasonId)}`
      : tournamentId != null ? `/cups/${Number(tournamentId)}`
        : null
  }

  // ── per competition
  const competitions: CompetitionSplit[] = comps.map((r) => {
    const rounds = Array.isArray(r.rounds) ? (r.rounds as string[]) : []
    const deepest = rounds
      .map((label) => roundDepth(label))
      .filter((x): x is { depth: number; name: string } => x != null)
      .sort((a, b) => b.depth - a.depth)[0]
    return {
      label: (r.label as string) || 'Unknown competition',
      year: n(r.year),
      kind: r.kind === 'season' ? 'season' : 'tournament',
      href: href(r),
      wins: n(r.wins),
      losses: n(r.losses),
      draws: n(r.draws),
      gamesWon: n(r.games_won),
      gamesLost: n(r.games_lost),
      matchesWithGameData: n(r.with_games),
      reachedFinal: (deepest?.depth ?? 0) >= 6,
      won: r.won_season === true || r.won_tournament === true,
      runnerUp: r.runner_up_season === true,
      deepestRound: deepest?.name ?? null,
    }
  })

  // ── recent form
  const recentForm: FormEntry[] = form.map((r) => ({
    result: r.result === 'WIN' ? 'W' : r.result === 'LOSS' ? 'L' : 'D',
    opponent: String(r.opponentName ?? 'Unknown'),
    // A recorded result with no frames shows no score rather than 0–0, which would read as a played
    // match that nobody won a game in.
    score: r.has_game_data === true ? `${n(r.games_for)}–${n(r.games_against)}` : null,
    isForfeit: r.isForfeit === true,
    competition: (r.label as string) || 'Unknown competition',
    href: href(r),
    at: r.completedAt ? new Date(r.completedAt as string).toISOString() : '',
  }))

  // ── per-stage records
  const tally = (pick: (row: Raw) => boolean): StageRecord => {
    const rows = stages.filter(pick)
    return {
      wins: rows.reduce((t, r) => t + n(r.wins), 0),
      losses: rows.reduce((t, r) => t + n(r.losses), 0),
      draws: rows.reduce((t, r) => t + n(r.draws), 0),
    }
  }
  const groupRecord = tally((r) => r.is_season === true && r.stage === 'GROUP')
  const playoffRecord = tally((r) => r.is_season === true && r.stage === 'PLAYOFF')
  const tournamentRecord = tally((r) => r.is_season !== true)
  const overallRecord = tally(() => true)

  // ── rating history and peak, from real observations only
  const ratingHistory: RatingPoint[] = history.map((r) => ({
    sequence: n(r.sequence),
    rating: n(r.postRating),
    at: r.completedAt ? new Date(r.completedAt as string).toISOString() : '',
  }))
  const peakRating = ratingHistory.length
    ? Math.max(...ratingHistory.map((p) => p.rating))
    : null

  // ── longest winning run, walked over the same ordered history in ledger sequence
  let longestWinStreak = 0
  {
    let run = 0
    for (const r of history) {
      if (r.result === 'WIN') { run += 1; if (run > longestWinStreak) longestWinStreak = run } else run = 0
    }
  }

  // ── best season, built from the raw rows so the season id comes from the query rather than from
  //    matching a display label back to a row (two Seasons can share a label across competitions).
  const bestSeason = pickBestSeason(
    comps
      .filter((r) => r.kind === 'season')
      .map((r) => {
        const wins = n(r.wins)
        const played = wins + n(r.losses) + n(r.draws)
        return {
          seasonId: Number(r.season_id ?? 0),
          label: (r.label as string) || 'Unknown competition',
          year: n(r.year),
          wins,
          losses: n(r.losses),
          draws: n(r.draws),
          played,
          winPct: played === 0 ? 0 : Math.round((wins / played) * 1000) / 10,
          gameDiff: n(r.games_won) - n(r.games_lost),
        }
      }),
  )

  // ── best playoff run
  const bestPlayoffRun = pickBestPlayoffRun(
    comps
      .filter((r) => r.kind === 'season' && (n(r.playoff_wins) + n(r.playoff_losses)) > 0)
      .map((r) => {
        const rounds = Array.isArray(r.rounds) ? (r.rounds as string[]) : []
        const deepest = rounds
          .map((label) => roundDepth(label))
          .filter((x): x is { depth: number; name: string } => x != null)
          .sort((a, b) => b.depth - a.depth)[0]
        const outcome: BestPlayoffRun['outcome'] =
          r.won_season === true ? 'champion' : r.runner_up_season === true ? 'runner-up' : 'round'
        return {
          seasonId: Number(r.season_id ?? 0),
          label: (r.label as string) || 'Unknown competition',
          year: n(r.year),
          outcome,
          deepestRound: deepest?.name ?? null,
          wins: n(r.playoff_wins),
          losses: n(r.playoff_losses),
          depth: deepest?.depth ?? null,
        }
      }),
  )

  // ── strongest recorded win
  const sw = strongest[0]
  const strongestWin: StrongestWin | null = sw
    ? {
        opponent: String(sw.opponent ?? 'Unknown'),
        opponentRatingBefore: n(sw.opponent_pre),
        competition: (sw.label as string) || 'Unknown competition',
        href: href(sw),
        at: sw.completedAt ? new Date(sw.completedAt as string).toISOString() : '',
      }
    : null

  const anyWin = overallRecord.wins > 0
  const strongestWinUnavailable = strongestWin
    ? null
    : anyWin
      ? 'No opponent they beat had a rating from an earlier match, so there is no trustworthy pre-match rating to rank their wins by.'
      : null

  return {
    playerId,
    competitions,
    recentForm,
    overallRecord,
    groupRecord,
    playoffRecord,
    tournamentRecord,
    peakRating,
    longestWinStreak,
    bestSeason,
    bestPlayoffRun,
    strongestWin,
    strongestWinUnavailable,
    aliases: aliasRows.map((a) => a.alias),
    ratingHistory,
  }
}

// --------------------------------------------------------------------------- head to head

export interface HeadToHeadPair {
  a: string
  b: string
  /** Wins for `a` against `b`. */
  aWins: number
  bWins: number
  draws: number
  /** Matches where the frames were recorded, so a 0–0 game total can be told from no data. */
  matchesWithGameData: number
  aGames: number
  bGames: number
}

/**
 * Direct meetings between the selected players.
 *
 * Both sides of a match are in the ledger, so a meeting is found by joining the ledger to itself on
 * `matchKey` — no name matching, and no chance of pairing two players who merely have similar
 * handles. The same exclusions the rankings use apply, because these are the same rows: a forfeit
 * counts as a meeting and contributes no frames.
 *
 * Emitted once per unordered pair, with `a` the lexicographically smaller id, so a pair cannot
 * appear twice with the columns swapped.
 */
export async function computeHeadToHead(playerIds: string[]): Promise<HeadToHeadPair[]> {
  const ids = [...new Set(playerIds.filter(Boolean))]
  if (ids.length < 2) return []

  try {
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `${LEDGER_WITH_GAMES}
       SELECT me."playerId" AS a, opp."playerId" AS b,
              count(*) FILTER (WHERE me."result" = 'WIN')::int  AS a_wins,
              count(*) FILTER (WHERE me."result" = 'LOSS')::int AS b_wins,
              count(*) FILTER (WHERE me."result" = 'DRAW')::int AS draws,
              count(*) FILTER (WHERE me.has_game_data)::int     AS with_games,
              coalesce(sum(me.games_for), 0)::int               AS a_games,
              coalesce(sum(me.games_against), 0)::int           AS b_games
         FROM ledger me
         JOIN "public"."rating_ledger" opp
           ON opp."matchKey" = me."matchKey" AND opp."playerId" <> me."playerId"
        WHERE me."playerId" = ANY($1) AND opp."playerId" = ANY($1)
          AND me."playerId" < opp."playerId"
        GROUP BY me."playerId", opp."playerId"`,
      ids,
    )
    const n = (v: unknown) => (v == null ? 0 : Number(v))
    return rows.map((r) => ({
      a: String(r.a),
      b: String(r.b),
      aWins: n(r.a_wins),
      bWins: n(r.b_wins),
      draws: n(r.draws),
      matchesWithGameData: n(r.with_games),
      aGames: n(r.a_games),
      bGames: n(r.b_games),
    }))
  } catch (err) {
    console.error('[rankings-detail] head-to-head failed:', err instanceof Error ? err.message : err)
    return []
  }
}
