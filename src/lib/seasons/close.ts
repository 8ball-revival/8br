import 'server-only'
import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from '@/lib/competition/audit'
import { transitionSeasonState } from './lifecycle'
import { seasonChampion } from './playoffs'
import { LEDGER_TX_OPTIONS } from '@/lib/stats/ledger'

export interface SeasonCloseSummary {
  seasonTitle: string
  champion: string | null
  runnerUp: string | null
  finalScore: string | null
  entrants: number
  completedGroupMatches: number
  noContestGroupMatches: number
  forfeits: number
  kickedOut: number
  rankingEligibleMatches: number // genuinely-played matches that will feed the Ladder
  canClose: boolean
}

export async function seasonCloseSummary(seasonId: number): Promise<SeasonCloseSummary | null> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { number: true, competitionYear: true, subtitle: true, competitionSeries: { select: { name: true } } } })
  if (!s) return null
  const champ = await seasonChampion(seasonId)
  const [entrants, completedGroup, noContest, forfeits, kicked, completedPlayoff] = await Promise.all([
    prisma.seasonEntrant.count({ where: { seasonId, status: { in: ['APPROVED', 'KICKED_OUT'] } } }),
    prisma.seasonMatch.count({ where: { seasonId, status: 'COMPLETED' } }),
    prisma.seasonMatch.count({ where: { seasonId, status: 'NO_CONTEST' } }),
    prisma.seasonMatch.count({ where: { seasonId, status: 'FORFEIT' } }),
    prisma.seasonEntrant.count({ where: { seasonId, kickedOut: true } }),
    prisma.seasonPlayoffMatch.count({ where: { seasonId, status: 'COMPLETED', NOT: [{ homeEntrantId: null }, { awayEntrantId: null }] } }),
  ])
  return {
    seasonTitle: `${s.competitionSeries?.name ?? 'Season'} Season ${s.number} · ${s.competitionYear}`,
    champion: champ?.championName ?? null,
    runnerUp: champ?.runnerUpName ?? null,
    finalScore: champ?.finalScore ?? null,
    entrants,
    completedGroupMatches: completedGroup,
    noContestGroupMatches: noContest,
    forfeits,
    kickedOut: kicked,
    rankingEligibleMatches: completedGroup + completedPlayoff, // FF/KO/void/no-contest excluded
    canClose: !!champ,
  }
}

/**
 * Close the Season: declare the champion, lock all data, apply the EXISTING individual ranking
 * formula (only genuinely-played matches; FF/KO/voided/no-contest excluded via the ledger collector),
 * and move the Season into Season Championship History — all transactionally + audited. The glowing
 * diamond Season Championship award is derived from completed Seasons (computeSeasonTrophies), so no
 * separate award row is written here. `ladderAppliedAt` guards idempotency.
 */
/**
 * Whether the Season can be closed, and what closing it would record.
 *
 * ── Read-only, and complete ──────────────────────────────────────────────────────────────────────
 * The button is drawn from this and the confirmation is written from it, so both describe the same
 * decision. It lists every unmet condition rather than the first, because a Season that is not ready
 * usually has one obvious problem and one nobody has noticed.
 */
export interface CompletionReadiness {
  ok: boolean
  problems: string[]
  championName: string | null
  /** The handles, so the confirmation names who is being crowned rather than what they are called. */
  championCueverseId: string | null
  runnerUpName: string | null
  runnerUpCueverseId: string | null
  finalScore: string | null
  /** The Final was a walkover, so the title is awarded without a competitive win. */
  byForfeit: boolean
  needsReview: number
  alreadyCompleted: boolean
}

export async function completionReadiness(seasonId: number): Promise<CompletionReadiness> {
  const season = await prisma.season.findUnique({
    where: { id: seasonId }, select: { lifecycleState: true },
  })
  const problems: string[] = []
  const state = String(season?.lifecycleState ?? '')
  const alreadyCompleted = state === 'COMPLETED'

  if (!season) problems.push('That Season no longer exists.')
  else if (alreadyCompleted) problems.push('This Season is already completed.')
  else if (state !== 'PLAYOFFS_LIVE') problems.push('The playoffs are not live yet.')

  const needsReview = await prisma.seasonPlayoffMatch.count({ where: { seasonId, needsReview: true } })
  if (needsReview > 0) {
    problems.push(
      `${needsReview} playoff match${needsReview === 1 ? '' : 'es'} need${needsReview === 1 ? 's' : ''} review after a correction. `
      + 'Re-enter the result to clear it — the Season cannot be completed while a result is unattributed.',
    )
  }

  const champ = await seasonChampion(seasonId)
  if (!champ) problems.push('The Final has no winner yet.')

  /*
   * Is the Final a walkover?
   *
   * Asked of the canonical Final — highest round, lowest slot — through the same helper completion
   * uses to write the marker, so the confirmation cannot promise one thing and the transaction
   * record another. A forfeited SEMI-final is not this: only the Final decides the marker.
   */
  const { finalsForfeitOf } = await import('@/lib/competition/finals-forfeit')
  const byForfeit = (await finalsForfeitOf(prisma, 'season', seasonId)) === true

  return {
    ok: problems.length === 0,
    problems,
    championName: champ?.championName ?? null,
    championCueverseId: champ?.championCueverseId ?? null,
    runnerUpName: champ?.runnerUpName ?? null,
    runnerUpCueverseId: champ?.runnerUpCueverseId ?? null,
    finalScore: champ?.finalScore ?? null,
    byForfeit,
    needsReview,
    alreadyCompleted,
  }
}

export async function closeSeason(actor: Actor, seasonId: number): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true } })
  if (!s) return { ok: false, error: 'Season not found.' }
  if (s.lifecycleState !== 'PLAYOFFS_LIVE') return { ok: false, error: 'The Season is not in the live playoffs phase.' }
  const champ = await seasonChampion(seasonId)
  if (!champ) return { ok: false, error: 'Close Season is unavailable until the playoff bracket produces one champion.' }
  const champEnt = await prisma.seasonEntrant.findUnique({ where: { id: champ.championId }, select: { playerId: true, cueverseId: true } })

  let refusal: string | null = null
  await prisma.$transaction(async (tx) => {
    /*
     * Re-checked here, holding the transaction.
     *
     * Completion awards a title and rewrites the ranking ledger. Between the confirmation being read
     * and accepted, another administrator can correct a result and leave a match unattributed, so
     * the condition that decides is the one evaluated against the rows being written.
     */
    const stillLive = await tx.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true } })
    if (stillLive?.lifecycleState !== 'PLAYOFFS_LIVE') {
      refusal = 'This Season is no longer in the live playoffs phase.'
      return
    }
    const flagged = await tx.seasonPlayoffMatch.count({ where: { seasonId, needsReview: true } })
    if (flagged > 0) {
      refusal = `${flagged} playoff match${flagged === 1 ? '' : 'es'} still need review. Re-enter the result before completing the Season.`
      return
    }
    await tx.season.update({
      where: { id: seasonId },
      data: { championName: champ.championName, championHandle: champEnt?.cueverseId ?? null, championPlayerId: champEnt?.playerId ?? null, runnerUpName: champ.runnerUpName, finalScore: champ.finalScore, ladderAppliedAt: new Date() },
    })
    /*
     * The Finals-forfeit marker moves with the champion, in the same transaction.
     *
     * It is a stored derivative of the Final, so the only thing keeping it honest is that it is
     * recomputed wherever the Final can change. Completion is one of those places; recompleting
     * after a correction is the same call, so a Final corrected from a walkover to a played result
     * clears the marker without anybody remembering to.
     */
    const { syncFinalsForfeit } = await import('@/lib/competition/finals-forfeit')
    const forfeited = await syncFinalsForfeit(tx, 'season', seasonId)
    await recordAudit(actor, { action: 'season.close', entity: 'Season', entityId: seasonId, newValue: { champion: champ.championName, runnerUp: champ.runnerUpName, finalScore: champ.finalScore, finalsForfeit: forfeited } }, tx)
    const t = await transitionSeasonState(actor, seasonId, 'COMPLETED', { tx })
    if (!t.ok) throw new Error(t.error)
    // Apply rankings through the established pipeline (deterministic full rebuild across all completed comps).
    const { rebuildRatingLedger } = await import('@/lib/stats/ledger')
    await rebuildRatingLedger(tx)
  }, LEDGER_TX_OPTIONS)
  if (refusal) return { ok: false, error: refusal }
  return { ok: true }
}
