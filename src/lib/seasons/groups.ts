import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from '@/lib/competition/audit'
import { roundRobin } from '@/lib/competition/schedule'
import { transitionSeasonState } from './lifecycle'
import { recomputeSeasonStandings } from './group-stage'

/**
 * SEASON GROUP SETUP — the private draft phase between Registration Closed and a live Group Stage.
 *
 * Groups are drafted here and are never visible to members: matches and standings are materialised
 * only on publish, so before that there is nothing for a public page to render even by accident.
 *
 * Distribution follows ENTRY ORDER, not rating. See `generateSeasonGroups` for why — the short
 * version is that this is mostly used to rebuild historical Seasons, where the order the roster is
 * typed in already is the grouping.
 */

export const MIN_GROUP_SIZE = 2

/** A, B, … Z, AA, AB … */
export function groupCode(ordinal: number): string {
  let n = ordinal, s = ''
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1 } while (n >= 0)
  return s
}

async function assertGroupSetupPhase(seasonId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true } })
  if (!s) return { ok: false, error: 'Season not found.' }
  if (s.lifecycleState !== 'REGISTRATION_CLOSED' && s.lifecycleState !== 'GROUP_SETUP') {
    return { ok: false, error: 'Group setup is only available after registration closes and before the group stage goes live.' }
  }
  return { ok: true }
}

/** Generate a fresh draft: RATING-based snake seeding of every approved, non-kicked entrant across
 *  `numGroups` groups (sizes differ by at most one). Replaces any existing draft. */
export async function generateSeasonGroups(actor: Actor, seasonId: number, numGroups: number): Promise<{ ok: boolean; error?: string; uneven?: boolean }> {
  const phase = await assertGroupSetupPhase(seasonId)
  if (!phase.ok) return phase
  const n = Math.trunc(numGroups)
  if (!Number.isFinite(n) || n < 1) return { ok: false, error: 'Choose at least one group.' }

  const entrants = await prisma.seasonEntrant.findMany({
    where: { seasonId, status: 'APPROVED', kickedOut: false },
    // ENTRY ORDER. `id` is an autoincrement, so ascending is the order they were added.
    orderBy: { id: 'asc' },
    select: { id: true },
  })
  if (entrants.length < n * MIN_GROUP_SIZE) {
    return { ok: false, error: `Need at least ${n * MIN_GROUP_SIZE} entrants for ${n} groups of ${MIN_GROUP_SIZE}.` }
  }

  /*
   * Fill Group A, then B, then C — in the order entrants were added.
   *
   * This used to sort by rating and then deal serpentine, which balances group strength and is the
   * right answer for a live Season where nobody has decided who plays whom. It is the wrong answer
   * for rebuilding a historical Season, which is what this is mostly used for: the operator enters
   * the roster group by group, reading off the original page, and then had to drag all forty players
   * back out of the arrangement the balancer invented.
   *
   * Their entry order already IS the grouping. Honouring it turns the whole exercise into one click,
   * and anyone who wants a balanced draw can still move players by hand afterwards.
   *
   * Uneven totals put the extra players in the earliest groups, matching how a roster is written
   * down — A fills before B.
   */
  const total = entrants.length
  const base = Math.floor(total / n)
  const remainder = total % n
  const sizes = Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0))

  await prisma.$transaction(async (tx) => {
    await tx.seasonGroup.deleteMany({ where: { seasonId } }) // cascade clears group players
    const groups: { id: number }[] = []
    for (let i = 0; i < n; i++) {
      groups.push(await tx.seasonGroup.create({
        data: { seasonId, code: groupCode(i), ordinal: i },
        select: { id: true },
      }))
    }

    const plan: { entrantId: number; groupId: number; seed: number }[] = []
    let cursor = 0
    for (let gi = 0; gi < n; gi++) {
      for (let slot = 0; slot < sizes[gi]; slot++) {
        const e = entrants[cursor++]
        // Seed is the position WITHIN the group, so the group table reads in the order entered.
        plan.push({ entrantId: e.id, groupId: groups[gi].id, seed: slot + 1 })
      }
    }

    await tx.seasonGroupPlayer.createMany({ data: plan })
    await recordAudit(actor, {
      action: 'season.groups.generate',
      entity: 'Season',
      entityId: seasonId,
      newValue: { groups: n, entrants: total, order: 'entry' },
    }, tx)
    await tx.season.update({ where: { id: seasonId }, data: { lifecycleState: 'GROUP_SETUP' } })
  })

  const uneven = remainder !== 0
  return { ok: true, uneven }
}

/** Move an entrant to a group (or to Unassigned when toGroupId is null). */
export async function moveSeasonEntrantToGroup(actor: Actor, seasonId: number, entrantId: number, toGroupId: number | null): Promise<{ ok: boolean; error?: string }> {
  const phase = await assertGroupSetupPhase(seasonId)
  if (!phase.ok) return phase
  const ent = await prisma.seasonEntrant.findFirst({ where: { id: entrantId, seasonId }, select: { id: true } })
  if (!ent) return { ok: false, error: 'Entrant not found.' }
  if (toGroupId != null) {
    const g = await prisma.seasonGroup.findFirst({ where: { id: toGroupId, seasonId }, select: { id: true } })
    if (!g) return { ok: false, error: 'Group not found.' }
  }
  await prisma.$transaction(async (tx) => {
    await tx.seasonGroupPlayer.deleteMany({ where: { entrantId, group: { seasonId } } })
    if (toGroupId != null) await tx.seasonGroupPlayer.create({ data: { groupId: toGroupId, entrantId } })
    await recordAudit(actor, { action: 'season.groups.move', entity: 'Season', entityId: seasonId, newValue: { entrantId, toGroupId } }, tx)
  })
  return { ok: true }
}

/**
 * Add one empty group, taking the lowest code not already in use.
 *
 * It used to name the group after the group COUNT, which is right only while nothing has ever been
 * deleted. Delete B from A/B/C and the count is 2, so the next group is named C — a second Group C,
 * sitting alongside the first. Two groups with the same letter cannot be told apart on the board, in
 * the standings, or by the archive matcher that places entrants by group name.
 *
 * Asking which codes are taken costs one query and cannot collide.
 */
export async function addSeasonGroup(actor: Actor, seasonId: number): Promise<{ ok: boolean; error?: string }> {
  const phase = await assertGroupSetupPhase(seasonId)
  if (!phase.ok) return phase
  const existing = await prisma.seasonGroup.findMany({ where: { seasonId }, select: { code: true, ordinal: true } })
  const taken = new Set(existing.map((g) => g.code))
  let i = 0
  while (taken.has(groupCode(i))) i++
  const code = groupCode(i)
  // Ordinal decides display order, and must also not collide with a surviving group's.
  const ordinal = existing.reduce((max, g) => Math.max(max, g.ordinal), -1) + 1
  await prisma.seasonGroup.create({ data: { seasonId, code, ordinal } })
  await recordAudit(actor, { action: 'season.groups.add', entity: 'Season', entityId: seasonId, newValue: { code } })
  return { ok: true }
}

/** Remove a group — its players return to Unassigned; entrants are never deleted. */
export async function removeSeasonGroup(actor: Actor, seasonId: number, groupId: number): Promise<{ ok: boolean; error?: string }> {
  const phase = await assertGroupSetupPhase(seasonId)
  if (!phase.ok) return phase
  const g = await prisma.seasonGroup.findFirst({ where: { id: groupId, seasonId }, select: { id: true } })
  if (!g) return { ok: false, error: 'Group not found.' }
  await prisma.$transaction(async (tx) => {
    await tx.seasonGroup.delete({ where: { id: groupId } }) // cascade removes its group players (→ Unassigned)
    await recordAudit(actor, { action: 'season.groups.remove', entity: 'Season', entityId: seasonId, oldValue: { groupId } }, tx)
  })
  return { ok: true }
}

export async function renameSeasonGroup(actor: Actor, seasonId: number, groupId: number, name: string): Promise<{ ok: boolean; error?: string }> {
  const phase = await assertGroupSetupPhase(seasonId)
  if (!phase.ok) return phase
  const clean = name.trim().slice(0, 40) || null
  await prisma.seasonGroup.update({ where: { id: groupId }, data: { name: clean } })
  await recordAudit(actor, { action: 'season.groups.rename', entity: 'Season', entityId: seasonId, newValue: { groupId, name: clean } })
  return { ok: true }
}

/**
 * Change a group's LETTER.
 *
 * ── Why this is not gated on the setup phase ─────────────────────────────────────────────────────
 * Renaming a group moves no player and changes no result: matches, standings and placements all
 * reference the group by id, so the letter is a label and nothing else. The archive's own letters
 * are sometimes odd — 2006 Season 2 runs A-J then W, X, Y, Z — and the wish to tidy that up arrives
 * long after the groups were closed. Refusing then would mean the label could only ever be fixed
 * during a window that has already passed.
 *
 * ── What IS enforced ─────────────────────────────────────────────────────────────────────────────
 * Uniqueness within the Season. Two groups sharing a letter makes every table ambiguous and every
 * conversation about "group C" a guess.
 */
export async function recodeSeasonGroup(
  actor: Actor,
  seasonId: number,
  groupId: number,
  code: string,
): Promise<{ ok: boolean; error?: string }> {
  const clean = code.trim().toUpperCase().slice(0, 4)
  if (!clean) return { ok: false, error: 'A group needs a name.' }

  const group = await prisma.seasonGroup.findUnique({
    where: { id: groupId }, select: { id: true, code: true, seasonId: true },
  })
  if (!group || group.seasonId !== seasonId) return { ok: false, error: 'That group is not in this Season.' }
  if (group.code === clean) return { ok: true }

  const clash = await prisma.seasonGroup.findFirst({
    where: { seasonId, code: clean, id: { not: groupId } }, select: { id: true },
  })
  if (clash) return { ok: false, error: `Group ${clean} already exists in this Season.` }

  await prisma.$transaction(async (tx) => {
    await tx.seasonGroup.update({ where: { id: groupId }, data: { code: clean } })
    await recordAudit(actor, {
      action: 'season.groups.recode',
      entity: 'Season',
      entityId: seasonId,
      oldValue: { groupId, code: group.code },
      newValue: { groupId, code: clean },
    }, tx)
  })
  return { ok: true }
}

/** Clear every assignment (all entrants back to Unassigned); groups remain. */
export async function resetSeasonGroups(actor: Actor, seasonId: number): Promise<{ ok: boolean; error?: string }> {
  const phase = await assertGroupSetupPhase(seasonId)
  if (!phase.ok) return phase
  await prisma.$transaction(async (tx) => {
    await tx.seasonGroupPlayer.deleteMany({ where: { group: { seasonId } } })
    await recordAudit(actor, { action: 'season.groups.reset', entity: 'Season', entityId: seasonId }, tx)
  })
  return { ok: true }
}

export interface SeasonDraftIssue { code: 'unassigned' | 'too_small' | 'duplicate' | 'no_groups'; detail: string }

export async function validateSeasonGroupDraft(seasonId: number): Promise<{ ok: boolean; issues: SeasonDraftIssue[] }> {
  const groups = await prisma.seasonGroup.findMany({ where: { seasonId }, include: { players: true } })
  const entrants = await prisma.seasonEntrant.findMany({ where: { seasonId, status: 'APPROVED', kickedOut: false }, select: { id: true } })
  const issues: SeasonDraftIssue[] = []
  if (groups.length === 0) issues.push({ code: 'no_groups', detail: 'No groups yet — generate groups first.' })
  const assigned = new Map<number, number>() // entrantId → count
  for (const g of groups) {
    if (g.players.length < MIN_GROUP_SIZE) issues.push({ code: 'too_small', detail: `Group ${g.name || g.code} has ${g.players.length} player(s) (min ${MIN_GROUP_SIZE}).` })
    for (const p of g.players) assigned.set(p.entrantId, (assigned.get(p.entrantId) ?? 0) + 1)
  }
  const unassigned = entrants.filter((e) => !assigned.has(e.id)).length
  if (unassigned > 0) issues.push({ code: 'unassigned', detail: `${unassigned} entrant(s) not assigned to a group.` })
  for (const [, c] of assigned) if (c > 1) { issues.push({ code: 'duplicate', detail: 'An entrant is assigned to more than one group.' }); break }
  return { ok: issues.length === 0, issues }
}

/** Publish the draft: validate, mark groups published, generate the round-robin schedule + empty
 *  standings, and go live — all transactionally. */
export async function publishSeasonGroups(actor: Actor, seasonId: number): Promise<{ ok: boolean; error?: string }> {
  const phase = await assertGroupSetupPhase(seasonId)
  if (!phase.ok) return phase
  const valid = await validateSeasonGroupDraft(seasonId)
  if (!valid.ok) return { ok: false, error: valid.issues.map((i) => i.detail).join(' ') }

  const groups = await prisma.seasonGroup.findMany({ where: { seasonId }, include: { players: { include: { entrant: { select: { id: true, username: true, displayName: true } } } } }, orderBy: { ordinal: 'asc' } })

  await prisma.$transaction(async (tx) => {
    for (const g of groups) {
      const nameOf = new Map(g.players.map((p) => [p.entrantId, p.entrant.displayName?.trim() || p.entrant.username]))
      // Round-robin fixtures over this group's entrants (reuses the pure scheduler; byes dropped).
      const fixtures = roundRobin(g.players.map((p) => ({ registrationId: p.entrantId, username: nameOf.get(p.entrantId) ?? '' })))
      const matchData: Prisma.SeasonMatchCreateManyInput[] = fixtures.map((m) => ({
        seasonId, groupId: g.id, round: m.round,
        homeEntrantId: m.home.registrationId, awayEntrantId: m.away.registrationId,
        homeUsername: m.home.username, awayUsername: m.away.username,
      }))
      if (matchData.length) await tx.seasonMatch.createMany({ data: matchData })
      // Empty standings rows (one per entrant).
      await tx.seasonStanding.createMany({ data: g.players.map((p) => ({ seasonId, groupId: g.id, entrantId: p.entrantId, username: nameOf.get(p.entrantId) ?? '' })) })
      await tx.seasonGroup.update({ where: { id: g.id }, data: { published: true } })
    }
    await recordAudit(actor, { action: 'season.groups.publish', entity: 'Season', entityId: seasonId, newValue: { groups: groups.length } }, tx)
    const t = await transitionSeasonState(actor, seasonId, 'GROUP_STAGE_LIVE', { tx })
    if (!t.ok) throw new Error(t.error)
  })
  await recomputeSeasonStandings(seasonId)
  return { ok: true }
}
