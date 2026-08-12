import 'server-only'
import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from './audit'
import { assertCompetitionUnlocked } from './service'

export interface TeamMemberInput {
  playerId?: string | null
  name: string
  handle?: string | null
  captain?: boolean
}

export interface TeamView {
  id: number
  registrationId: number
  name: string
  seed: number | null
  withdrawn: boolean
  placement: number | null
  members: { id: number; playerId: string | null; name: string; handle: string | null; captain: boolean; order: number }[]
}

/** All teams for a team-format cup, ordered by seed then name, with rosters. */
export async function getTeamsForSeason(tournamentId: number): Promise<TeamView[]> {
  const teams = await prisma.tournamentTeam.findMany({
    where: { tournamentId },
    include: { members: { orderBy: { memberOrder: 'asc' } } },
    orderBy: [{ seed: 'asc' }, { name: 'asc' }],
  })
  return teams.map((t) => ({
    id: t.id,
    registrationId: t.registrationId,
    name: t.name,
    seed: t.seed,
    withdrawn: t.withdrawn,
    placement: t.placement,
    members: t.members.map((m) => ({ id: m.id, playerId: m.playerId, name: m.name, handle: m.handle, captain: m.captain, order: m.memberOrder })),
  }))
}

/** Map registrationId -> roster, for rendering team members beneath bracket slots. */
export async function getTeamMembersByRegistration(tournamentId: number): Promise<Map<number, { name: string; handle: string | null; playerId: string | null }[]>> {
  const teams = await prisma.tournamentTeam.findMany({
    where: { tournamentId },
    include: { members: { orderBy: { memberOrder: 'asc' } } },
  })
  const map = new Map<number, { name: string; handle: string | null; playerId: string | null }[]>()
  for (const t of teams) map.set(t.registrationId, t.members.map((m) => ({ name: m.name, handle: m.handle, playerId: m.playerId })))
  return map
}

/** Create a team (its bracket entrant is a Registration; roster added via setTeamMembers). */
export async function createTeam(actor: Actor, tournamentId: number, name: string): Promise<{ ok: boolean; error?: string; teamId?: number }> {
  const clean = name.trim()
  if (!clean) return { ok: false, error: 'A team name is required.' }
  await assertCompetitionUnlocked(prisma, tournamentId)
  const dupe = await prisma.tournamentTeam.findFirst({ where: { tournamentId, name: clean } })
  if (dupe) return { ok: false, error: `A team named "${clean}" already exists in this tournament.` }

  const teamId = await prisma.$transaction(async (tx) => {
    const reg = await tx.registration.create({
      data: { tournamentId, username: clean, displayName: clean, status: 'APPROVED', addedByAdmin: true, approvedAt: new Date() },
    })
    const team = await tx.tournamentTeam.create({ data: { tournamentId, registrationId: reg.id, name: clean } })
    await recordAudit(actor, { action: 'tournament.team.create', entity: 'TournamentTeam', entityId: team.id, newValue: { name: clean, tournamentId } }, tx)
    return team.id
  })
  return { ok: true, teamId }
}

/** Replace a team's roster. Enforces: no duplicate player within the team, one player on
 *  only one active team per cup, and (soft) the tournament's team size as a maximum. */
export async function setTeamMembers(actor: Actor, teamId: number, members: TeamMemberInput[]): Promise<{ ok: boolean; error?: string }> {
  const team = await prisma.tournamentTeam.findUnique({ where: { id: teamId }, include: { tournament: true } })
  if (!team) return { ok: false, error: 'Team not found.' }
  await assertCompetitionUnlocked(prisma, team.tournamentId)

  const cleaned = members.map((m) => ({ ...m, name: m.name.trim() })).filter((m) => m.name)
  if (!cleaned.length) return { ok: false, error: 'A team needs at least one member.' }

  const maxSize = team.tournament.teamSize ?? cleaned.length
  if (cleaned.length > maxSize) return { ok: false, error: `This cup allows at most ${maxSize} members per team.` }

  // No duplicate player within the team (by linked playerId, else by name).
  const seen = new Set<string>()
  for (const m of cleaned) {
    const key = m.playerId ? `id:${m.playerId}` : `name:${m.name.toLowerCase()}`
    if (seen.has(key)) return { ok: false, error: `Duplicate member "${m.name}" on the team.` }
    seen.add(key)
  }

  // One player may be on only one active team per cup — check linked players against
  // OTHER active teams in this competition.
  const linkedIds = cleaned.map((m) => m.playerId).filter((p): p is string => !!p)
  if (linkedIds.length) {
    const conflicts = await prisma.tournamentTeamMember.findMany({
      where: { playerId: { in: linkedIds }, team: { tournamentId: team.tournamentId, withdrawn: false, NOT: { id: teamId } } },
      include: { team: true },
    })
    if (conflicts.length) {
      const c = conflicts[0]
      return { ok: false, error: `${c.name} is already on team "${c.team.name}" in this tournament.` }
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.tournamentTeamMember.deleteMany({ where: { teamId } })
    await tx.tournamentTeamMember.createMany({
      data: cleaned.map((m, i) => ({
        teamId,
        playerId: m.playerId ?? null,
        name: m.name,
        handle: m.handle ?? null,
        memberOrder: i,
        captain: !!m.captain,
      })),
    })
    await tx.tournamentTeam.update({ where: { id: teamId }, data: { updatedAt: new Date() } })
    await recordAudit(actor, { action: 'tournament.team.setMembers', entity: 'TournamentTeam', entityId: teamId, newValue: { members: cleaned.map((m) => m.name) } }, tx)
  })
  return { ok: true }
}

/** Rename a team (also updates the bracket entrant's display name). */
export async function renameTeam(actor: Actor, teamId: number, name: string): Promise<{ ok: boolean; error?: string }> {
  const clean = name.trim()
  if (!clean) return { ok: false, error: 'A team name is required.' }
  const team = await prisma.tournamentTeam.findUnique({ where: { id: teamId } })
  if (!team) return { ok: false, error: 'Team not found.' }
  await assertCompetitionUnlocked(prisma, team.tournamentId)
  const dupe = await prisma.tournamentTeam.findFirst({ where: { tournamentId: team.tournamentId, name: clean, NOT: { id: teamId } } })
  if (dupe) return { ok: false, error: `A team named "${clean}" already exists.` }
  await prisma.$transaction(async (tx) => {
    await tx.tournamentTeam.update({ where: { id: teamId }, data: { name: clean } })
    await tx.registration.update({ where: { id: team.registrationId }, data: { username: clean, displayName: clean } })
    // Keep any already-seeded bracket slots showing the new name.
    await tx.playoffMatch.updateMany({ where: { tournamentId: team.tournamentId, homeRegistrationId: team.registrationId }, data: { homeUsername: clean } })
    await tx.playoffMatch.updateMany({ where: { tournamentId: team.tournamentId, awayRegistrationId: team.registrationId }, data: { awayUsername: clean } })
    await recordAudit(actor, { action: 'tournament.team.rename', entity: 'TournamentTeam', entityId: teamId, oldValue: { name: team.name }, newValue: { name: clean } }, tx)
  })
  return { ok: true }
}

/** Withdraw a team (soft; keeps it for restore). */
export async function withdrawTeam(actor: Actor, teamId: number, reason?: string): Promise<{ ok: boolean; error?: string }> {
  const team = await prisma.tournamentTeam.findUnique({ where: { id: teamId } })
  if (!team) return { ok: false, error: 'Team not found.' }
  await assertCompetitionUnlocked(prisma, team.tournamentId)
  await prisma.$transaction(async (tx) => {
    await tx.tournamentTeam.update({ where: { id: teamId }, data: { withdrawn: true } })
    await tx.registration.update({ where: { id: team.registrationId }, data: { status: 'WITHDRAWN', withdrawnAt: new Date() } })
    await recordAudit(actor, { action: 'tournament.team.withdraw', entity: 'TournamentTeam', entityId: teamId, reason }, tx)
  })
  return { ok: true }
}

export async function restoreTeam(actor: Actor, teamId: number): Promise<{ ok: boolean; error?: string }> {
  const team = await prisma.tournamentTeam.findUnique({ where: { id: teamId } })
  if (!team) return { ok: false, error: 'Team not found.' }
  await assertCompetitionUnlocked(prisma, team.tournamentId)
  await prisma.$transaction(async (tx) => {
    await tx.tournamentTeam.update({ where: { id: teamId }, data: { withdrawn: false } })
    await tx.registration.update({ where: { id: team.registrationId }, data: { status: 'APPROVED', withdrawnAt: null } })
    await recordAudit(actor, { action: 'tournament.team.restore', entity: 'TournamentTeam', entityId: teamId }, tx)
  })
  return { ok: true }
}

/** Delete a team entirely (only when not seeded into a published bracket). */
export async function deleteTeam(actor: Actor, teamId: number): Promise<{ ok: boolean; error?: string }> {
  const team = await prisma.tournamentTeam.findUnique({ where: { id: teamId } })
  if (!team) return { ok: false, error: 'Team not found.' }
  await assertCompetitionUnlocked(prisma, team.tournamentId)
  const inPublishedBracket = await prisma.playoffMatch.count({
    where: { tournamentId: team.tournamentId, published: true, OR: [{ homeRegistrationId: team.registrationId }, { awayRegistrationId: team.registrationId }] },
  })
  if (inPublishedBracket > 0) return { ok: false, error: 'Team is in a published bracket — return the bracket to draft first.' }
  await prisma.$transaction(async (tx) => {
    await tx.tournamentTeam.delete({ where: { id: teamId } }) // members cascade
    await tx.registration.delete({ where: { id: team.registrationId } })
    await recordAudit(actor, { action: 'tournament.team.delete', entity: 'TournamentTeam', entityId: teamId, oldValue: { name: team.name } }, tx)
  })
  return { ok: true }
}
