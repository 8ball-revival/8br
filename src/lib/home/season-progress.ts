import 'server-only'

import { unstable_cache, revalidatePath, revalidateTag } from 'next/cache'

import { prisma } from '@/lib/prisma'
import { getLadder } from '@/lib/stats/ladder'
import { compareSeasonProgress, gameWinPct } from './season-progress-order'

/**
 * Season Progress — one Season's group stage as a single cross-group standings table.
 *
 * ── Every number here is read, never recomputed ──────────────────────────────────────────────────
 * Sets, games and points come from the persisted `SeasonStanding` rows. Those rows are written by
 * `recomputeSeasonStandings`, which is the only thing in the codebase that computes them, and it
 * runs on every path that can change a group result — saving a score, closing the groups, clearing
 * a match, reopening the stage. So the rules about what a forfeit is worth, whether a draw scores,
 * which statuses count and how the completion bonus is earned are all decided there and merely
 * displayed here.
 *
 * That matters most for the two things a homepage panel would otherwise get wrong:
 *
 *   - A FORFEIT is handed to the standings as 0–0 with a winner, so it moves the set record and the
 *     points and contributes NO games. This panel therefore cannot fabricate a 9–0 out of a
 *     walkover — not because it is careful, but because those games were never counted at all.
 *   - NO_CONTEST and VOID matches are excluded from the recompute entirely, so an uncontested
 *     fixture and a kicked-out player's voided matches contribute nothing.
 *
 * ── Why the points can look small ────────────────────────────────────────────────────────────────
 * `SeasonStanding.points` carries whatever the scale was when the row was computed. Season 1 of 2026
 * was closed under Win = 2 and its stored totals still say so; the current rule is Win = 3, Draw = 1,
 * plus 1 for completing the group. Reading the stored value is what keeps a finished season's table
 * agreeing with the season it describes rather than silently restating history under a newer rule.
 *
 * ── The population ───────────────────────────────────────────────────────────────────────────────
 * Every APPROVED entrant, whether or not they have played and whether or not the groups have been
 * published. Before the draw there are no standings rows at all and the panel is still correct:
 * everybody shows 0–0–0, in ladder order. Kicked-out entrants are excluded — their matches are
 * voided and they are out of the competition, so a row for them would be a row for somebody who
 * cannot appear again.
 */

export interface SeasonProgressRow {
  entrantId: number
  playerId: string | null
  /**
   * The CueVerse ID, and the only identity this panel renders.
   *
   * Read from the canonical `Player` record first and the entrant's own column second, so a handle
   * corrected since registration shows as corrected. Falls back to the entrant's frozen `username`
   * only when neither exists — that is the as-played competition identity a manually added entrant
   * was recorded under, not a preferred name.
   */
  handle: string
  /** The `/players/<slug>` parameter, or null when there is no profile to open. */
  slug: string | null
  played: number
  wins: number
  losses: number
  draws: number
  gamesWon: number
  gamesLost: number
  points: number
  /** 0–100, or null when no numeric game score has been recorded. */
  gameWinPct: number | null
  ladderRank: number | null
}

/**
 * The four figures in the panel's header strip.
 *
 * Counted from the same rows the table is built from, so the strip cannot disagree with the list
 * beneath it — a header saying 32 players above a table of 31 is the failure this shape prevents.
 */
export interface SeasonProgressStats {
  /** Published groups. A draft group is not yet part of the competition anybody can see. */
  groups: number
  players: number
  /** Resolved group matches — the ones that moved a standing. */
  matchesPlayed: number
  /** Every scheduled group match, so the pair reads as progress through the stage. */
  matchesTotal: number
}

export interface SeasonProgressView {
  seasonId: number
  /** The Season's own page. */
  href: string
  /** "8BRCAM Season 2" — built from the competition relation and the number, never from a title. */
  label: string
  /** "Group stage", "Playoffs" — the lifecycle state in a reader's words. */
  phase: string
  entrants: number
  /** Whether the competition is currently running, for the live dot. */
  live: boolean
  stats: SeasonProgressStats
  rows: SeasonProgressRow[]
}

/** How the panel is told which Season to show. */
export interface SeasonProgressTarget {
  /** An explicit Season id wins outright: it is the only identifier that cannot be ambiguous. */
  seasonId?: number
  /** Otherwise the competition relation, plus the season's number and year. */
  seriesSlug?: string
  number?: number
  year?: number
}

/**
 * A reader's word for each lifecycle state.
 *
 * Written out rather than prettified from the enum, because "GROUP_STAGE_LIVE" de-underscored is
 * "Group stage live", which reads as a status where the panel wants a phase — the live dot beside it
 * is already saying "live".
 */
const PHASE: Record<string, { label: string; live: boolean }> = {
  REGISTRATION_SCHEDULED: { label: 'Registration opening', live: false },
  REGISTRATION_OPEN: { label: 'Registration open', live: true },
  REGISTRATION_CLOSED: { label: 'Registration closed', live: true },
  GROUP_SETUP: { label: 'Group setup', live: true },
  GROUP_STAGE_LIVE: { label: 'Group stage', live: true },
  GROUPS_CLOSED: { label: 'Groups closed', live: true },
  PLAYOFFS_LIVE: { label: 'Playoffs', live: true },
  COMPLETED: { label: 'Completed', live: false },
  CANCELLED: { label: 'Cancelled', live: false },
}

/**
 * Find the Season, by relation rather than by name.
 *
 * A display title is the wrong key twice over: it is editable, so renaming a season would silently
 * empty this panel, and it is not unique, because "Season 2" exists in 2013 and again in 2026. The
 * competition relation plus the number plus the year is a real composite identity, and an explicit
 * id short-circuits it for a season that has been pinned deliberately.
 */
async function resolveSeasonId(target: SeasonProgressTarget): Promise<number | null> {
  if (target.seasonId && target.seasonId > 0) {
    const found = await prisma.season.findUnique({ where: { id: target.seasonId }, select: { id: true } })
    return found?.id ?? null
  }
  if (!target.seriesSlug || !target.number) return null
  const season = await prisma.season.findFirst({
    where: {
      competitionSeries: { slug: target.seriesSlug },
      number: target.number,
      ...(target.year ? { competitionYear: target.year } : {}),
    },
    // Newest first, so a target with no year given resolves to the current running of that number.
    orderBy: [{ competitionYear: 'desc' }, { id: 'desc' }],
    select: { id: true },
  })
  return season?.id ?? null
}

async function computeSeasonProgress(target: SeasonProgressTarget): Promise<SeasonProgressView | null> {
  const seasonId = await resolveSeasonId(target)
  if (!seasonId) return null

  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    select: {
      id: true, number: true, competitionYear: true, lifecycleState: true,
      competitionSeries: { select: { name: true } },
    },
  })
  if (!season) return null

  /*
    Four reads, not one per entrant.

    A row needs the entrant, their standing, their canonical handle and their ladder rank. Gathered
    per player that is dozens of queries for one panel; gathered like this it is four, whatever the
    size of the season. `getLadder` is the Rankings page's own cached service, so the rank column
    costs nothing extra once anything else on the page has already asked for it.
  */
  const [entrants, standings, ladder, groupCount, matchCounts] = await Promise.all([
    prisma.seasonEntrant.findMany({
      where: { seasonId, status: 'APPROVED', kickedOut: false },
      select: { id: true, playerId: true, username: true, cueverseId: true },
    }),
    prisma.seasonStanding.findMany({
      where: { seasonId },
      select: {
        entrantId: true, played: true, wins: true, losses: true, draws: true,
        gamesWon: true, gamesLost: true, points: true,
      },
    }),
    getLadder('current'),
    prisma.seasonGroup.count({ where: { seasonId, published: true } }),
    /*
      One grouped query for the match figures, not two counts.

      `status` is what separates a played match from a scheduled one, so grouping by it answers both
      halves of "21 / 112" in a single round trip — and it keeps the definition of "played" in one
      place rather than in two `where` clauses that could drift.
    */
    prisma.seasonMatch.groupBy({ by: ['status'], where: { seasonId }, _count: { _all: true } }),
  ])

  const playerIds = [...new Set(entrants.map((e) => e.playerId).filter((p): p is string => !!p))]
  const players = playerIds.length
    ? await prisma.player.findMany({ where: { id: { in: playerIds } }, select: { id: true, cueverseId: true } })
    : []

  const canonical = new Map(players.map((p) => [p.id, p.cueverseId?.trim() || null]))
  const byEntrant = new Map(standings.map((s) => [s.entrantId, s]))
  const rankByPlayer = new Map(ladder.map((r) => [r.playerId, r.rank]))

  const rows: SeasonProgressRow[] = entrants.map((e) => {
    const s = byEntrant.get(e.id)
    const canonicalHandle = (e.playerId ? canonical.get(e.playerId) : null) ?? null
    const handle = canonicalHandle || e.cueverseId?.trim() || e.username
    return {
      entrantId: e.id,
      playerId: e.playerId,
      handle,
      // The route resolves a player by handle OR by id, so either opens a profile; neither is slugified.
      slug: canonicalHandle || e.playerId || null,
      played: s?.played ?? 0,
      wins: s?.wins ?? 0,
      losses: s?.losses ?? 0,
      draws: s?.draws ?? 0,
      gamesWon: s?.gamesWon ?? 0,
      gamesLost: s?.gamesLost ?? 0,
      points: s?.points ?? 0,
      gameWinPct: gameWinPct(s?.gamesWon ?? 0, s?.gamesLost ?? 0),
      ladderRank: e.playerId ? rankByPlayer.get(e.playerId) ?? null : null,
    }
  })

  rows.sort(compareSeasonProgress)

  /*
    Played means resolved: a result was recorded, or the match was awarded on a forfeit.

    The same two statuses `recomputeSeasonStandings` counts. NO_CONTEST and VOID are deliberately
    NOT played — but they are still scheduled, so they stay in the denominator: a stage of 112
    fixtures does not become a stage of 108 because four were never contested.
  */
  const RESOLVED = new Set(['COMPLETED', 'FORFEIT'])
  const matchesTotal = matchCounts.reduce((n, g) => n + g._count._all, 0)
  const matchesPlayed = matchCounts
    .filter((g) => RESOLVED.has(g.status))
    .reduce((n, g) => n + g._count._all, 0)

  const phase = PHASE[season.lifecycleState] ?? { label: 'In progress', live: true }
  return {
    seasonId: season.id,
    href: `/seasons/${season.id}`,
    label: `${season.competitionSeries?.name ?? 'Season'} Season ${season.number}`,
    phase: phase.label,
    entrants: rows.length,
    live: phase.live,
    stats: {
      groups: groupCount,
      // The same number the table renders, not a second count of the same people.
      players: rows.length,
      matchesPlayed,
      matchesTotal,
    },
    rows,
  }
}

export const SEASON_PROGRESS_TAG = 'season-progress'

/**
 * Cached under its own tag, and invalidated rather than waited out.
 *
 * The window is long because it does not need to be short: `invalidateSeasonProgress` is called by
 * `recomputeSeasonStandings`, which every result mutation already goes through, so the entry is
 * dropped the moment a score changes rather than expiring on a timer. A short window would only
 * mean re-running the query for nothing between edits.
 */
/*
  ── The version in the key is load-bearing ──────────────────────────────────────────────────────

  Bumped to v2 when the header statistics were added, and to v3 when Qualified was dropped.

  The entries under a key are whatever shape they had when they were written, and they outlive a
  deploy — the cache is on disk, not in the process. So new code reading an OLD entry gets an object
  with no `stats` at all, and the panel throws on `stats.groups` for everyone until the window
  expires. Nothing in the type system catches it: the cached value is typed by the function that
  WOULD have produced it, not by the one that did.

  So: any change to the returned shape gets a new key. Old entries are then simply never read again.
*/
const cachedSeasonProgress = unstable_cache(
  async (target: SeasonProgressTarget) => computeSeasonProgress(target),
  ['season-progress-v3-stats'],
  { tags: [SEASON_PROGRESS_TAG], revalidate: 300 },
)

export async function getSeasonProgress(target: SeasonProgressTarget): Promise<SeasonProgressView | null> {
  return cachedSeasonProgress(target)
}

/** The uncached path, for scripts and the verification suite — `unstable_cache` needs a request. */
export { computeSeasonProgress }

/**
 * Drop the panel's data after a result changes.
 *
 * Called from `recomputeSeasonStandings`, which is the single choke point every mutation path
 * already runs through — a new score, an edit, a clear, a forfeit, a draw, a close and a reopen. A
 * new path cannot forget to invalidate this: it would have to avoid recomputing the standings, which
 * would be a bug of its own.
 *
 * Both the tag and the path, for the reason spelled out in `invalidate-rankings.ts`: revalidating
 * the path alone re-renders the homepage and reads the same cached rows straight back. Never throws
 * — these services also run from scripts, where there is no request store and nothing is cached.
 */
export function invalidateSeasonProgress(): void {
  try {
    revalidateTag(SEASON_PROGRESS_TAG, 'max')
    revalidatePath('/')
  } catch {
    // Not inside a request. Nothing is cached here, so there is nothing to drop.
  }
}
