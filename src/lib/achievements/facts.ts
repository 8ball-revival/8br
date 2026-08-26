import 'server-only'

import { prisma } from '@/lib/prisma'
import type { CompetitionPlatform } from '@prisma/client'

/**
 * Everything the eighteen awards need, loaded once.
 *
 * ── Why one loader rather than a query per award ─────────────────────────────────────────────────
 * Eighteen awards over the same five tables is eighteen chances to filter slightly differently.
 * "Completed Seasons" would end up meaning one thing in the Choker and another in the Participation
 * Award, and nobody would notice because each card looks right on its own. Loading the rows once and
 * computing in memory makes the filters impossible to disagree about, and it is also the difference
 * between five round trips and fifty on every homepage render.
 *
 * The whole working set is about thirteen thousand small rows. That is nothing to hold, and every
 * award is then a pass over arrays rather than a database call.
 *
 * ── Identity ─────────────────────────────────────────────────────────────────────────────────────
 * Nothing here matches players by name. Every match row carries an entrant id, every entrant links
 * to exactly one canonical Player, and awards are counted against that Player id — so somebody who
 * has changed handle three times is one competitor, and two people called Chris are two.
 */

export interface FactSeason {
  id: number
  number: number
  year: number
  championPlayerId: string | null
  entrantsCount: number
  /** Chronological position across the whole archive. Index 0 is the earliest Season. */
  order: number
}

export interface FactMatch {
  seasonId: number
  /** Canonical player ids. Null when a slot was empty — a bye, or an unfilled bracket position. */
  homePlayerId: string | null
  awayPlayerId: string | null
  homeGames: number | null
  awayGames: number | null
  status: string
  winnerPlayerId: string | null
  forfeitPlayerId: string | null
  /** Playoff only. `Final` identifies the title match. */
  label: string | null
  stage: 'GROUP' | 'PLAYOFF'
}

export interface AchievementFacts {
  seasons: FactSeason[]
  matches: FactMatch[]
  /** Season id → the canonical player ids that entered it. */
  entrantsBySeason: Map<number, Set<string>>
  players: Map<string, { cueverseId: string | null; preferredName: string }>
}

/**
 * A Season counts when it is COMPLETED on the platform being asked about.
 *
 * An open or in-progress Season has no champion and half a bracket; including one would make every
 * "most X" award drift as results arrived, and would let a player lead the Choker on a final that
 * has not been played.
 */
export async function loadAchievementFacts(platform: CompetitionPlatform = 'YAHOO'): Promise<AchievementFacts> {
  const seasonRows = await prisma.season.findMany({
    where: { platform, lifecycleState: 'COMPLETED' },
    select: {
      id: true, number: true, competitionYear: true, championPlayerId: true, entrantsCount: true,
    },
    orderBy: [{ competitionYear: 'asc' }, { number: 'asc' }, { id: 'asc' }],
  })
  const seasons: FactSeason[] = seasonRows.map((s, i) => ({
    id: s.id,
    number: s.number,
    year: s.competitionYear,
    championPlayerId: s.championPlayerId,
    entrantsCount: s.entrantsCount,
    order: i,
  }))
  const seasonIds = seasons.map((s) => s.id)
  if (seasonIds.length === 0) {
    return { seasons: [], matches: [], entrantsBySeason: new Map(), players: new Map() }
  }

  const entrants = await prisma.seasonEntrant.findMany({
    where: { seasonId: { in: seasonIds } },
    select: { id: true, seasonId: true, playerId: true },
  })
  /* entrant id → canonical player id. The only bridge between a match row and a competitor. */
  const toPlayer = new Map<number, string>()
  const entrantsBySeason = new Map<number, Set<string>>()
  for (const e of entrants) {
    if (!e.playerId) continue
    toPlayer.set(e.id, e.playerId)
    const set = entrantsBySeason.get(e.seasonId) ?? new Set<string>()
    set.add(e.playerId)
    entrantsBySeason.set(e.seasonId, set)
  }

  const [groupRows, playoffRows] = await Promise.all([
    prisma.seasonMatch.findMany({
      where: { seasonId: { in: seasonIds } },
      select: {
        seasonId: true, homeEntrantId: true, awayEntrantId: true, homeGames: true, awayGames: true,
        status: true, winnerEntrantId: true, forfeitEntrantId: true,
      },
    }),
    prisma.seasonPlayoffMatch.findMany({
      where: { seasonId: { in: seasonIds } },
      select: {
        seasonId: true, homeEntrantId: true, awayEntrantId: true, homeGames: true, awayGames: true,
        status: true, winnerEntrantId: true, forfeitEntrantId: true, label: true,
      },
    }),
  ])

  const pid = (id: number | null | undefined) => (id == null ? null : toPlayer.get(id) ?? null)

  const matches: FactMatch[] = [
    ...groupRows.map((m): FactMatch => ({
      seasonId: m.seasonId,
      homePlayerId: pid(m.homeEntrantId),
      awayPlayerId: pid(m.awayEntrantId),
      homeGames: m.homeGames,
      awayGames: m.awayGames,
      status: m.status,
      winnerPlayerId: pid(m.winnerEntrantId),
      forfeitPlayerId: pid(m.forfeitEntrantId),
      label: null,
      stage: 'GROUP',
    })),
    ...playoffRows.map((m): FactMatch => ({
      seasonId: m.seasonId,
      homePlayerId: pid(m.homeEntrantId),
      awayPlayerId: pid(m.awayEntrantId),
      homeGames: m.homeGames,
      awayGames: m.awayGames,
      status: m.status,
      winnerPlayerId: pid(m.winnerEntrantId),
      forfeitPlayerId: pid(m.forfeitEntrantId),
      label: m.label,
      stage: 'PLAYOFF',
    })),
  ]

  const ids = new Set<string>()
  for (const s of seasons) if (s.championPlayerId) ids.add(s.championPlayerId)
  for (const set of entrantsBySeason.values()) for (const p of set) ids.add(p)

  const playerRows = ids.size
    ? await prisma.player.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, cueverseId: true, primaryName: true },
    })
    : []
  /*
   * There is no slug column on Player. The public profile route is /players/[cueverse], keyed by the
   * handle itself, which is also why a player with no handle has no profile to link to.
   */
  const players = new Map(playerRows.map((p) => [
    p.id,
    { cueverseId: p.cueverseId, preferredName: p.primaryName },
  ]))

  return { seasons, matches, entrantsBySeason, players }
}
