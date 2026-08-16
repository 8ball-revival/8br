import 'server-only'
import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from '@/lib/competition/audit'
import { transitionSeasonState } from './lifecycle'
import { seasonChampion } from './playoffs'

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
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { number: true, year: true, subtitle: true } })
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
    seasonTitle: `8BR Season ${s.number} · ${s.year}`,
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
export async function closeSeason(actor: Actor, seasonId: number): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true } })
  if (!s) return { ok: false, error: 'Season not found.' }
  if (s.lifecycleState !== 'PLAYOFFS_LIVE') return { ok: false, error: 'The Season is not in the live playoffs phase.' }
  const champ = await seasonChampion(seasonId)
  if (!champ) return { ok: false, error: 'Close Season is unavailable until the playoff bracket produces one champion.' }
  const champEnt = await prisma.seasonEntrant.findUnique({ where: { id: champ.championId }, select: { playerId: true, cueverseId: true } })

  await prisma.$transaction(async (tx) => {
    await tx.season.update({
      where: { id: seasonId },
      data: { championName: champ.championName, championHandle: champEnt?.cueverseId ?? null, championPlayerId: champEnt?.playerId ?? null, runnerUpName: champ.runnerUpName, finalScore: champ.finalScore, ladderAppliedAt: new Date() },
    })
    await recordAudit(actor, { action: 'season.close', entity: 'Season', entityId: seasonId, newValue: { champion: champ.championName, runnerUp: champ.runnerUpName, finalScore: champ.finalScore } }, tx)
    const t = await transitionSeasonState(actor, seasonId, 'COMPLETED', { tx })
    if (!t.ok) throw new Error(t.error)
    // Apply rankings through the established pipeline (deterministic full rebuild across all completed comps).
    const { rebuildRatingLedger } = await import('@/lib/stats/ledger')
    await rebuildRatingLedger(tx)
  })
  return { ok: true }
}
