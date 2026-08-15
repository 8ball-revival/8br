import 'server-only'
import { prisma } from '@/lib/prisma'
import type { Actor } from './audit'
import { recordAudit } from './audit'
import {
  createGroup,
  deleteGroup,
  generateGroups,
  publishGroups,
  addPlayerToGroup,
  removePlayerFromGroup,
  movePlayer,
  recomputeStandings,
} from './service'
import { transitionTournamentState } from './tournament-lifecycle'

/**
 * GROUP SETUP — the draft phase between "registration closed" and a live Group Stage.
 *
 * After registration closes the Admin opens a private Group Setup board: empty groups + every entrant
 * Unassigned. They Auto-Assign and/or drag entrants, then Publish. Only on publish are round-robin
 * matches + standings generated and the tournament moved to GROUPS_IN_PROGRESS (making the groups
 * public). Nothing here touches result reporting, standings/qualification formulas, or seeding — it
 * reuses the existing group service functions, which already leave the draft unpublished.
 */

/** Minimum entrants for a group to produce a round-robin match. */
export const MIN_GROUP_SIZE = 2

export async function groupsArePublished(tournamentId: number): Promise<boolean> {
  return (await prisma.tournamentGroup.count({ where: { tournamentId, published: true } })) > 0
}

/** Number of round-robin matches for a group of `n` entrants (nC2). */
export function roundRobinMatchCount(n: number): number {
  return n < 2 ? 0 : (n * (n - 1)) / 2
}

/**
 * Enter Group Setup: ensure the configured number of EMPTY draft groups exist, with every entrant
 * left Unassigned. Never auto-assigns (that is an explicit button) and never publishes. Idempotent —
 * re-entering keeps any existing draft.
 */
export async function enterGroupSetup(actor: Actor, tournamentId: number, desiredGroups: number): Promise<{ ok: boolean; error?: string }> {
  if (await groupsArePublished(tournamentId)) return { ok: false, error: 'Groups are already published.' }
  const existing = await prisma.tournamentGroup.count({ where: { tournamentId } })
  const target = Math.max(1, desiredGroups)
  for (let i = existing; i < target; i++) {
    const r = await createGroup(actor, tournamentId)
    if (!r.ok) return r
  }
  await recordAudit(actor, { action: 'groups.setupOpened', entity: 'Tournament', entityId: tournamentId, newValue: { groups: Math.max(existing, target) } })
  return { ok: true }
}

/**
 * Move an entrant to a target group, or to Unassigned (`toGroupId = null`). Draft-only; the underlying
 * service refuses once groups are published unless forced, and we never force here.
 */
export async function moveEntrantToGroup(actor: Actor, tournamentId: number, registrationId: number, toGroupId: number | null): Promise<{ ok: boolean; error?: string }> {
  if (await groupsArePublished(tournamentId)) return { ok: false, error: 'Groups are published — reopen the draft to reorganize.' }
  const current = await prisma.groupPlayer.findFirst({ where: { registrationId, group: { tournamentId } }, select: { groupId: true } })
  if (toGroupId == null) {
    if (!current) return { ok: true } // already unassigned
    return removePlayerFromGroup(actor, tournamentId, current.groupId, registrationId)
  }
  if (!current) return addPlayerToGroup(actor, tournamentId, toGroupId, registrationId)
  if (current.groupId === toGroupId) return { ok: true }
  return movePlayer(actor, tournamentId, registrationId, toGroupId)
}

/** Auto-assign / reset: distribute EVERY entrant across the current number of groups using the existing
 *  seeding + serpentine distribution (even to ±1). Replaces any current draft assignments. */
export async function autoAssignGroups(actor: Actor, tournamentId: number): Promise<{ ok: boolean; error?: string }> {
  if (await groupsArePublished(tournamentId)) return { ok: false, error: 'Groups are published — cannot auto-assign.' }
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { groupCount: true } })
  const existing = await prisma.tournamentGroup.count({ where: { tournamentId } })
  const numGroups = Math.max(1, existing || t?.groupCount || 1)
  return generateGroups(actor, tournamentId, numGroups, undefined, { force: true })
}

/**
 * Auto-balance: even out the CURRENT assignments (and place any Unassigned) so group sizes differ by at
 * most one, preserving as many existing assignments as possible. Draft-only.
 */
export async function autoBalanceGroups(actor: Actor, tournamentId: number): Promise<{ ok: boolean; error?: string }> {
  if (await groupsArePublished(tournamentId)) return { ok: false, error: 'Groups are published — cannot balance.' }
  const groups = await prisma.tournamentGroup.findMany({ where: { tournamentId }, orderBy: { ordinal: 'asc' }, include: { players: { orderBy: { seed: 'desc' } } } })
  if (groups.length === 0) return { ok: false, error: 'Create groups before balancing.' }
  const assigned = new Set(groups.flatMap((g) => g.players.map((p) => p.registrationId)))
  const unassigned = (await prisma.registration.findMany({ where: { tournamentId, status: 'APPROVED' }, select: { id: true } }))
    .map((r) => r.id)
    .filter((id) => !assigned.has(id))

  const total = assigned.size + unassigned.length
  const n = groups.length
  const base = Math.floor(total / n)
  const desired = groups.map((_, i) => base + (i < total % n ? 1 : 0)) // first (total%n) groups get one extra

  // Working sizes + a pool of movable entrants (start with the currently Unassigned).
  const sizes = groups.map((g) => g.players.length)
  const pool: number[] = [...unassigned]
  // Pull surplus off over-target groups (take highest-seed = most-recently-added first).
  for (let i = 0; i < n; i++) {
    while (sizes[i] > desired[i]) {
      // Take a not-yet-pooled entrant from this over-target group (highest seed first).
      const takeable = groups[i].players.map((pl) => pl.registrationId).filter((id) => !pool.includes(id))
      const rid = takeable[takeable.length - 1]
      if (rid == null) break
      const r = await removePlayerFromGroup(actor, tournamentId, groups[i].id, rid)
      if (!r.ok) return r
      pool.push(rid)
      sizes[i]--
    }
  }
  // Fill under-target groups from the pool.
  for (let i = 0; i < n && pool.length > 0; i++) {
    while (sizes[i] < desired[i] && pool.length > 0) {
      const rid = pool.shift()!
      const r = await addPlayerToGroup(actor, tournamentId, groups[i].id, rid)
      if (!r.ok) return r
      sizes[i]++
    }
  }
  await recordAudit(actor, { action: 'groups.autoBalance', entity: 'Tournament', entityId: tournamentId, newValue: { groups: n, total } })
  return { ok: true }
}

/** Remove a draft group — its entrants return to Unassigned (their registrations are never deleted).
 *  Deleting the group cascades its GroupPlayer rows, which is exactly "unassign these entrants". */
export async function removeDraftGroup(actor: Actor, tournamentId: number, groupId: number): Promise<{ ok: boolean; error?: string; returned: number }> {
  if (await groupsArePublished(tournamentId)) return { ok: false, error: 'Groups are published — reopen the draft to remove groups.', returned: 0 }
  const g = await prisma.tournamentGroup.findFirst({ where: { id: groupId, tournamentId }, include: { _count: { select: { players: true } } } })
  if (!g) return { ok: false, error: 'Group not found.', returned: 0 }
  const returned = g._count.players
  await prisma.tournamentGroup.delete({ where: { id: groupId } }) // cascades GroupPlayer → entrants become Unassigned
  await recordAudit(actor, { action: 'groups.removeDraftGroup', entity: 'TournamentGroup', entityId: groupId, oldValue: { name: g.name, returnedToUnassigned: returned } })
  return { ok: true, returned }
}

/** Change the target entrants-per-group by adjusting the NUMBER of groups (never silently drops
 *  entrants: trailing groups are only removed when empty). */
export async function setTargetPerGroup(actor: Actor, tournamentId: number, target: number): Promise<{ ok: boolean; error?: string }> {
  if (await groupsArePublished(tournamentId)) return { ok: false, error: 'Groups are published — cannot resize.' }
  if (!Number.isInteger(target) || target < MIN_GROUP_SIZE) return { ok: false, error: `Target must be at least ${MIN_GROUP_SIZE} per group.` }
  const total = await prisma.registration.count({ where: { tournamentId, status: 'APPROVED' } })
  const desired = Math.max(1, Math.ceil(total / target))
  const groups = await prisma.tournamentGroup.findMany({ where: { tournamentId }, orderBy: { ordinal: 'asc' }, include: { _count: { select: { players: true } } } })
  if (groups.length < desired) {
    for (let i = groups.length; i < desired; i++) {
      const r = await createGroup(actor, tournamentId)
      if (!r.ok) return r
    }
  } else if (groups.length > desired) {
    const removable = groups.slice(desired)
    const nonEmpty = removable.filter((g) => g._count.players > 0)
    if (nonEmpty.length > 0) return { ok: false, error: `Move entrants out of ${nonEmpty.map((g) => g.name).join(', ')} first, or remove those groups manually.` }
    for (const g of removable) {
      const r = await deleteGroup(actor, tournamentId, g.id)
      if (!r.ok) return r
    }
  }
  return { ok: true }
}

export interface GroupDraftIssue { code: 'unassigned' | 'too_small' | 'duplicate' | 'no_groups' | 'stale'; message: string }

/** Validate the current draft against the publish rules. */
export async function validateGroupDraft(tournamentId: number): Promise<{ ok: boolean; issues: GroupDraftIssue[] }> {
  const issues: GroupDraftIssue[] = []
  const groups = await prisma.tournamentGroup.findMany({ where: { tournamentId }, include: { players: true } })
  if (groups.length === 0) issues.push({ code: 'no_groups', message: 'Create at least one group.' })

  // Duplicate assignment (a registration in two groups).
  const seen = new Set<number>()
  for (const g of groups) for (const p of g.players) {
    if (seen.has(p.registrationId)) issues.push({ code: 'duplicate', message: 'An entrant is assigned to more than one group.' })
    seen.add(p.registrationId)
  }

  const approved = await prisma.registration.findMany({ where: { tournamentId, status: 'APPROVED' }, select: { id: true } })
  const approvedIds = new Set(approved.map((r) => r.id))
  const unassigned = approved.filter((r) => !seen.has(r.id))
  if (unassigned.length > 0) issues.push({ code: 'unassigned', message: `${unassigned.length} entrant${unassigned.length === 1 ? '' : 's'} still Unassigned — every active entrant must be in a group.` })

  // Stale: a seeded entrant is no longer an active registration.
  const staleAssigned = [...seen].filter((id) => !approvedIds.has(id))
  if (staleAssigned.length > 0) issues.push({ code: 'stale', message: 'The draft includes an entrant who is no longer registered — remove them and re-check.' })

  const tooSmall = groups.filter((g) => g.players.filter((p) => approvedIds.has(p.registrationId)).length < MIN_GROUP_SIZE)
  if (tooSmall.length > 0) issues.push({ code: 'too_small', message: `Every group needs at least ${MIN_GROUP_SIZE} entrants: ${tooSmall.map((g) => g.name).join(', ')}.` })

  return { ok: issues.length === 0, issues }
}

/**
 * Publish the draft and start the Group Stage — validate, generate matches + standings, make the
 * groups public, and move to GROUPS_IN_PROGRESS. Pre-validated so the transactional publish won't
 * fail midway; audited.
 */
export async function publishGroupsAndStart(actor: Actor, tournamentId: number): Promise<{ ok: boolean; error?: string }> {
  const check = await validateGroupDraft(tournamentId)
  if (!check.ok) return { ok: false, error: check.issues[0]?.message ?? 'The group draft is not ready to publish.' }
  const pub = await publishGroups(actor, tournamentId) // transactional: sets published, generates matches, seeds standings
  if (!pub.ok) return pub
  await recomputeStandings(tournamentId)
  const tr = await transitionTournamentState(actor, tournamentId, 'GROUPS_IN_PROGRESS')
  if (!tr.ok) return { ok: false, error: tr.error }
  await recordAudit(actor, { action: 'groups.publishAndStart', entity: 'Tournament', entityId: tournamentId, newValue: { started: true } })
  return { ok: true }
}
