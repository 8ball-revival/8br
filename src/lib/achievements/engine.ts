import 'server-only'

import type { AchievementDefinition } from '@prisma/client'

import { computeExplorer, type ExplorerRow, type RecordView, type ExplorerFilters } from '@/lib/stats/ladder-explorer'
import { prisma } from '@/lib/prisma'

import { statistic, applyFormat, formatValue, type StatDefinition } from './statistics'
import type { Achievement, AchievementPlayer } from './types'

/**
 * Turning a stored rule into a current holder.
 *
 * ── The whole point ──────────────────────────────────────────────────────────────────────────────
 * An automatic achievement stores no winner. It stores what to measure, over which competitions, at
 * which stage, and which end of the range wins. The holder is worked out on read, so importing a
 * season, correcting a score or merging two players changes the card with no edit — which is the
 * behaviour that was asked for and the reason this is a rule engine rather than a table of results.
 *
 * ── It reads the Rankings aggregate, not the database ────────────────────────────────────────────
 * Every figure comes from `getExplorer`, the same service /rankings is built from. That is what
 * makes an achievement's numbers reconcilable: if a card says 144 wins, the Rankings table says 144
 * wins, because it is literally the same row.
 *
 * ── Cost ─────────────────────────────────────────────────────────────────────────────────────────
 * Rules that share a scope share a query: the context deduplicates by scope key before loading, so
 * twenty achievements over "all competitions, all matches" issue ONE aggregate between them, not
 * twenty. Only a rule with a genuinely different scope pays for another.
 *
 * ── Uncached on purpose ──────────────────────────────────────────────────────────────────────────
 * This calls `computeExplorer`, not the `getExplorer` wrapper around it. The wrapper is
 * `unstable_cache`, which throws outside a request context — that would make the engine unusable
 * from a script and untestable, which for a rule engine is the wrong trade. Caching belongs one
 * layer up, in the service, where the whole resolved set is cached once under the tags that
 * invalidate it.
 */

/* ────────────────────────────────────────────────────────────────────────── finals stats ───────── */

export interface FinalsStat { reached: number; won: number; lost: number }

/**
 * Finals record per player, from the season archive.
 *
 * Not on the Rankings row because nothing else needed it. Read from the playoff matches labelled
 * `Final`, through the entrant → canonical Player link, so a player who changed handle three times
 * is one person here as everywhere else.
 */
export async function loadFinalsStats(platform: 'CUEVERSE' | 'YAHOO'): Promise<Map<string, FinalsStat>> {
  const finals = await prisma.seasonPlayoffMatch.findMany({
    where: { label: 'Final', season: { platform, lifecycleState: 'COMPLETED' } },
    select: { homeEntrantId: true, awayEntrantId: true, winnerEntrantId: true, status: true },
  })
  const entrantIds = [...new Set(finals.flatMap((m) => [m.homeEntrantId, m.awayEntrantId]).filter((x): x is number => x != null))]
  if (entrantIds.length === 0) return new Map()

  const entrants = await prisma.seasonEntrant.findMany({
    where: { id: { in: entrantIds } },
    select: { id: true, playerId: true },
  })
  const toPlayer = new Map(entrants.filter((e) => e.playerId).map((e) => [e.id, e.playerId as string]))

  const out = new Map<string, FinalsStat>()
  const bump = (id: string, key: keyof FinalsStat) => {
    const cur = out.get(id) ?? { reached: 0, won: 0, lost: 0 }
    cur[key] += 1
    out.set(id, cur)
  }
  for (const m of finals) {
    // Both sides present only: a one-sided slot is a bye, not a final anybody reached.
    if (m.homeEntrantId == null || m.awayEntrantId == null) continue
    const home = toPlayer.get(m.homeEntrantId)
    const away = toPlayer.get(m.awayEntrantId)
    const winner = m.winnerEntrantId != null ? toPlayer.get(m.winnerEntrantId) : null
    for (const p of [home, away]) if (p) bump(p, 'reached')
    if (winner) bump(winner, 'won')
    const loser = winner ? [home, away].find((p) => p && p !== winner) : null
    if (loser) bump(loser, 'lost')
  }
  return out
}

/* ─────────────────────────────────────────────────────────────────────────── evaluation ───────── */

const STAGE_TO_VIEW: Record<string, RecordView> = {
  ALL_MATCHES: 'overall',
  GROUP_STAGE: 'group',
  PLAYOFFS: 'playoff',
  // Finals are not a RecordView. A finals-scoped rule reads the overall aggregate and takes its
  // figure from the finals map instead, which is why only finals STATISTICS may use this stage.
  FINALS: 'overall',
}

/** The filters a rule's scope implies. */
export function filtersFor(def: AchievementDefinition): ExplorerFilters {
  const base: ExplorerFilters = { platform: def.platform }
  switch (def.scope) {
    case 'SEASONS': return { ...base, eventType: 'seasons' }
    case 'TOURNAMENTS': return { ...base, eventType: 'cups' }
    case 'SPECIFIC_COMPETITION': return { ...base, competitionSeriesId: def.competitionId }
    case 'SPECIFIC_SEASON': return { ...base, seasonId: def.seasonId }
    case 'SPECIFIC_TOURNAMENT': return { ...base, tournamentId: def.tournamentId }
    default: return base
  }
}

/** A stable cache key for a scope, so rules that share one share a query. */
export const scopeKey = (def: AchievementDefinition): string =>
  [def.platform, def.scope, def.competitionId ?? '', def.seasonId ?? '', def.tournamentId ?? '', STAGE_TO_VIEW[def.stage] ?? 'overall'].join('|')

export interface EvaluationContext {
  /** Rankings rows per scope key, loaded once and shared. */
  rows: Map<string, ExplorerRow[]>
  finals: Map<string, FinalsStat>
  /** Identities for manually awarded achievements, by player id. */
  manualPlayers: Map<string, { cueverseId: string | null; preferredName: string }>
}

/**
 * Load everything a set of definitions needs, in as few queries as possible.
 *
 * Deduplicating by scope key is the difference between "dozens of achievements make the homepage
 * slow" and not: in practice almost every rule is all-competitions/all-matches, so the whole page
 * resolves from a single cached aggregate.
 */
export async function buildContext(defs: AchievementDefinition[]): Promise<EvaluationContext> {
  const auto = defs.filter((d) => d.awardType === 'AUTOMATIC')
  const byScope = new Map<string, AchievementDefinition>()
  for (const d of auto) if (!byScope.has(scopeKey(d))) byScope.set(scopeKey(d), d)

  const rows = new Map<string, ExplorerRow[]>()
  await Promise.all([...byScope.entries()].map(async ([key, d]) => {
    const view = STAGE_TO_VIEW[d.stage] ?? 'overall'
    rows.set(key, await computeExplorer('all-time', view, filtersFor(d)))
  }))

  const needsFinals = auto.some((d) => statistic(d.statistic)?.source === 'finals' || d.stage === 'FINALS')
  const platform = auto[0]?.platform ?? 'YAHOO'
  const finals = needsFinals ? await loadFinalsStats(platform) : new Map<string, FinalsStat>()

  /*
   * Manual holders are read through the canonical Player record, not stored on the achievement.
   *
   * Storing the name alongside the id would mean a card still showing an old handle after somebody
   * renamed, which is the exact drift the site-wide identity rule exists to prevent.
   */
  const manualIds = [...new Set(defs
    .filter((d) => d.awardType === 'MANUAL' && d.manualPlayerId)
    .map((d) => d.manualPlayerId as string))]
  const manualPlayers = new Map<string, { cueverseId: string | null; preferredName: string }>()
  if (manualIds.length > 0) {
    const players = await prisma.player.findMany({
      where: { id: { in: manualIds } },
      select: { id: true, cueverseId: true, primaryName: true },
    })
    for (const p of players) manualPlayers.set(p.id, { cueverseId: p.cueverseId, preferredName: p.primaryName })
  }

  return { rows, finals, manualPlayers }
}

function valueOf(def: StatDefinition, row: ExplorerRow, finals: Map<string, FinalsStat>): number | null {
  if (def.source === 'finals') {
    const f = finals.get(row.playerId)
    if (!f) return null
    return def.key === 'finalsWon' ? f.won : def.key === 'finalsLost' ? f.lost : f.reached
  }
  return def.read ? def.read(row) : null
}

/** Whether a row clears every minimum the rule sets. */
function qualifies(d: AchievementDefinition, row: ExplorerRow, finals: Map<string, FinalsStat>): boolean {
  if (d.minMatches != null && row.played < d.minMatches) return false
  if (d.minSeasons != null && row.seasonsPlayed < d.minSeasons) return false
  if (d.minPlayoffMatches != null && (row.playoffWins + row.playoffLosses + row.playoffDraws) < d.minPlayoffMatches) return false
  if (d.minFinals != null && (finals.get(row.playerId)?.reached ?? 0) < d.minFinals) return false
  return true
}

const person = (row: ExplorerRow): AchievementPlayer => ({
  playerId: row.playerId,
  cueverseId: row.cueverseId,
  preferredName: row.preferredName,
  href: row.slug ? `/players/${encodeURIComponent(row.slug)}` : null,
})

/**
 * Evaluate one definition into a renderable card.
 *
 * Returns null only when the rule matches nobody AND the definition asks to be hidden in that case.
 */
export function evaluate(d: AchievementDefinition, ctx: EvaluationContext): Achievement | null {
  const base = {
    id: d.key,
    title: d.title,
    caption: d.flavorText ?? '',
    detail: d.description ?? '',
  }

  if (d.awardType === 'MANUAL') {
    const p = d.manualPlayerId ? ctx.manualPlayers.get(d.manualPlayerId) : null
    return {
      ...base,
      winners: d.manualPlayerId && p
        ? [{
            playerId: d.manualPlayerId,
            cueverseId: p.cueverseId,
            preferredName: p.preferredName,
            href: p.cueverseId ? `/players/${encodeURIComponent(p.cueverseId)}` : null,
          }]
        : [],
      stat: d.manualValue ?? '',
      // A manual award may legitimately name nobody (a site-wide fact), so it never disappears.
      siteWide: !d.manualPlayerId,
      detail: [d.description, d.manualNote].filter(Boolean).join(' '),
    }
  }

  const def = statistic(d.statistic)
  if (!def) return d.emptyBehavior === 'HIDE' ? null : { ...base, winners: [], stat: '', siteWide: true }

  const rows = ctx.rows.get(scopeKey(d)) ?? []
  const scored = rows
    .filter((r) => qualifies(d, r, ctx.finals))
    .map((r) => ({ row: r, value: valueOf(def, r, ctx.finals) }))
    .filter((x): x is { row: ExplorerRow; value: number } => x.value != null)

  if (scored.length === 0) {
    if (d.emptyBehavior === 'HIDE') return null
    return { ...base, winners: [], stat: 'No qualifying player yet', siteWide: true }
  }

  const best = d.winner === 'LOWEST'
    ? Math.min(...scored.map((x) => x.value))
    : Math.max(...scored.map((x) => x.value))
  let tied = scored.filter((x) => x.value === best)

  /*
   * Ties are resolved deterministically or not at all.
   *
   * SHOW_ALL lists everybody level at the top, which is the honest default — a tie is a fact about
   * the archive. SECONDARY_STAT narrows by a second measure, and if that is ALSO level the remaining
   * players are all shown rather than one being picked arbitrarily. Nothing here ever chooses a
   * winner by array order.
   */
  if (tied.length > 1 && d.tiePolicy === 'SECONDARY_STAT') {
    const secondary = statistic(d.tieBreakStat)
    if (secondary) {
      const withSecondary = tied
        .map((x) => ({ ...x, second: valueOf(secondary, x.row, ctx.finals) }))
        .filter((x): x is typeof x & { second: number } => x.second != null)
      if (withSecondary.length > 0) {
        const bestSecond = Math.max(...withSecondary.map((x) => x.second))
        tied = withSecondary.filter((x) => x.second === bestSecond)
      }
    }
  }

  // Stable presentation order for however many are left, so the same data always renders the same.
  tied = [...tied].sort((a, b) =>
    (a.row.cueverseId ?? a.row.preferredName).toLowerCase()
      .localeCompare((b.row.cueverseId ?? b.row.preferredName).toLowerCase()))

  const stat = applyFormat(d.displayFormat, formatValue(best, def))
  const tieNote = tied.length > 1 ? ` · ${tied.length} players tied` : ''

  return {
    ...base,
    winners: tied.map((x) => person(x.row)),
    stat,
    detail: `${d.description ?? ''}${tieNote}`.trim(),
  }
}

/** Evaluate a whole set, sharing one context. Definitions that resolve to nothing are dropped. */
export async function evaluateAll(defs: AchievementDefinition[]): Promise<Achievement[]> {
  const ctx = await buildContext(defs)
  return defs.map((d) => evaluate(d, ctx)).filter((a): a is Achievement => a != null)
}
