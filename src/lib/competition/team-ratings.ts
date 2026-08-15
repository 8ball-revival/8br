import 'server-only'
import { prisma } from '@/lib/prisma'
import { ELO_START } from '@/lib/stats/elo'

/**
 * Capture each team member's Rating at registration close and freeze it on the member row
 * (`ratingAtClose`), so the team-details popover shows stable ratings that don't drift while the
 * tournament is underway. IDEMPOTENT — only fills ratings not already captured. Rating source = the
 * player's current all-time Elo from the rating ledger (this event's own results are not yet in the
 * ledger at close time, so they never leak in). Players with no history use the 1500 baseline.
 */
export async function captureTeamRatingsAtClose(tournamentId: number): Promise<void> {
  const members = await prisma.tournamentTeamMember.findMany({
    where: { team: { tournamentId }, ratingAtClose: null },
    select: { id: true, playerId: true },
  })
  if (members.length === 0) return

  const playerIds = [...new Set(members.map((m) => m.playerId).filter((p): p is string => !!p))]
  const ratingById = new Map<string, number>()
  if (playerIds.length) {
    // Latest post-rating per player (their current all-time Elo).
    const latest = await prisma.ratingLedger.findMany({
      where: { playerId: { in: playerIds } },
      orderBy: { sequence: 'desc' },
      select: { playerId: true, postRating: true },
    })
    for (const r of latest) if (!ratingById.has(r.playerId)) ratingById.set(r.playerId, r.postRating)
  }

  const updates = members.map((m) => ({ id: m.id, rating: m.playerId ? ratingById.get(m.playerId) ?? ELO_START : ELO_START }))
  // Interactive form (not the array/batch form): the app's Prisma proxy returns plain Promises, so
  // `$transaction([...])` rejects with "elements must be Prisma Client promises". See lib/prisma.ts.
  await prisma.$transaction(async (tx) => {
    for (const u of updates) await tx.tournamentTeamMember.update({ where: { id: u.id }, data: { ratingAtClose: u.rating } })
  })
}
