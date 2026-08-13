import 'server-only'
import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from './audit'
import { requirePickTeamOpen, accountState } from './teams'

/**
 * Free Agents + registration-close allocation for PLAYER-SELECTED (teamFormation = PICK) team
 * tournaments. A Free Agent is a signed-in account registered without a team, allocated at close.
 * The allocation is a PURE, DETERMINISTIC function (safe to preview repeatedly with no reroll) and
 * is applied in a single transaction. Ladder results always belong to the individual players.
 */

export interface PlayerIdentity {
  userId: number
  playerId: string | null
  name: string
  handle: string | null
}

/** Resolve an account's competitive identity from its linked Player profile. */
export async function accountIdentity(userId: number): Promise<PlayerIdentity | null> {
  const p = await prisma.player.findUnique({ where: { linkedUserId: String(userId) }, select: { id: true, primaryName: true, cueverseId: true } })
  if (!p) return null
  return { userId, playerId: p.id, name: p.primaryName, handle: p.cueverseId }
}

// ---- Free-agent registration (player-facing) -------------------------------

/** REGISTER as a Free Agent (no team). Refused if already on a team or already a free agent. */
export async function registerFreeAgent(actor: Actor, tournamentId: number, identity: PlayerIdentity): Promise<{ ok: boolean; error?: string }> {
  const gate = await requirePickTeamOpen(tournamentId)
  if (!gate.ok) return gate
  const { resolveMemberStatus } = await import('@/lib/moderation/service')
  if (!(await resolveMemberStatus(actor.userId)).canRegister) return { ok: false, error: 'This account cannot register.' }
  const st = await accountState(tournamentId, actor.userId)
  if (st) return { ok: false, error: st.kind === 'freeagent' ? 'You are already registered as a free agent.' : `You are already on team "${st.teamName}" in this tournament.` }
  try {
    await prisma.tournamentFreeAgent.create({ data: { tournamentId, userId: actor.userId, playerId: identity.playerId, name: identity.name, handle: identity.handle, status: 'WAITING' } })
  } catch {
    return { ok: false, error: 'You are already registered in this tournament.' } // unique (tournamentId,userId) race
  }
  await recordAudit(actor, { action: 'tournament.freeAgent.register', entity: 'TournamentFreeAgent', entityId: tournamentId, newValue: { player: identity.name } })
  return { ok: true }
}

/** WITHDRAW a Free Agent registration (registration must be OPEN). */
export async function withdrawFreeAgent(actor: Actor, tournamentId: number): Promise<{ ok: boolean; error?: string }> {
  const gate = await requirePickTeamOpen(tournamentId)
  if (!gate.ok) return gate
  const fa = await prisma.tournamentFreeAgent.findFirst({ where: { tournamentId, userId: actor.userId, status: 'WAITING' } })
  if (!fa) return { ok: false, error: 'You are not registered as a free agent.' }
  await prisma.tournamentFreeAgent.delete({ where: { id: fa.id } })
  await recordAudit(actor, { action: 'tournament.freeAgent.withdraw', entity: 'TournamentFreeAgent', entityId: tournamentId, newValue: { player: fa.name } })
  return { ok: true }
}

export interface FreeAgentRow {
  id: number
  userId: number
  name: string
  handle: string | null
  status: 'WAITING' | 'PLACED' | 'NOT_PLACED'
  createdAt: string
}

/** The signed-in account's WAITING free-agent registration, or null. */
export async function getMyFreeAgent(userId: number, tournamentId: number): Promise<FreeAgentRow | null> {
  const fa = await prisma.tournamentFreeAgent.findFirst({ where: { tournamentId, userId, status: 'WAITING' } })
  return fa ? { id: fa.id, userId: fa.userId, name: fa.name, handle: fa.handle, status: fa.status, createdAt: fa.createdAt.toISOString() } : null
}

/** All free agents for a tournament (WAITING by default), earliest-registered first. */
export async function listFreeAgents(tournamentId: number, status: 'WAITING' | 'ALL' = 'WAITING'): Promise<FreeAgentRow[]> {
  const rows = await prisma.tournamentFreeAgent.findMany({
    where: { tournamentId, ...(status === 'WAITING' ? { status: 'WAITING' } : {}) },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  return rows.map((f) => ({ id: f.id, userId: f.userId, name: f.name, handle: f.handle, status: f.status, createdAt: f.createdAt.toISOString() }))
}

// ---- Admin roster management ------------------------------------------------

export interface EligibleAccount { userId: number; playerId: string; name: string; handle: string | null }

/** Active accounts eligible to be ADDED to a team: linked, not banned/deleted, and NOT already
 *  registered anywhere in this tournament (not a team member and not a free agent). */
export async function listEligibleAccounts(tournamentId: number): Promise<EligibleAccount[]> {
  const onTeam = new Set(
    (await prisma.tournamentTeamMember.findMany({ where: { team: { tournamentId, withdrawn: false }, userId: { not: null } }, select: { userId: true } })).map((m) => m.userId!),
  )
  const freeAgents = new Set((await prisma.tournamentFreeAgent.findMany({ where: { tournamentId, status: 'WAITING' }, select: { userId: true } })).map((f) => f.userId))
  const players = await prisma.player.findMany({ where: { active: true, linkedUserId: { not: null } }, orderBy: { primaryName: 'asc' }, select: { id: true, primaryName: true, cueverseId: true, linkedUserId: true } })
  const linkedIds = players.map((p) => Number(p.linkedUserId)).filter(Number.isFinite)
  const blocked = new Set<number>()
  if (linkedIds.length) for (const m of await prisma.memberModeration.findMany({ where: { userId: { in: linkedIds }, status: { in: ['DELETED', 'BANNED'] } }, select: { userId: true } })) blocked.add(m.userId)
  return players
    .map((p) => ({ userId: Number(p.linkedUserId), playerId: p.id, name: p.primaryName, handle: p.cueverseId }))
    .filter((a) => !onTeam.has(a.userId) && !freeAgents.has(a.userId) && !blocked.has(a.userId))
}

/** Admin: create a team and select its players (each must be eligible). First player is the captain. */
export async function adminCreateTeamWithPlayers(actor: Actor, tournamentId: number, teamName: string, memberUserIds: number[]): Promise<{ ok: boolean; error?: string; teamId?: number }> {
  const gate = await requirePickTeamOpen(tournamentId)
  if (!gate.ok) return gate
  const clean = teamName.trim()
  if (!clean) return { ok: false, error: 'Enter a team name.' }
  const active = await prisma.tournamentTeam.findMany({ where: { tournamentId, withdrawn: false }, select: { name: true } })
  if (active.some((t) => t.name.trim().toLowerCase() === clean.toLowerCase())) return { ok: false, error: `A team named "${clean}" already exists.` }
  const ids = [...new Set(memberUserIds)].slice(0, gate.teamSize)
  if (ids.length === 0) return { ok: false, error: 'Select at least one player.' }
  const teamId = await prisma.$transaction(async (tx) => {
    const reg = await tx.registration.create({ data: { tournamentId, userId: ids[0], username: clean, displayName: clean, status: 'APPROVED', approvedAt: new Date(), addedByAdmin: true } })
    const team = await tx.tournamentTeam.create({ data: { tournamentId, registrationId: reg.id, name: clean } })
    let order = 0
    for (const uid of ids) {
      const ident = await accountIdentity(uid)
      if (!ident) throw new Error('INELIGIBLE')
      const conflict = await tx.tournamentTeamMember.findFirst({ where: { userId: uid, team: { tournamentId, withdrawn: false } } })
      const fa = await tx.tournamentFreeAgent.findFirst({ where: { tournamentId, userId: uid, status: 'WAITING' } })
      if (conflict) throw new Error('DUPLICATE')
      if (fa) await tx.tournamentFreeAgent.delete({ where: { id: fa.id } })
      await tx.tournamentTeamMember.create({ data: { teamId: team.id, userId: uid, playerId: ident.playerId, name: ident.name, handle: ident.handle, memberOrder: order, captain: order === 0 } })
      order++
    }
    await recordAudit(actor, { action: 'tournament.team.adminCreate', entity: 'TournamentTeam', entityId: team.id, newValue: { name: clean, players: ids.length } }, tx)
    return team.id
  }).catch((e) => { throw e })
  return { ok: true, teamId }
}

/** Admin: add an eligible account to an open roster slot. */
export async function adminAddMember(actor: Actor, tournamentId: number, teamId: number, userId: number): Promise<{ ok: boolean; error?: string }> {
  const gate = await requirePickTeamOpen(tournamentId)
  if (!gate.ok) return gate
  const team = await prisma.tournamentTeam.findFirst({ where: { id: teamId, tournamentId, withdrawn: false } })
  if (!team) return { ok: false, error: 'Team not found.' }
  if (await accountState(tournamentId, userId)) return { ok: false, error: 'That account is already registered in this tournament.' }
  const ident = await accountIdentity(userId)
  if (!ident) return { ok: false, error: 'That account has no player profile.' }
  try {
    await prisma.$transaction(async (tx) => {
      const count = await tx.tournamentTeamMember.count({ where: { teamId } })
      if (count >= gate.teamSize) throw new Error('FULL')
      const fa = await tx.tournamentFreeAgent.findFirst({ where: { tournamentId, userId, status: 'WAITING' } })
      if (fa) await tx.tournamentFreeAgent.delete({ where: { id: fa.id } })
      await tx.tournamentTeamMember.create({ data: { teamId, userId, playerId: ident.playerId, name: ident.name, handle: ident.handle, memberOrder: count, captain: count === 0 } })
      await recordAudit(actor, { action: 'tournament.team.adminAddMember', entity: 'TournamentTeam', entityId: teamId, newValue: { player: ident.name } }, tx)
    })
  } catch (e) {
    if (e instanceof Error && e.message === 'FULL') return { ok: false, error: 'That team is already full.' }
    throw e
  }
  return { ok: true }
}

/** Admin: remove one player without deleting the team. Promotes a new captain if needed. */
export async function adminRemoveMember(actor: Actor, tournamentId: number, teamId: number, userId: number): Promise<{ ok: boolean; error?: string }> {
  const gate = await requirePickTeamOpen(tournamentId)
  if (!gate.ok) return gate
  const team = await prisma.tournamentTeam.findFirst({ where: { id: teamId, tournamentId, withdrawn: false }, include: { members: { orderBy: { memberOrder: 'asc' } } } })
  if (!team) return { ok: false, error: 'Team not found.' }
  const target = team.members.find((m) => m.userId === userId)
  if (!target) return { ok: false, error: 'That player is not on the team.' }
  await prisma.$transaction(async (tx) => {
    await tx.tournamentTeamMember.delete({ where: { id: target.id } })
    if (target.captain) {
      const next = team.members.find((m) => m.id !== target.id)
      if (next) await tx.tournamentTeamMember.update({ where: { id: next.id }, data: { captain: true } })
    }
    await recordAudit(actor, { action: 'tournament.team.adminRemoveMember', entity: 'TournamentTeam', entityId: teamId, newValue: { removed: target.name } }, tx)
  })
  return { ok: true }
}

/** Admin: replace a roster member with another eligible account (keeps captaincy + slot). */
export async function adminReplaceMember(actor: Actor, tournamentId: number, teamId: number, oldUserId: number, newUserId: number): Promise<{ ok: boolean; error?: string }> {
  const gate = await requirePickTeamOpen(tournamentId)
  if (!gate.ok) return gate
  if (oldUserId === newUserId) return { ok: false, error: 'Pick a different replacement.' }
  const team = await prisma.tournamentTeam.findFirst({ where: { id: teamId, tournamentId, withdrawn: false }, include: { members: true } })
  if (!team) return { ok: false, error: 'Team not found.' }
  const target = team.members.find((m) => m.userId === oldUserId)
  if (!target) return { ok: false, error: 'That player is not on the team.' }
  if (await accountState(tournamentId, newUserId)) return { ok: false, error: 'The replacement is already registered in this tournament.' }
  const ident = await accountIdentity(newUserId)
  if (!ident) return { ok: false, error: 'The replacement account has no player profile.' }
  await prisma.$transaction(async (tx) => {
    const fa = await tx.tournamentFreeAgent.findFirst({ where: { tournamentId, userId: newUserId, status: 'WAITING' } })
    if (fa) await tx.tournamentFreeAgent.delete({ where: { id: fa.id } })
    await tx.tournamentTeamMember.update({ where: { id: target.id }, data: { userId: newUserId, playerId: ident.playerId, name: ident.name, handle: ident.handle } })
    await recordAudit(actor, { action: 'tournament.team.adminReplaceMember', entity: 'TournamentTeam', entityId: teamId, newValue: { out: target.name, in: ident.name } }, tx)
  })
  return { ok: true }
}

// ---- Registration-close allocation (deterministic + previewable) ------------

export interface ClosingPlan {
  teamSize: number
  completeExisting: number // teams already at capacity
  fills: { teamId: number; teamName: string; deficit: number; assigned: { userId: number; name: string; handle: string | null }[] }[]
  newTeams: { name: string; captainUserId: number; members: { userId: number; name: string; handle: string | null }[] }[]
  stillIncomplete: { teamId: number; teamName: string; size: number; needed: number }[]
  unplaced: { userId: number; name: string; handle: string | null }[]
  finalTeams: number
  finalPlayers: number
}

/**
 * Compute the registration-close plan — PURE (no writes), DETERMINISTIC (ordered by createdAt/id),
 * so it can be previewed and re-previewed without ever rerolling. Free agents fill incomplete teams
 * first (cheapest deficits first → most completions; earlier-created teams break ties), then form
 * new full teams (earliest-registered agents; earliest agent is captain); leftover agents are unplaced.
 */
export async function computeClosingPlan(tournamentId: number): Promise<{ ok: boolean; error?: string; plan?: ClosingPlan }> {
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { participantFormat: true, teamFormation: true, teamSize: true } })
  if (!t || t.participantFormat !== 'TEAM' || t.teamFormation !== 'PICK') return { ok: false, error: 'This is not a player-selected team tournament.' }
  const teamSize = t.teamSize ?? 2

  const teams = await prisma.tournamentTeam.findMany({ where: { tournamentId, withdrawn: false }, include: { members: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
  const agents = await prisma.tournamentFreeAgent.findMany({ where: { tournamentId, status: 'WAITING' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
  const pool = agents.map((a) => ({ userId: a.userId, name: a.name, handle: a.handle }))

  const completeExisting = teams.filter((tm) => tm.members.length >= teamSize).length
  const incomplete = teams.filter((tm) => tm.members.length < teamSize)
  // Fill cheapest-deficit first (maximizes completions); earlier-created breaks ties.
  const byFillPriority = [...incomplete].sort((a, b) => (teamSize - a.members.length) - (teamSize - b.members.length) || a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id)

  const fills: ClosingPlan['fills'] = []
  const stillIncomplete: ClosingPlan['stillIncomplete'] = []
  let cursor = 0
  for (const tm of byFillPriority) {
    const deficit = teamSize - tm.members.length
    if (pool.length - cursor >= deficit) {
      const assigned = pool.slice(cursor, cursor + deficit)
      cursor += deficit
      fills.push({ teamId: tm.id, teamName: tm.name, deficit, assigned })
    } else {
      stillIncomplete.push({ teamId: tm.id, teamName: tm.name, size: tm.members.length, needed: teamSize })
    }
  }

  // Remaining agents → new full teams (earliest-registered; earliest is captain).
  const remaining = pool.slice(cursor)
  const existingNames = new Set(teams.map((tm) => tm.name.trim().toLowerCase()))
  const newTeams: ClosingPlan['newTeams'] = []
  let n = 1
  let idx = 0
  while (remaining.length - idx >= teamSize) {
    const members = remaining.slice(idx, idx + teamSize)
    idx += teamSize
    let name = `Free Agent Team ${n}`
    while (existingNames.has(name.trim().toLowerCase())) { n++; name = `Free Agent Team ${n}` }
    existingNames.add(name.trim().toLowerCase())
    n++
    newTeams.push({ name, captainUserId: members[0].userId, members })
  }
  const unplaced = remaining.slice(idx)

  const finalTeams = completeExisting + fills.length + newTeams.length
  return { ok: true, plan: { teamSize, completeExisting, fills, newTeams, stillIncomplete, unplaced, finalTeams, finalPlayers: finalTeams * teamSize } }
}

/**
 * APPLY the close plan in ONE transaction: fill incomplete teams, create the new free-agent teams,
 * withdraw teams that still can't reach capacity, mark every free agent PLACED / NOT_PLACED (never
 * deleted), then transition to REGISTRATION_CLOSED (rosters locked). Idempotent: a no-op if the
 * tournament is no longer accepting registrations. The plan is RE-COMPUTED here from live data, so a
 * stale browser preview cannot double-register anyone.
 */
export async function applyClosingPlan(actor: Actor, tournamentId: number): Promise<{ ok: boolean; error?: string; plan?: ClosingPlan }> {
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { registrationStatus: true, participantFormat: true, teamFormation: true, teamSize: true } })
  if (!t) return { ok: false, error: 'Tournament not found.' }
  if (t.registrationStatus !== 'OPEN') return { ok: false, error: 'Registration is already closed.' }
  const computed = await computeClosingPlan(tournamentId)
  if (!computed.ok || !computed.plan) return { ok: false, error: computed.error }
  const plan = computed.plan

  await prisma.$transaction(async (tx) => {
    // Re-check inside the transaction (concurrent close guard).
    const fresh = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId }, select: { registrationStatus: true } })
    if (fresh.registrationStatus !== 'OPEN') throw new Error('ALREADY_CLOSED')
    const placed = new Map<number, number>() // userId -> teamId

    // 1) Fill incomplete existing teams.
    for (const fill of plan.fills) {
      let order = await tx.tournamentTeamMember.count({ where: { teamId: fill.teamId } })
      for (const a of fill.assigned) {
        const ident = await accountIdentity(a.userId)
        await tx.tournamentTeamMember.create({ data: { teamId: fill.teamId, userId: a.userId, playerId: ident?.playerId ?? null, name: a.name, handle: a.handle, memberOrder: order++, captain: false } })
        placed.set(a.userId, fill.teamId)
      }
    }

    // 2) Create new free-agent teams.
    for (const nt of plan.newTeams) {
      const reg = await tx.registration.create({ data: { tournamentId, userId: nt.captainUserId, username: nt.name, displayName: nt.name, status: 'APPROVED', approvedAt: new Date(), addedByAdmin: true } })
      const team = await tx.tournamentTeam.create({ data: { tournamentId, registrationId: reg.id, name: nt.name } })
      let order = 0
      for (const m of nt.members) {
        const ident = await accountIdentity(m.userId)
        await tx.tournamentTeamMember.create({ data: { teamId: team.id, userId: m.userId, playerId: ident?.playerId ?? null, name: m.name, handle: m.handle, memberOrder: order, captain: order === 0 } })
        placed.set(m.userId, team.id)
        order++
      }
    }

    // 3) Mark free agents PLACED / NOT_PLACED (retain all rows for history).
    const waiting = await tx.tournamentFreeAgent.findMany({ where: { tournamentId, status: 'WAITING' } })
    for (const fa of waiting) {
      const teamId = placed.get(fa.userId)
      if (teamId != null) await tx.tournamentFreeAgent.update({ where: { id: fa.id }, data: { status: 'PLACED', placedTeamId: teamId } })
      else await tx.tournamentFreeAgent.update({ where: { id: fa.id }, data: { status: 'NOT_PLACED' } })
    }

    // 4) Withdraw teams that still can't reach capacity (their members cannot compete).
    for (const s of plan.stillIncomplete) {
      const tm = await tx.tournamentTeam.findUnique({ where: { id: s.teamId }, include: { _count: { select: { members: true } } } })
      if (tm && tm._count.members < plan.teamSize) {
        await tx.tournamentTeam.update({ where: { id: s.teamId }, data: { withdrawn: true } })
        await tx.registration.update({ where: { id: tm.registrationId }, data: { status: 'WITHDRAWN', withdrawnAt: new Date(), note: 'Incomplete roster at registration close.' } })
      }
    }

    // 5) Close registration (lock rosters).
    await tx.tournament.update({ where: { id: tournamentId }, data: { registrationStatus: 'CLOSED', lifecycleState: 'REGISTRATION_CLOSED', status: 'UPCOMING' } })
    await recordAudit(actor, { action: 'tournament.registration.closeWithAllocation', entity: 'Tournament', entityId: tournamentId, newValue: { filled: plan.fills.length, newTeams: plan.newTeams.length, notPlaced: plan.unplaced.length, finalTeams: plan.finalTeams } }, tx)
  }).catch((e) => { if (!(e instanceof Error && e.message === 'ALREADY_CLOSED')) throw e })

  // Freeze each member's Ladder rating now that rosters are final (for the team-details popover).
  const { captureTeamRatingsAtClose } = await import('./team-ratings')
  await captureTeamRatingsAtClose(tournamentId)

  return { ok: true, plan }
}
