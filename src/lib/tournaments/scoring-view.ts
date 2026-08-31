import 'server-only'

import { prisma } from '@/lib/prisma'
import { analyseByes } from '@/lib/seasons/playoffs'
import { resolveEntrants } from '@/lib/competition/entrants'
import { tournamentTopology } from './bracket-topology'
import type { ScoringRound, ScoringMatchView } from '@/components/creator/playoff-scoring'

/**
 * A Tournament's live bracket, shaped for the Creator scoring board.
 *
 * ── The Season's counterpart, over the other table ──────────────────────────────────────────────
 * Same board, same shape, same two computed answers about empty positions — read from
 * `PlayoffMatch` instead of `SeasonPlayoffMatch`, whose columns say `registrationId` where the
 * Season's say `entrantId`.
 *
 * The two computed things are both about emptiness, because the board has to tell a slot that means
 * "bye" from one that means "not decided yet", and the round number cannot answer that:
 *
 *   · isEntry — may this position be filled BY HAND? From the same `tournamentTopology` the setup
 *     screen uses, so the board and the setup screen never disagree about what is editable.
 *   · isBye — will anything ever ARRIVE here? From `analyseByes`, the engine's own rule, so the
 *     board and the bracket never disagree about what is finished.
 *
 * `analyseByes` is the Season's, deliberately: it is a statement about a graph of feeds, not about
 * Seasons, and a second copy would be a second chance to answer "is anything coming" differently.
 *
 * It writes nothing, so opening the scoring screen cannot change a Tournament.
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

export async function tournamentScoringRounds(tournamentId: number): Promise<ScoringRound[]> {
  const rows = await prisma.playoffMatch.findMany({
    where: { tournamentId },
    orderBy: [{ round: 'asc' }, { slot: 'asc' }],
  })
  if (rows.length === 0) return []

  // The identity behind each seat. A seeded username is not an identity: six players are called Chris.
  const regs = await prisma.registration.findMany({
    where: { tournamentId },
    select: { id: true, username: true, displayName: true, cueverseId: true, discord: true, playerId: true },
  })
  const idn = await resolveEntrants(regs)
  const identityOf = new Map(
    regs.map((r) => [r.id, {
      cueverseId: idn.get(r.id)?.cueverseId ?? r.cueverseId ?? null,
      preferredName: idn.get(r.id)?.displayName ?? r.username,
    }]),
  )
  const sideIdentity = (registrationId: number | null, fallback: string | null) =>
    registrationId != null
      ? identityOf.get(registrationId) ?? { cueverseId: null, preferredName: fallback }
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

  const topo = tournamentTopology(rows as never)

  /*
    The engine's bye rule, over rows renamed to the shape it takes.

    `analyseByes` asks "can anything ever reach this slot" by walking the feed graph, which is the
    same graph in both records — only the column names differ.
  */
  const byes = analyseByes(rows.map((m) => ({
    id: m.id,
    homeEntrantId: m.homeRegistrationId,
    awayEntrantId: m.awayRegistrationId,
    winnerEntrantId: m.winnerRegistrationId,
    feedsMatchId: m.feedsMatchId,
    feedsSlot: m.feedsSlot,
    loserFeedsMatchId: m.loserFeedsMatchId,
    loserFeedsSlot: m.loserFeedsSlot,
  })))

  // The winners-bracket depth, for naming Final / Semi-finals / Quarter-finals.
  const maxMainRound = rows.filter((m) => m.section == null || m.section === 'WB')
    .reduce((max, m) => Math.max(max, m.round), 1)

  const views: ScoringMatchView[] = rows.map((m) => ({
    id: m.id,
    round: m.round,
    slot: m.slot,
    section: m.section ?? null,
    label: m.label,
    home: {
      entrantId: m.homeRegistrationId, name: m.homeUsername, seed: m.homeSeed,
      ...sideIdentity(m.homeRegistrationId, m.homeUsername),
    },
    away: {
      entrantId: m.awayRegistrationId, name: m.awayUsername, seed: m.awaySeed,
      ...sideIdentity(m.awayRegistrationId, m.awayUsername),
    },
    homeGames: m.homeGames,
    awayGames: m.awayGames,
    status: String(m.status),
    winnerEntrantId: m.winnerRegistrationId,
    forfeitEntrantId: m.forfeitRegistrationId,
    /*
      Always false: a Tournament has no needs-review column.

      A Season marks results that an upstream correction invalidated, and blocks completion while
      any remain. A Tournament re-advances the winner directly instead, so nothing is ever left in
      that state — not a value that could not be read, but a concept the record does not have.
    */
    needsReview: false,
    updatedAt: m.updatedAt.toISOString(),
    homeIsEntry: topo.entryKeys.has(`${m.id}:home`),
    awayIsEntry: topo.entryKeys.has(`${m.id}:away`),
    homeIsBye: m.homeRegistrationId == null && byes.permanentlyEmpty(m.id, 0),
    awayIsBye: m.awayRegistrationId == null && byes.permanentlyEmpty(m.id, 1),
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
