import 'server-only'

import { prisma } from '@/lib/prisma'
import { bracketTopology, slotKey } from './playoff-topology'
import type { ScoringRound, ScoringMatchView } from '@/components/creator/playoff-scoring'

/**
 * The live bracket, shaped for the Creator scoring board.
 *
 * ── Reads, decides nothing ───────────────────────────────────────────────────────────────────────
 * Every field here comes straight off the canonical rows. The one thing it computes is which sides
 * are ENTRY positions, and that comes from the same `bracketTopology` the placement workspace uses —
 * because the board has to tell an empty slot that means "bye" from an empty slot that means "not
 * decided yet", and the round number cannot answer that.
 *
 * It writes nothing, so opening the scoring screen cannot change a Season.
 */

const roundName = (round: number, section: string | null, maxRound: number): string => {
  if (section === 'LB') return `Losers Round ${round - 100}`
  if (section === 'GF') return 'Grand Final'
  const fromEnd = maxRound - round
  if (fromEnd === 0) return 'Final'
  if (fromEnd === 1) return 'Semi-finals'
  if (fromEnd === 2) return 'Quarter-finals'
  return `Round ${round}`
}

export async function playoffScoringRounds(seasonId: number): Promise<ScoringRound[]> {
  const [rows, topo] = await Promise.all([
    prisma.seasonPlayoffMatch.findMany({
      where: { seasonId },
      orderBy: [{ round: 'asc' }, { slot: 'asc' }],
    }),
    bracketTopology(seasonId),
  ])
  if (rows.length === 0) return []

  // Which ties decide each position, so a waiting match can name what it is waiting for.
  const feeders = new Map<number, string[]>()
  for (const m of rows) {
    for (const target of [m.feedsMatchId, m.loserFeedsMatchId]) {
      if (target == null) continue
      const list = feeders.get(target) ?? []
      list.push(m.label ?? `Round ${m.round} match ${m.slot + 1}`)
      feeders.set(target, list)
    }
  }

  // The winners-bracket depth, for naming Final / Semi-finals / Quarter-finals.
  const maxMainRound = rows.filter((m) => m.section == null || m.section === 'WB')
    .reduce((max, m) => Math.max(max, m.round), 1)

  const views: ScoringMatchView[] = rows.map((m) => ({
    id: m.id,
    round: m.round,
    slot: m.slot,
    section: m.section,
    label: m.label,
    home: { entrantId: m.homeEntrantId, name: m.homeUsername, seed: m.homeSeed },
    away: { entrantId: m.awayEntrantId, name: m.awayUsername, seed: m.awaySeed },
    homeGames: m.homeGames,
    awayGames: m.awayGames,
    status: String(m.status),
    winnerEntrantId: m.winnerEntrantId,
    forfeitEntrantId: m.forfeitEntrantId,
    needsReview: m.needsReview,
    updatedAt: m.updatedAt.toISOString(),
    homeIsEntry: topo.entryKeys.has(slotKey(m.id, 'home')),
    awayIsEntry: topo.entryKeys.has(slotKey(m.id, 'away')),
    feederLabels: feeders.get(m.id) ?? [],
  }))

  // Group into columns in bracket order, keeping the losers' bracket after the winners'.
  const groups = new Map<string, ScoringMatchView[]>()
  for (const v of views) {
    const key = `${v.section ?? 'WB'}:${v.round}`
    groups.set(key, [...(groups.get(key) ?? []), v])
  }

  return [...groups.entries()]
    .sort(([, a], [, b]) => {
      const rank = (x: ScoringMatchView) => (x.section === 'LB' ? 1 : x.section === 'GF' ? 2 : 0)
      return rank(a[0]) - rank(b[0]) || a[0].round - b[0].round
    })
    .map(([key, matches]) => ({
      key,
      name: roundName(matches[0].round, matches[0].section, maxMainRound),
      matches: matches.sort((a, b) => a.slot - b.slot),
    }))
}

/** How many results an upstream correction has invalidated. Blocks completion while above zero. */
export async function playoffNeedsReviewCount(seasonId: number): Promise<number> {
  return prisma.seasonPlayoffMatch.count({ where: { seasonId, needsReview: true } })
}

/** Re-exported so a page can type its own props without reaching into the component. */
export type { ScoringMatchView, ScoringRound }
