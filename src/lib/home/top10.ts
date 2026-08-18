import 'server-only'
import { prisma } from '@/lib/prisma'
import { getLadder } from '@/lib/stats/ladder'
import { resolveCanonicalPlayerIds } from '@/lib/players/merge'

/**
 * The 8 Ball Registry Top 10 panel.
 *
 * This is HISTORICAL, competition-derived ranking data. It is a different thing from the CueVerse
 * card further down the page, which mirrors an external live game leaderboard, and the two are
 * deliberately never presented as one system.
 *
 * ── A note on the two unimplemented modes ────────────────────────────────────────────────────────
 * The specification asks for an "All Competitions" mode and a per-Competition mode, both using the
 * application's official historical ranking formula. No such formula exists in this codebase.
 *
 * What was checked: `RankingSystem`, `RankingSnapshot` and `RankingSnapshotItem` exist as models but
 * hold no rows and have no scoring implementation; the archive CSVs contain per-category Hall of
 * Fame leaderboards (championships, total wins, playoff wins, and so on) but no composite score; the
 * retired `annual-rankings` service is gone; and the only live ranking engine is the Elo ladder,
 * which is the Current Ladder mode below.
 *
 * Inventing a formula would produce an authoritative-looking ranking that nobody agreed to, and
 * silently substituting championships or ladder rating for it would be worse — it would look right.
 * So those two modes are declared here, reported as unavailable, and rendered as an honest
 * explanation. Everything else on the panel works.
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
const NEEDS_HISTORICAL_FORMULA =
  'This ranking needs the official historical scoring formula, which does not exist in the '
  + 'application yet. Rather than invent one or quietly substitute a different metric, the panel '
  + 'reports it as unavailable. Current Ladder and the championship counts below are unaffected.'

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
    { value: 'current-ladder', label: 'Current Ladder', group: 'Overall' },
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

interface Winner { playerId: string | null; name: string; handle: string | null }

/**
 * Collapse championship winners onto canonical players and count them.
 *
 * Merged identities must count once. Where a competition recorded a canonical player id, that is
 * used and resolved through any later merge. Where it recorded only a name — an archive-era row with
 * no linked profile — the name is the identity, which is the best the stored data supports.
 */
async function tallyChampionships(winners: Winner[]): Promise<Map<string, { count: number; winner: Winner }>> {
  const withIds = winners.map((w) => w.playerId).filter((id): id is string => id != null)
  const canonical = await resolveCanonicalPlayerIds(withIds)

  const tally = new Map<string, { count: number; winner: Winner }>()
  for (const w of winners) {
    const canonicalId = w.playerId ? canonical.get(w.playerId) ?? w.playerId : null
    const key = canonicalId ?? `name:${(w.handle ?? w.name).trim().toLowerCase()}`
    const existing = tally.get(key)
    if (existing) existing.count += 1
    else tally.set(key, { count: 1, winner: { ...w, playerId: canonicalId } })
  }
  return tally
}

/** Fill in the display identity for canonical players we have a profile for. */
async function decorate(tally: Map<string, { count: number; winner: Winner }>): Promise<Top10Row[]> {
  const ids = [...tally.values()].map((v) => v.winner.playerId).filter((id): id is string => id != null)
  const players = ids.length
    ? await prisma.player.findMany({
      where: { id: { in: ids } },
      select: { id: true, primaryName: true, cueverseId: true },
    })
    : []
  const byId = new Map(players.map((p) => [p.id, p]))

  const ordered = [...tally.values()]
    .map((v) => {
      const p = v.winner.playerId ? byId.get(v.winner.playerId) : null
      return {
        playerId: v.winner.playerId,
        name: p?.primaryName ?? v.winner.name,
        handle: p?.cueverseId ?? v.winner.handle,
        slug: p?.cueverseId ?? null,
        count: v.count,
      }
    })
    // Most titles first. Alphabetical only breaks a tie — it decides display order, never standing,
    // which is why tied rows are marked as tied rather than being numbered 1, 2, 3.
    .sort((a, b) => b.count - a.count || (a.handle ?? a.name).localeCompare(b.handle ?? b.name))
    .slice(0, 10)

  return ordered.map((row, i) => ({
    rank: i + 1,
    playerId: row.playerId,
    name: row.name,
    handle: row.handle,
    slug: row.slug,
    value: String(row.count),
    tied: i > 0 && ordered[i - 1].count === row.count,
  }))
}

// --------------------------------------------------------------------------- modes

/**
 * Season championships: completed Seasons only.
 *
 * A Season awards its title when it reaches COMPLETED. An active, reopened, draft or cancelled
 * Season awards nothing, even if a `championName` is sitting on the row from an earlier close.
 */
async function seasonChampionships(competitionSeriesId?: number): Promise<Top10Row[]> {
  const seasons = await prisma.season.findMany({
    where: {
      lifecycleState: 'COMPLETED',
      ...(competitionSeriesId ? { competitionSeriesId } : {}),
      OR: [{ championPlayerId: { not: null } }, { championName: { not: null } }],
    },
    select: { championPlayerId: true, championName: true, championHandle: true },
  })

  const winners = seasons
    .filter((s) => s.championPlayerId || (s.championName ?? '').trim())
    .map((s) => ({
      playerId: s.championPlayerId,
      name: (s.championName ?? '').trim(),
      handle: s.championHandle,
    }))

  return decorate(await tallyChampionships(winners))
}

/**
 * Tournament championships: completed Tournaments only, and never Seasons.
 *
 * The two are separate competition types in this application, so the separation the specification
 * asks for is structural rather than a filter that could drift.
 */
async function tournamentChampionships(): Promise<Top10Row[]> {
  const tournaments = await prisma.tournament.findMany({
    where: { status: 'COMPLETED', championName: { not: null } },
    select: { championName: true },
  })

  const winners = tournaments
    .filter((t) => (t.championName ?? '').trim())
    .map((t) => ({ playerId: null, name: (t.championName ?? '').trim(), handle: null }))

  return decorate(await tallyChampionships(winners))
}

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
      rows: await seasonChampionships(),
      href: '/seasons',
    }
  }

  if (mode === 'tournament-championships') {
    return {
      mode,
      metricLabel: 'Tournament titles',
      rows: await tournamentChampionships(),
      href: '/tournaments',
    }
  }

  // All Competitions and per-Competition both require the historical formula.
  return {
    mode,
    metricLabel: 'Historical score',
    rows: [],
    unavailable: NEEDS_HISTORICAL_FORMULA,
    href: '/rankings',
  }
}
