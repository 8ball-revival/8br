import 'server-only'
import { prisma } from '@/lib/prisma'
import { getLadder } from '@/lib/stats/ladder'
import { careerTop10, careerTied, type CareerScope } from './top10-career'

/**
 * The 8 Ball Registry Top 10 panel.
 *
 * This is HISTORICAL, competition-derived ranking data. It is a different thing from the CueVerse
 * card further down the page, which mirrors an external live game leaderboard, and the two are
 * deliberately never presented as one system.
 *
 * ── What the career modes are, and are not ───────────────────────────────────────────────────────
 * "All Competitions" and the per-Competition modes are a TRANSPARENT CAREER VIEW: championships,
 * then finals reached, then match wins, then win percentage, then game differential, then a stable
 * tiebreaker. Every step is a figure a reader can check for themselves.
 *
 * They are deliberately NOT a reconstruction of an official historical ranking formula, because none
 * exists here — RankingSystem and RankingSnapshot hold no rows, and the archive carries per-category
 * Hall of Fame leaderboards rather than a composite score. Rather than invent a score and let it look
 * authoritative, the ordering is stated plainly and each mode names its own primary metric.
 *
 * Current Ladder is the one OFFICIAL rating on the panel, and it is served by the Ladder's own
 * service, unmodified and never recomputed here.
 */

export type Top10Mode =
  | 'all-competitions'
  | 'current-ladder'
  | 'season-championships'
  | 'tournament-championships'
  | `competition:${number}`

export interface Top10Row {
  rank: number
  playerId: string | null
  /** Preferred name — the primary line. */
  name: string
  /** CueVerse ID — the secondary line, and the only line when there is no preferred name. */
  handle: string | null
  /** Profile route parameter, when the player has a profile. */
  slug: string | null
  /** The figure for the selected mode, already formatted. */
  value: string
  /** True when this player shares the metric with the row above — a genuine tie, shown as one. */
  tied: boolean
}

export interface Top10Option {
  value: Top10Mode
  label: string
  group: 'Overall' | 'Championship Type' | 'By Competition'
}

export interface Top10Result {
  mode: Top10Mode
  /** What the metric column means, for the panel subtitle. */
  metricLabel: string
  rows: Top10Row[]
  /** Set when the mode cannot be served. The panel explains rather than substituting a metric. */
  unavailable?: string
  /** Where "View full rankings" should go for this mode. */
  href: string
}

/** Modes that depend on the missing historical formula. */
  + 'application yet. Rather than invent one or quietly substitute a different metric, the panel '
  + 'reports it as unavailable. Current Rankings and the championship counts below are unaffected.'

// --------------------------------------------------------------------------- options

/**
 * The dropdown's options, with every Competition listed from the database.
 *
 * Competitions are read rather than hard-coded, so creating one on the admin side makes it appear
 * here with no code change.
 */
export async function getTop10Options(): Promise<Top10Option[]> {
  const competitions = await prisma.competitionSeries.findMany({
    where: { active: true },
    orderBy: [{ name: 'asc' }],
    select: { id: true, name: true },
  })

  return [
    { value: 'all-competitions', label: 'All Competitions', group: 'Overall' },
    { value: 'current-ladder', label: 'Current Rankings', group: 'Overall' },
    { value: 'season-championships', label: 'Season Championships', group: 'Championship Type' },
    { value: 'tournament-championships', label: 'Tournament Championships', group: 'Championship Type' },
    ...competitions.map((c) => ({
      value: `competition:${c.id}` as Top10Mode,
      label: `${c.name} Only`,
      group: 'By Competition' as const,
    })),
  ]
}

/** A saved selection is only honoured if it still exists; anything else falls back to the default. */
export function normaliseMode(candidate: string | null | undefined, options: Top10Option[]): Top10Mode {
  const match = options.find((o) => o.value === candidate)
  return match ? match.value : 'all-competitions'
}

// --------------------------------------------------------------------------- identity



// --------------------------------------------------------------------------- modes



/** Current Ladder: the Ladder page's own service, unmodified. Never recomputed here. */
async function currentLadder(): Promise<Top10Row[]> {
  const rows = await getLadder('current')
  return rows.slice(0, 10).map((r, i) => ({
    rank: r.rank,
    playerId: r.playerId,
    name: r.name,
    handle: r.cueverseId,
    slug: r.slug,
    value: String(r.rating),
    // The Ladder ranks on rating; equal ratings are a genuine tie and are shown as one.
    tied: i > 0 && rows[i - 1].rating === r.rating,
  }))
}

/**
 * A career-performance ranking over a scope.
 *
 * The column shows the PRIMARY metric only — championships — as a plain whole number, because that is
 * what the panel's metric label says it is. The remaining criteria order the rows beneath it but are
 * not crammed into the same column: a cell reading "7W" under a heading of "Championships" would be
 * telling the reader something the heading contradicts.
 *
 * That does mean two rows can both show 0 and still be ordered, by finals and then wins. They are
 * correctly NOT marked as tied, because they are not tied — the criterion separating them simply is
 * not the one on display.
 */
async function careerRanking(scope: CareerScope): Promise<Top10Row[]> {
  const rows = await careerTop10(scope)
  return rows.map((r, i) => ({
    rank: i + 1,
    playerId: r.playerId,
    name: r.name,
    handle: r.handle,
    slug: r.slug,
    value: String(r.championships),
    // Tied only when EVERY ranked figure matches. The alphabetical tiebreaker settles display order
    // without implying a difference in standing.
    tied: i > 0 && careerTied(rows[i - 1], r),
  }))
}

// --------------------------------------------------------------------------- entry point

export async function getTop10(mode: Top10Mode): Promise<Top10Result> {
  if (mode === 'current-ladder') {
    return {
      mode,
      metricLabel: 'Rating',
      rows: await currentLadder(),
      href: '/rankings',
    }
  }

  if (mode === 'season-championships') {
    return {
      mode,
      metricLabel: 'Season titles',
      rows: await careerRanking({ kind: 'season' }),
      href: '/seasons',
    }
  }

  if (mode === 'tournament-championships') {
    return {
      mode,
      metricLabel: 'Tournament titles',
      rows: await careerRanking({ kind: 'tournament' }),
      href: '/tournaments',
    }
  }

  if (mode === 'all-competitions') {
    return {
      mode,
      metricLabel: 'Championships',
      rows: await careerRanking({ kind: 'all' }),
      href: '/rankings',
    }
  }

  // competition:<id> — the same ordering, restricted to one competition series.
  const seriesId = Number(mode.slice('competition:'.length))
  if (Number.isFinite(seriesId) && seriesId > 0) {
    return {
      mode,
      metricLabel: 'Championships',
      rows: await careerRanking({ kind: 'competition', competitionSeriesId: seriesId }),
      href: '/seasons',
    }
  }

  // An unparseable mode string. Fall back to the Ladder rather than showing an empty panel.
  return {
    mode: 'current-ladder',
    metricLabel: 'Rating',
    rows: await currentLadder(),
    href: '/rankings',
  }
}
