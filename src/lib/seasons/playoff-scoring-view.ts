import 'server-only'

import { prisma } from '@/lib/prisma'
import { bracketTopology, slotKey } from './playoff-topology'
import { analyseByes } from './playoffs'
import type { ScoringRound, ScoringMatchView } from '@/components/creator/playoff-scoring'

/**
 * The live bracket, shaped for the Creator scoring board.
 *
 * ── Reads, decides nothing ───────────────────────────────────────────────────────────────────────
 * Every field here comes straight off the canonical rows. The two things it computes are both about
 * empty slots, because the board has to tell an empty slot that means "bye" from one that means "not
 * decided yet", and the round number cannot answer that:
 *
 *   · isEntry — may this position be filled BY HAND? From the same `bracketTopology` the placement
 *     workspace uses, so the board and the workspace never disagree about what is editable.
 *   · isBye — will anything ever ARRIVE here? From the same `analyseByes` the engine settles byes
 *     with, so the board and the bracket never disagree about what is finished.
 *
 * They are not the same question, and treating them as one is what made a double-elimination board
 * sit for ever on "waiting on an earlier match" for a losers-bracket position whose feeders were both
 * byes. Nothing was coming; the board had no way to say so.
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
  const [rows, topo, entrants] = await Promise.all([
    prisma.seasonPlayoffMatch.findMany({
      where: { seasonId },
      orderBy: [{ round: 'asc' }, { slot: 'asc' }],
    }),
    bracketTopology(seasonId),
    /*
     * The handle, which the match rows do not carry.
     *
     * A playoff match stores the username it was seeded with. That is a display name, and on this
     * site a display name is not an identity — there are six players called Chris. The board has to
     * be able to show the CueVerse ID, so it is looked up per entrant here rather than left to the
     * component to go and find.
     */
    prisma.seasonEntrant.findMany({
      where: { seasonId },
      select: { id: true, cueverseId: true, displayName: true, username: true },
    }),
  ])
  if (rows.length === 0) return []

  const identityOf = new Map(entrants.map((e) => [e.id, {
    cueverseId: e.cueverseId,
    preferredName: e.displayName ?? e.username ?? null,
  }]))
  const sideIdentity = (entrantId: number | null, fallback: string | null) =>
    entrantId != null
      ? identityOf.get(entrantId) ?? { cueverseId: null, preferredName: fallback }
      : { cueverseId: null, preferredName: fallback }

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

  // Which empty positions nothing can ever reach -- the engine's own rule, not a second copy of it.
  const byes = analyseByes(rows)

  // The winners-bracket depth, for naming Final / Semi-finals / Quarter-finals.
  const maxMainRound = rows.filter((m) => m.section == null || m.section === 'WB')
    .reduce((max, m) => Math.max(max, m.round), 1)

  const views: ScoringMatchView[] = rows.map((m) => ({
    id: m.id,
    round: m.round,
    slot: m.slot,
    section: m.section,
    label: m.label,
    home: {
      entrantId: m.homeEntrantId, name: m.homeUsername, seed: m.homeSeed,
      ...sideIdentity(m.homeEntrantId, m.homeUsername),
    },
    away: {
      entrantId: m.awayEntrantId, name: m.awayUsername, seed: m.awaySeed,
      ...sideIdentity(m.awayEntrantId, m.awayUsername),
    },
    homeGames: m.homeGames,
    awayGames: m.awayGames,
    status: String(m.status),
    winnerEntrantId: m.winnerEntrantId,
    forfeitEntrantId: m.forfeitEntrantId,
    needsReview: m.needsReview,
    updatedAt: m.updatedAt.toISOString(),
    homeIsEntry: topo.entryKeys.has(slotKey(m.id, 'home')),
    awayIsEntry: topo.entryKeys.has(slotKey(m.id, 'away')),
    homeIsBye: m.homeEntrantId == null && byes.permanentlyEmpty(m.id, 0),
    awayIsBye: m.awayEntrantId == null && byes.permanentlyEmpty(m.id, 1),
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
