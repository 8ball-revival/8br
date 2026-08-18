import 'server-only'
import { prisma } from '@/lib/prisma'
import { phoenixParts } from './on-this-day'

/**
 * "From the Archive" — a real historical fact, shown when nothing genuine matches today's date.
 *
 * This is the honest alternative to an empty card, and it is careful about one thing above all: it
 * never claims a day. Imported history records the year a competition belongs to but not the date its
 * matches were played (see PLAY_DATE_RULE in on-this-day), so a fact drawn from it is worded "In
 * 2005…" and stops there. Inventing a month to fill the sentence out would be inventing history.
 *
 * ── On the three entries the old live site showed ────────────────────────────────────────────────
 * The previous production homepage rotated three On This Day entries — a Luis championship, a Kevin
 * undefeated group stage, and a first Masters Invitational. Those were HARD-CODED UI FIXTURES in
 * src/lib/home/fixtures.ts with invented dates, not records of anything. They were deliberately NOT
 * migrated, and nothing here reproduces them. Everything below is read from canonical competition
 * rows at request time.
 *
 * Selection is deterministic from the Arizona date: every visitor sees the same fact on the same day,
 * and it moves on by itself tomorrow. No randomness, so two servers cannot disagree.
 */

export type ArchiveFactKind = 'champion' | 'final' | 'match'

export interface ArchiveFact {
  id: string
  kind: ArchiveFactKind
  /** The year, when one is known. Null rather than a guess. */
  year: number | null
  /** Initials for the card's avatar treatment. */
  homeInitials: string
  awayInitials: string | null
  /** Factual sentence built only from stored values. Never claims a day. */
  description: string
  /** Where it happened, e.g. "8BRCAM Season 1". */
  context: string
  href: string | null
}

function initials(name: string | null | undefined): string {
  const s = (name ?? '').trim()
  if (!s) return '—'
  const words = s.split(/[\s_.-]+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return s.slice(0, 2).toUpperCase()
}

/**
 * Everything eligible to be shown as an archive fact, best material first.
 *
 * Championships and finals come before ordinary matches because a title is what somebody wants to
 * read; a first-round group game is filler by comparison. Within a kind the order is by year, newest
 * first, and then by id — a total order, so the daily pick is reproducible.
 */
export async function archiveCandidates(): Promise<ArchiveFact[]> {
  const facts: ArchiveFact[] = []

  // --- champions and finals, from each completed Season's own close record
  const seasons = await prisma.season.findMany({
    where: {
      lifecycleState: 'COMPLETED',
      OR: [{ championHandle: { not: null } }, { championName: { not: null } }],
    },
    select: {
      id: true, number: true, competitionYear: true, finalScore: true,
      championHandle: true, championName: true,
      runnerUpHandle: true, runnerUpName: true,
      competitionSeries: { select: { name: true } },
    },
    orderBy: [{ competitionYear: 'desc' }, { id: 'desc' }],
  }).catch(() => [])

  for (const s of seasons) {
    const champion = (s.championHandle ?? s.championName ?? '').trim()
    if (!champion) continue
    const runnerUp = (s.runnerUpHandle ?? s.runnerUpName ?? '').trim()
    const context = `${s.competitionSeries?.name ?? 'Season'} Season ${s.number}`
    // "In 2005" when the year is known; otherwise the sentence simply omits it rather than guessing.
    const when = s.competitionYear ? `In ${s.competitionYear}, ` : ''

    if (runnerUp && (s.finalScore ?? '').trim()) {
      facts.push({
        id: `final:${s.id}`,
        kind: 'final',
        year: s.competitionYear ?? null,
        homeInitials: initials(champion),
        awayInitials: initials(runnerUp),
        description: `${when}${champion} beat ${runnerUp} ${s.finalScore!.trim()} in the final.`,
        context,
        href: `/seasons/${s.id}`,
      })
    } else {
      facts.push({
        id: `champion:${s.id}`,
        kind: 'champion',
        year: s.competitionYear ?? null,
        homeInitials: initials(champion),
        awayInitials: runnerUp ? initials(runnerUp) : null,
        description: `${when}${champion} won ${context}.`,
        context,
        href: `/seasons/${s.id}`,
      })
    }
  }

  // --- a decisive completed match, as lighter material behind the titles
  type Row = {
    match_key: string; home_name: string; away_name: string
    home_games: number; away_games: number; season_id: number
    number: number; competition_year: number | null; series_name: string | null
  }
  const matches = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT m."id"::text AS match_key, m."homeUsername" AS home_name, m."awayUsername" AS away_name,
           m."homeGames" AS home_games, m."awayGames" AS away_games,
           s."id" AS season_id, s."number", s."competitionYear" AS competition_year,
           cs."name" AS series_name
      FROM "public"."season_playoff_match" m
      JOIN "public"."season" s ON s."id" = m."seasonId"
      LEFT JOIN "public"."competition_series" cs ON cs."id" = s."competitionSeriesId"
     WHERE m."homeGames" IS NOT NULL AND m."awayGames" IS NOT NULL
       AND btrim(coalesce(m."homeUsername", '')) <> ''
       AND btrim(coalesce(m."awayUsername", '')) <> ''
       -- A placeholder or administrative advancement, not a contest anybody played.
       AND NOT (m."homeGames" = 0 AND m."awayGames" = 0)
       AND s."lifecycleState" = 'COMPLETED'
     ORDER BY s."competitionYear" DESC NULLS LAST, m."id" DESC
     LIMIT 40
  `).catch(() => [] as Row[])

  for (const m of matches) {
    const context = `${m.series_name ?? 'Season'} Season ${m.number}`
    const when = m.competition_year ? `In ${m.competition_year}, ` : ''
    const [winner, loser, ws, ls] = m.home_games >= m.away_games
      ? [m.home_name, m.away_name, m.home_games, m.away_games]
      : [m.away_name, m.home_name, m.away_games, m.home_games]
    facts.push({
      id: `match:${m.match_key}`,
      kind: 'match',
      year: m.competition_year ?? null,
      homeInitials: initials(winner),
      awayInitials: initials(loser),
      description: `${when}${winner} beat ${loser} ${ws}–${ls}.`,
      context,
      href: `/seasons/${m.season_id}`,
    })
  }

  return facts
}

/** Stable hash, so the daily pick is the same on every server and every request. */
function hashDay(year: number, month: number, day: number): number {
  let h = 2166136261
  for (const ch of `${year}-${month}-${day}`) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

/**
 * How strongly a title is preferred over an ordinary match.
 *
 * A championship or a final is what somebody actually wants to read; a first-round group game is
 * filler beside it. But preferring titles absolutely would show the SAME fact every day for as long
 * as only one season has been imported, so this is a weight rather than a filter: titles come up
 * several times more often than matches, and both still appear.
 *
 * As more completed seasons arrive the title pool grows and naturally dominates without this needing
 * to change.
 */
const TITLE_WEIGHT = 4

/**
 * Today's archive fact, or null when there is genuinely no canonical history.
 *
 * Null is meaningful: the caller drops the tile entirely rather than showing a large empty frame, and
 * the statistics row closes up around it.
 *
 * The pick is a pure function of the Arizona date, so every visitor sees the same fact on the same
 * day, two servers cannot disagree, and it moves on by itself tomorrow.
 */
export async function getArchiveFact(now = new Date()): Promise<ArchiveFact | null> {
  const candidates = await archiveCandidates()
  if (candidates.length === 0) return null

  // A weighted ticket list, built in the candidates' own deterministic order.
  const tickets: number[] = []
  candidates.forEach((c, i) => {
    const weight = c.kind === 'match' ? 1 : TITLE_WEIGHT
    for (let n = 0; n < weight; n += 1) tickets.push(i)
  })

  const { year, month, day } = phoenixParts(now)
  return candidates[tickets[hashDay(year, month, day) % tickets.length]]
}
