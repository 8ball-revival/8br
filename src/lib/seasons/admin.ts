import 'server-only'
import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from '@/lib/competition/audit'

/**
 * Permanently delete a Season. Before Close: any Admin (so a mistakenly-created Season can be remade).
 * After Close: Head Admin only — and the delete transactionally REVERSES the ranking contribution and
 * removes the Season Championship award. Cascade deletes remove all season_* rows and the Season's
 * rating_ledger rows; a completed-Season delete then rebuilds the ledger so downstream ratings unwind.
 * The Season Championship award is derived from completed Seasons, so it disappears automatically.
 */
export async function deleteSeason(actor: Actor, seasonId: number, isHeadAdmin: boolean): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { number: true, competitionYear: true, lifecycleState: true } })
  if (!s) return { ok: false, error: 'Season not found.' }
  const wasCompleted = s.lifecycleState === 'COMPLETED'
  if (wasCompleted && !isHeadAdmin) return { ok: false, error: 'Only the Head Admin may permanently delete a completed Season.' }

  await prisma.$transaction(async (tx) => {
    // Audit BEFORE deletion (the audit log is a separate, immutable table that survives the delete).
    await recordAudit(actor, { action: 'season.delete', entity: 'Season', entityId: seasonId, oldValue: { number: s.number, competitionYear: s.competitionYear, wasCompleted } }, tx)
    await tx.season.delete({ where: { id: seasonId } }) // cascades season_* + rating_ledger(seasonId)
    if (wasCompleted) {
      // Reverse this Season's ranking effect: replay the ledger without it.
      const { rebuildRatingLedger } = await import('@/lib/stats/ledger')
      await rebuildRatingLedger(tx)
    }
  })
  return { ok: true }
}
