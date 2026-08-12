import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from './audit'

/**
 * SHARED registration-cleanup service — the single, safe path for removing a member's
 * ACTIVE participation when they are timed out, banned, deleted, or restored.
 *
 * Safety guarantees (per the moderation architecture):
 *  - Completed competitions are NEVER touched (results/standings/brackets are immutable
 *    history). Only ACTIVE participation in non-completed competitions is withdrawn.
 *  - Nothing is structurally deleted. Registrations are marked WITHDRAWN (status +
 *    withdrawnAt), so published brackets/groups keep referencing the row and are not
 *    corrupted — the entrant simply reads as withdrawn.
 *  - Every withdrawal is audited.
 *
 * Scope: a member's registrations reachable by their account id (Registration.userId) OR
 * their linked canonical profile (Registration.playerId) — both are cleaned so an adopted,
 * profile-backed entry is not left active.
 */

/** Ids of competitions that are COMPLETED (tournament done or cup marked completed). */
async function completedCompetitionIds(client: Prisma.TransactionClient): Promise<Set<number>> {
  const done = await client.tournament.findMany({
    where: { OR: [{ seasonStatus: 'COMPLETED' }, { cupStatus: 'completed' }] },
    select: { id: true },
  })
  return new Set(done.map((s) => s.id))
}

export interface CleanupResult {
  ok: boolean
  withdrawn: number
  skippedCompleted: number
}

/**
 * Withdraw every ACTIVE (PENDING/APPROVED) registration for a member that belongs to a
 * NON-completed competition. Idempotent and safe to call repeatedly.
 */
export async function cleanupActiveRegistrations(
  actor: Actor,
  userId: number,
  reason: string,
): Promise<CleanupResult> {
  return prisma.$transaction(async (tx) => {
    // Resolve the member's linked canonical profile (if any) so profile-backed entries count too.
    const profile = await tx.player.findUnique({ where: { linkedUserId: String(userId) }, select: { id: true } })
    const or: { userId?: number; playerId?: string }[] = [{ userId }]
    if (profile) or.push({ playerId: profile.id })

    const regs = await tx.registration.findMany({
      where: { OR: or, status: { in: ['PENDING', 'APPROVED'] } },
      select: { id: true, tournamentId: true, status: true, username: true },
    })
    if (regs.length === 0) return { ok: true, withdrawn: 0, skippedCompleted: 0 }

    const completed = await completedCompetitionIds(tx)
    let withdrawn = 0
    let skippedCompleted = 0
    for (const r of regs) {
      if (completed.has(r.tournamentId)) {
        skippedCompleted++ // completed competition — leave the historical entry intact
        continue
      }
      await tx.registration.update({
        where: { id: r.id },
        data: { status: 'WITHDRAWN', withdrawnAt: new Date() },
      })
      await recordAudit(
        actor,
        {
          action: 'registration.cleanup.withdraw',
          entity: 'Registration',
          entityId: r.id,
          oldValue: { status: r.status },
          newValue: { status: 'WITHDRAWN' },
          reason,
        },
        tx,
      )
      withdrawn++
    }
    return { ok: true, withdrawn, skippedCompleted }
  })
}
