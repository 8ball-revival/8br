import 'server-only'

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'

/**
 * What changing a decided playoff result does to everything after it.
 *
 * ── The mistake this replaces ────────────────────────────────────────────────────────────────────
 * Correcting a winner used to wipe every downstream result. That is safe and much too blunt: in a
 * bracket of thirty-two, fixing a transposed semi-final score erased the Final as well, and the
 * operator had to re-enter results that were never in question.
 *
 * The distinction that matters is whether a downstream match still has the SAME TWO PLAYERS. If it
 * does, the result it recorded is still a real thing that happened between those two people and is
 * kept. If a participant changed, the recorded score belongs to a matchup that no longer exists —
 * and the one thing that must never happen is attributing it to the replacement, who did not play
 * it. Those become Needs Review: the result is cleared, the match is flagged, and a person decides.
 *
 * ── Why Needs Review rather than silent deletion ─────────────────────────────────────────────────
 * Deleting the score is honest but invisible; the operator would find an empty match with no reason
 * attached to it. The flag says why, blocks the Season from being completed, and clears itself the
 * moment a real result is entered.
 */

export interface AffectedMatch {
  matchId: number
  label: string
  homeName: string | null
  awayName: string | null
  /** The score currently recorded, if any. */
  score: string | null
  /** True when both participants survive the correction, so its result is kept. */
  preserved: boolean
  /** True when a participant changes, so the result cannot be attributed and is cleared. */
  needsReview: boolean
  reason: string
}

export interface CorrectionImpact {
  matchId: number
  label: string
  homeName: string | null
  awayName: string | null
  existingScore: string | null
  currentWinnerName: string | null
  proposedScore: string
  proposedWinnerName: string | null
  /** The match this one feeds directly, when it has one. */
  directNext: string | null
  affected: AffectedMatch[]
  preservedCount: number
  reviewCount: number
  /** No recorded winner yet: this is a first entry, not a correction. */
  isFirstResult: boolean
}

type Db = Prisma.TransactionClient | typeof prisma

const scoreText = (h: number | null, a: number | null, forfeit: boolean) =>
  forfeit ? 'FF' : h != null && a != null ? `${h}–${a}` : null

/** Everything reachable downstream of a match, via winner and losers'-bracket edges. */
export async function downstreamOf(
  db: Db,
  seasonId: number,
  origin: { feedsMatchId: number | null; loserFeedsMatchId: number | null },
): Promise<number[]> {
  const all = await db.seasonPlayoffMatch.findMany({
    where: { seasonId }, select: { id: true, feedsMatchId: true, loserFeedsMatchId: true },
  })
  const byId = new Map(all.map((x) => [x.id, x]))
  const seen = new Set<number>()
  const queue = [origin.feedsMatchId, origin.loserFeedsMatchId].filter((x): x is number => x != null)
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    const n = byId.get(id)
    if (n?.feedsMatchId != null) queue.push(n.feedsMatchId)
    if (n?.loserFeedsMatchId != null) queue.push(n.loserFeedsMatchId)
  }
  return [...seen]
}

/**
 * Predict the correction without performing it.
 *
 * Read-only: opening the dialog and cancelling leaves the Season untouched. `proposed` is either a
 * score or a forfeit, matching what the score cell was about to submit.
 */
export async function correctionImpact(
  matchId: number,
  proposed: { kind: 'score'; homeGames: number; awayGames: number } | { kind: 'forfeit'; forfeiter: 'home' | 'away' },
): Promise<CorrectionImpact | { error: string }> {
  const m = await prisma.seasonPlayoffMatch.findUnique({ where: { id: matchId } })
  if (!m) return { error: 'Match not found.' }
  if (m.homeEntrantId == null || m.awayEntrantId == null) return { error: 'Both players must be determined first.' }

  const proposedWinnerId = proposed.kind === 'forfeit'
    ? (proposed.forfeiter === 'home' ? m.awayEntrantId : m.homeEntrantId)
    : (proposed.homeGames > proposed.awayGames ? m.homeEntrantId : m.awayEntrantId)
  const nameOf = (id: number | null) =>
    id == null ? null : id === m.homeEntrantId ? m.homeUsername : id === m.awayEntrantId ? m.awayUsername : null

  const ids = await downstreamOf(prisma, m.seasonId, m)
  const rows = ids.length
    ? await prisma.seasonPlayoffMatch.findMany({ where: { id: { in: ids } }, orderBy: [{ round: 'asc' }, { slot: 'asc' }] })
    : []

  /*
   * Who survives.
   *
   * The correction moves one player out of the chain and another in. A downstream match keeps its
   * result when NEITHER of its participants is the player being displaced — the two who played it
   * are both still there, so what they did still happened.
   */
  const displaced = m.winnerEntrantId != null && m.winnerEntrantId !== proposedWinnerId ? m.winnerEntrantId : null
  const loserDisplaced = m.winnerEntrantId != null && m.winnerEntrantId !== proposedWinnerId
    ? (m.winnerEntrantId === m.homeEntrantId ? m.awayEntrantId : m.homeEntrantId)
    : null

  const affected: AffectedMatch[] = rows.map((d) => {
    const touched =
      (displaced != null && (d.homeEntrantId === displaced || d.awayEntrantId === displaced))
      || (loserDisplaced != null && (d.homeEntrantId === loserDisplaced || d.awayEntrantId === loserDisplaced))
    const hadResult = d.winnerEntrantId != null
    return {
      matchId: d.id,
      label: d.label ?? `Round ${d.round}`,
      homeName: d.homeUsername,
      awayName: d.awayUsername,
      score: scoreText(d.homeGames, d.awayGames, d.forfeitEntrantId != null),
      preserved: !touched,
      needsReview: touched && hadResult,
      reason: !touched
        ? 'Both players are unaffected — this result is kept.'
        : hadResult
          ? 'A player in this match is replaced by the correction, so its score cannot be attributed. It will be cleared and flagged for review.'
          : 'A player in this match is replaced by the correction. Nothing was recorded here, so nothing is lost.',
    }
  })

  const direct = m.feedsMatchId != null
    ? (await prisma.seasonPlayoffMatch.findUnique({ where: { id: m.feedsMatchId }, select: { label: true, round: true } }))
    : null

  return {
    matchId,
    label: m.label ?? `Round ${m.round}`,
    homeName: m.homeUsername,
    awayName: m.awayUsername,
    existingScore: scoreText(m.homeGames, m.awayGames, m.forfeitEntrantId != null),
    currentWinnerName: nameOf(m.winnerEntrantId),
    proposedScore: proposed.kind === 'forfeit'
      ? `FF (${proposed.forfeiter === 'home' ? m.homeUsername : m.awayUsername})`
      : `${proposed.homeGames}–${proposed.awayGames}`,
    proposedWinnerName: nameOf(proposedWinnerId),
    directNext: direct ? (direct.label ?? `Round ${direct.round}`) : null,
    affected,
    preservedCount: affected.filter((a) => a.preserved).length,
    reviewCount: affected.filter((a) => a.needsReview).length,
    isFirstResult: m.winnerEntrantId == null,
  }
}

/** A downstream result, remembered across the rebuild so it can be put back if it still applies. */
export interface DownstreamSnapshot {
  id: number
  homeEntrantId: number | null
  awayEntrantId: number | null
  homeGames: number | null
  awayGames: number | null
  winnerEntrantId: number | null
  forfeitEntrantId: number | null
  status: string
  verification: string
  completedAt: Date | null
}

/**
 * Take the snapshots, then clear the chain.
 *
 * Same clearing as before — the fed slots and the results downstream — but the previous state comes
 * back so `reconcileDownstream` can decide, once the new winner has advanced, which of those results
 * still describe a real matchup.
 */
export async function snapshotAndClearDownstream(
  tx: Prisma.TransactionClient,
  seasonId: number,
  origin: { feedsMatchId: number | null; feedsSlot: number | null; loserFeedsMatchId: number | null; loserFeedsSlot: number | null },
): Promise<DownstreamSnapshot[]> {
  const all = await tx.seasonPlayoffMatch.findMany({ where: { seasonId } })
  const byId = new Map(all.map((x) => [x.id, x]))

  const affected = new Set<number>(await downstreamOf(tx, seasonId, origin))

  // Which incoming slots to blank: every edge emitted by the origin or by an affected match. A slot
  // fed from outside the set holds a player this correction does not touch.
  const clear = new Map<number, Set<number>>()
  const mark = (mid: number | null, slot: number | null) => {
    if (mid == null) return
    if (!clear.has(mid)) clear.set(mid, new Set())
    clear.get(mid)!.add(slot ?? 0)
  }
  mark(origin.feedsMatchId, origin.feedsSlot)
  mark(origin.loserFeedsMatchId, origin.loserFeedsSlot)
  for (const id of affected) {
    const n = byId.get(id)
    if (!n) continue
    mark(n.feedsMatchId, n.feedsSlot)
    mark(n.loserFeedsMatchId, n.loserFeedsSlot)
  }

  const snapshots: DownstreamSnapshot[] = []
  for (const id of affected) {
    const n = byId.get(id)
    if (!n) continue
    snapshots.push({
      id: n.id,
      homeEntrantId: n.homeEntrantId, awayEntrantId: n.awayEntrantId,
      homeGames: n.homeGames, awayGames: n.awayGames,
      winnerEntrantId: n.winnerEntrantId, forfeitEntrantId: n.forfeitEntrantId,
      status: String(n.status), verification: String(n.verification), completedAt: n.completedAt,
    })
    const slots = clear.get(id) ?? new Set<number>()
    await tx.seasonPlayoffMatch.update({
      where: { id },
      data: {
        winnerEntrantId: null, status: 'SCHEDULED', verification: 'UNVERIFIED',
        homeGames: null, awayGames: null, forfeitEntrantId: null, completedAt: null,
        ...(slots.has(0) ? { homeEntrantId: null, homeUsername: null, homeSeed: null } : {}),
        ...(slots.has(1) ? { awayEntrantId: null, awayUsername: null, awaySeed: null } : {}),
      },
    })
  }
  return snapshots
}

/**
 * Put back what still applies, and flag what does not.
 *
 * Runs AFTER the new winner has been advanced, so each downstream match now holds its post-correction
 * participants. Same two players as before, in either arrangement, means the recorded result still
 * describes what happened between them and goes back exactly as it was. A changed participant means
 * the score belongs to a matchup that no longer exists: it stays cleared and the match is flagged,
 * because attributing it to the replacement would be inventing a result.
 */
export async function reconcileDownstream(
  tx: Prisma.TransactionClient,
  snapshots: DownstreamSnapshot[],
): Promise<{ preserved: number; flagged: number }> {
  let preserved = 0
  let flagged = 0

  for (const s of snapshots) {
    if (s.winnerEntrantId == null) continue // nothing was recorded here; nothing to restore or lose
    const now = await tx.seasonPlayoffMatch.findUnique({
      where: { id: s.id },
      select: { homeEntrantId: true, awayEntrantId: true },
    })
    if (!now) continue

    const before = [s.homeEntrantId, s.awayEntrantId].filter((x): x is number => x != null).sort()
    const after = [now.homeEntrantId, now.awayEntrantId].filter((x): x is number => x != null).sort()
    const samePair = before.length === 2 && after.length === 2 && before[0] === after[0] && before[1] === after[1]

    if (samePair) {
      /*
       * Restore, oriented to how the row now holds the two players.
       *
       * The rebuild can seat them on the opposite sides from before, and writing the old home score
       * into the new home column would silently reverse the result.
       */
      const flipped = now.homeEntrantId !== s.homeEntrantId
      await tx.seasonPlayoffMatch.update({
        where: { id: s.id },
        data: {
          homeGames: flipped ? s.awayGames : s.homeGames,
          awayGames: flipped ? s.homeGames : s.awayGames,
          winnerEntrantId: s.winnerEntrantId,
          forfeitEntrantId: s.forfeitEntrantId,
          status: s.status as never,
          verification: s.verification as never,
          completedAt: s.completedAt,
          needsReview: false,
        },
      })
      preserved++
    } else {
      await tx.seasonPlayoffMatch.update({ where: { id: s.id }, data: { needsReview: true } })
      flagged++
    }
  }
  return { preserved, flagged }
}
