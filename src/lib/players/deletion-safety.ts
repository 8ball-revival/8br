import 'server-only'
import { prisma } from '@/lib/prisma'

/**
 * Decides whether an account can be permanently deleted, or must be archived instead.
 *
 * Postgres protects some of this for us — nine tables cascade off `Player` and two RESTRICT — but
 * the dangerous references are the ones with NO foreign key at all. `rating_ledger`,
 * `comp_registration`, `comp_audit_log` and `staff_designation` point at a member by id or handle,
 * so a hard delete would silently orphan them and the database would not object.
 *
 * That is why this checks the soft references explicitly and treats ANY dependent row as
 * disqualifying: archival is always safe, permanent deletion is only offered when there is
 * genuinely nothing to lose.
 */

export interface DependencyCount {
  label: string
  count: number
}

export interface DeletionAssessment {
  /** True only when nothing anywhere references this member. */
  canPermanentlyDelete: boolean
  /** What the confirmation dialog should tell the operator will happen. */
  outcome: 'permanent' | 'archive'
  dependencies: DependencyCount[]
  totalDependencies: number
}

/**
 * @param userId  Payload account id (soft references key off this or the username).
 * @param playerId Linked Player id, when the account has a profile.
 * @param username Login handle, for the audit-log reference check.
 */
export async function assessAccountDeletion(
  userId: number,
  playerId: string | null,
  username: string | null,
): Promise<DeletionAssessment> {
  const deps: DependencyCount[] = []
  const add = (label: string, count: number) => {
    if (count > 0) deps.push({ label, count })
  }

  // ---- soft references (no FK — the whole reason this function exists) ----
  if (playerId) {
    add('Rating ledger entries', await prisma.ratingLedger.count({ where: { playerId } }))
  }
  if (username) {
    add(
      'Competition registrations',
      await prisma.registration.count({ where: { username: { equals: username, mode: 'insensitive' } } }),
    )
    add(
      'Audit log entries',
      await prisma.auditLog.count({ where: { actorUsername: { equals: username, mode: 'insensitive' } } }),
    )
  }
  add('Staff designation', await prisma.staffDesignation.count({ where: { userId } }))

  // ---- foreign-key dependents on the Player profile ----
  if (playerId) {
    const [aliases, achievements, career, seasonStats, hof, competitors, teams, mergesA, mergesB, splitsA, splitsB] =
      await Promise.all([
        prisma.playerAlias.count({ where: { playerId } }),
        prisma.achievement.count({ where: { playerId } }),
        prisma.playerCareerStat.count({ where: { playerId } }),
        prisma.playerSeasonStat.count({ where: { playerId } }),
        prisma.hallOfFameEntry.count({ where: { playerId } }),
        prisma.competitor.count({ where: { playerId } }),
        prisma.teamMembership.count({ where: { playerId } }),
        prisma.playerMerge.count({ where: { canonicalPlayerId: playerId } }),
        prisma.playerMerge.count({ where: { mergedPlayerId: playerId } }),
        prisma.playerSplit.count({ where: { sourcePlayerId: playerId } }),
        prisma.playerSplit.count({ where: { newPlayerId: playerId } }),
      ])
    add('Aliases', aliases)
    add('Achievements', achievements)
    add('Career statistics', career)
    add('Season statistics', seasonStats)
    add('Hall of Fame entries', hof)
    add('Competitor records', competitors)
    add('Team memberships', teams)
    add('Merge records', mergesA + mergesB)
    add('Split records', splitsA + splitsB)
  }

  const totalDependencies = deps.reduce((n, d) => n + d.count, 0)
  return {
    dependencies: deps,
    totalDependencies,
    canPermanentlyDelete: totalDependencies === 0,
    outcome: totalDependencies === 0 ? 'permanent' : 'archive',
  }
}
