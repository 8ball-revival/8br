import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * The Yahoo era, read as its own thing.
 *
 * ── How a Yahoo record is identified ─────────────────────────────────────────────────────────────
 * By the `platform` column, and only by that column. Season, Tournament and RatingLedger each carry
 * it, so nothing here guesses from a year, a title or who played. That matters more than it sounds:
 * 8BRCAM is the SAME competition on both sides of the cutover — 48 Yahoo seasons from 2005-2014 and
 * two CueVerse ones in 2026 — so a rule based on the competition name, or on "old years", would put
 * the current season in the archive the moment somebody reconstructed an old one.
 *
 * ── What it must never do ────────────────────────────────────────────────────────────────────────
 * Invent. The archive is what survived; where it is silent this returns null and the page says so.
 * There are no defaults, no zero-filling and no inference from adjacent seasons.
 */

const YAHOO = 'YAHOO' as const

export interface YahooSummary {
  seasons: number
  players: number
  matches: number
  groupMatches: number
  playoffMatches: number
  firstYear: number | null
  lastYear: number | null
  yearsRepresented: number
  /** Seasons with a recorded champion. Equal to `seasons` here: all 48 are decided. */
  champions: number
  /**
   * How many DIFFERENT people have won a Season.
   *
   * The page prints this on its own, as "Unique champions". It used to read "26 of 48", which looks
   * like a completeness figure -- as though twenty-two Seasons were missing a winner. They are not:
   * every Season in the archive has one, and 26 is the count of distinct people who hold them.
   */
  distinctChampions: number
  tournaments: number
}

/**
 * The headline figures, counted rather than estimated.
 *
 * `matches` counts only ties that were actually contested: a playoff row with an empty side is a bye
 * or an unreached position, and counting it would inflate the archive with games nobody played.
 */
export async function getYahooSummary(): Promise<YahooSummary> {
  const seasons = await prisma.season.findMany({
    where: { platform: YAHOO },
    select: { id: true, competitionYear: true, championPlayerId: true },
  })
  const ids = seasons.map((s) => s.id)
  const years = seasons.map((s) => s.competitionYear)

  const [groupMatches, playoffMatches, players, tournaments] = await Promise.all([
    ids.length ? prisma.seasonMatch.count({ where: { seasonId: { in: ids } } }) : 0,
    ids.length
      ? prisma.seasonPlayoffMatch.count({
          where: { seasonId: { in: ids }, homeEntrantId: { not: null }, awayEntrantId: { not: null } },
        })
      : 0,
    prisma.ratingLedger.findMany({ where: { platform: YAHOO }, select: { playerId: true }, distinct: ['playerId'] }),
    prisma.tournament.count({ where: { platform: YAHOO } }),
  ])

  const champions = seasons.filter((s) => s.championPlayerId != null)
  return {
    seasons: seasons.length,
    players: players.length,
    matches: groupMatches + playoffMatches,
    groupMatches,
    playoffMatches,
    firstYear: years.length ? Math.min(...years) : null,
    lastYear: years.length ? Math.max(...years) : null,
    yearsRepresented: new Set(years).size,
    champions: champions.length,
    distinctChampions: new Set(champions.map((s) => s.championPlayerId)).size,
    tournaments,
  }
}

export interface HonorRollEntry {
  id: number
  number: number
  year: number
  title: string
  /** Null where the archive does not record one. Never filled in from anywhere else. */
  champion: string | null
  championSlug: string | null
  runnerUp: string | null
  runnerUpSlug: string | null
  finalScore: string | null
  /** The title was taken because the opponent did not play, so the score line is not a result. */
  finalsForfeit: boolean
  entrants: number
  format: string | null
  hasGroups: boolean
  hasBracket: boolean
}

/** Every Yahoo season, newest first, with whatever the archive actually holds about it. */
export async function getYahooHonorRoll(): Promise<HonorRollEntry[]> {
  const seasons = await prisma.season.findMany({
    where: { platform: YAHOO },
    orderBy: [{ competitionYear: 'desc' }, { number: 'desc' }],
    select: {
      id: true, number: true, competitionYear: true, subtitle: true,
      championName: true, championHandle: true, championPlayerId: true,
      runnerUpName: true, runnerUpHandle: true, finalScore: true, finalsForfeit: true,
      entrantsCount: true, groupStageGames: true, playoffDoubleElim: true,
    },
  })
  const ids = seasons.map((s) => s.id)
  const [withGroups, withBracket] = await Promise.all([
    ids.length ? prisma.seasonGroup.findMany({ where: { seasonId: { in: ids } }, select: { seasonId: true }, distinct: ['seasonId'] }) : [],
    ids.length ? prisma.seasonPlayoffMatch.findMany({ where: { seasonId: { in: ids } }, select: { seasonId: true }, distinct: ['seasonId'] }) : [],
  ])
  const groupSet = new Set(withGroups.map((g) => g.seasonId))
  const bracketSet = new Set(withBracket.map((b) => b.seasonId))

  return seasons.map((s) => ({
    id: s.id,
    number: s.number,
    year: s.competitionYear,
    title: s.subtitle?.trim() || `Season ${s.number}`,
    champion: s.championName?.trim() || s.championHandle?.trim() || null,
    championSlug: s.championHandle?.trim() || null,
    runnerUp: s.runnerUpName?.trim() || s.runnerUpHandle?.trim() || null,
    runnerUpSlug: s.runnerUpHandle?.trim() || null,
    finalScore: s.finalScore?.trim() || null,
    finalsForfeit: s.finalsForfeit,
    entrants: s.entrantsCount,
    format: s.playoffDoubleElim ? 'Groups → Double elimination' : 'Groups → Single elimination',
    hasGroups: groupSet.has(s.id),
    hasBracket: bracketSet.has(s.id),
  }))
}

/** Is this season part of the Yahoo archive? Guards the explorer against a CueVerse id in the URL. */
/**
 * The first and last competition year the archive actually holds.
 *
 * Read from the seasons rather than written down. The archive is closed, so a constant would be
 * correct today — and would be quietly wrong the moment somebody reconstructs a season from a year
 * not yet represented, which is exactly the kind of work this archive exists to receive.
 *
 * Returns null bounds when there are no Yahoo seasons at all, and the caller falls back to the
 * ordinary clock-derived range rather than to an empty one.
 */
export async function getYahooYearBounds(): Promise<{ min: number | null; max: number | null }> {
  const [row] = await prisma.$queryRaw<{ min: number | null; max: number | null }[]>`
    SELECT min("competitionYear")::int AS min, max("competitionYear")::int AS max
      FROM "public"."season" WHERE "platform" = 'YAHOO'
  `
  return { min: row?.min ?? null, max: row?.max ?? null }
}

export async function isYahooSeason(id: number): Promise<boolean> {
  const s = await prisma.season.findUnique({ where: { id }, select: { platform: true } })
  return s?.platform === YAHOO
}

/**
 * Which player each of a season's entrants was, keyed by entrant id.
 *
 * The group tables store a frozen username and nothing that reaches a profile, so a name in a
 * standing is only clickable if it can be tied back to a player. That tie is made here, once, and
 * the page resolves it against the same slugs the ladder is already using -- rather than building a
 * second slug rule that would eventually disagree with the first and produce links to nowhere.
 */
export async function getYahooEntrantPlayers(seasonId: number): Promise<Map<number, string>> {
  const rows = await prisma.seasonEntrant.findMany({
    where: { seasonId },
    select: { id: true, playerId: true },
  })
  const out = new Map<number, string>()
  for (const r of rows) if (r.playerId) out.set(r.id, r.playerId)
  return out
}

/**
 * Every Yahoo season in canonical order, oldest first.
 *
 * Ordered by the year it was PLAYED and then by its number within that year, which is the order the
 * competition actually ran in. Database id order looks the same until it isn't: the archive was
 * imported season by season and a later correction re-created a row, so ids carry the order somebody
 * typed them in. Previous and Next follow the competition, not the import.
 *
 * Season numbers restart each year -- there is a Season 1 in 2005 and another in 2014 -- so the id
 * remains the identifier in URLs. It is globally unique, stable, and already what every other Season
 * link on the site uses.
 */
export interface YahooSeasonRef {
  id: number
  year: number
  number: number
  /** "2005 · Season 1", the label the archive is browsed by. */
  label: string
}

export async function getYahooSeasonOrder(): Promise<YahooSeasonRef[]> {
  const rows = await prisma.season.findMany({
    where: { platform: YAHOO },
    orderBy: [{ competitionYear: 'asc' }, { number: 'asc' }],
    select: { id: true, number: true, competitionYear: true },
  })
  return rows.map((r) => ({
    id: r.id,
    year: r.competitionYear,
    number: r.number,
    label: `${r.competitionYear} \u00b7 Season ${r.number}`,
  }))
}

/** The season before and after this one in canonical order. Null at either end. */
export function yahooNeighbours(order: YahooSeasonRef[], seasonId: number): {
  previous: YahooSeasonRef | null
  next: YahooSeasonRef | null
} {
  const i = order.findIndex((s) => s.id === seasonId)
  if (i < 0) return { previous: null, next: null }
  return {
    previous: i > 0 ? order[i - 1] : null,
    next: i < order.length - 1 ? order[i + 1] : null,
  }
}
