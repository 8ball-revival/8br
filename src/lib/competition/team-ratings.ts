import 'server-only'
import { prisma } from '@/lib/prisma'
import { resolveIdentity } from '@/lib/stats/identity'
import { getAllTimeRankings } from '@/lib/stats/rankings'
import { tournamentStore, loadTournamentContext } from '@/lib/tournaments/prime'

/**
 * Capture each team member's Ladder rating at registration close and freeze it on the member row
 * (`ratingAtClose`), so the team-details popover shows stable ratings that don't drift while the
 * tournament is underway. IDEMPOTENT — only fills ratings not already captured, so it's safe to call
 * from every close/seed path and never overwrites an earlier snapshot. Rating source = the All-Time
 * Glicko ladder computed from COMPLETED tournaments (so this event's own results never leak in).
 * No-op for individual tournaments (no team members). Unrated players are left null.
 */
export async function captureTeamRatingsAtClose(tournamentId: number): Promise<void> {
  const members = await prisma.tournamentTeamMember.findMany({
    where: { team: { tournamentId }, ratingAtClose: null },
    select: { id: true, name: true, handle: true },
  })
  if (members.length === 0) return

  // Compute the ladder with the snapshot context primed (works from a server action or a script).
  const ctx = await loadTournamentContext()
  const view = tournamentStore.run(ctx, () => getAllTimeRankings())
  const ratingById = new Map<string, number>()
  for (const r of [...view.rows, ...(view.unranked ?? [])]) ratingById.set(r.id, Math.round(r.rating))

  const updates: { id: number; rating: number }[] = []
  for (const m of members) {
    const ident = resolveIdentity(m.handle, m.name, { unknownAsSelf: true })
    const rating = ident ? ratingById.get(ident.id) : undefined
    if (rating != null) updates.push({ id: m.id, rating })
  }
  if (updates.length === 0) return
  await prisma.$transaction(updates.map((u) => prisma.tournamentTeamMember.update({ where: { id: u.id }, data: { ratingAtClose: u.rating } })))
}
