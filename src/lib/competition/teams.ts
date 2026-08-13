import 'server-only'
import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from './audit'
import { assertCompetitionUnlocked } from './service'
import { hashSecret, verifySecret } from './secret-hash'

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
  members: { id: number; userId: number | null; playerId: string | null; name: string; handle: string | null; captain: boolean; order: number }[]
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
    members: t.members.map((m) => ({ id: m.id, userId: m.userId, playerId: m.playerId, name: m.name, handle: m.handle, captain: m.captain, order: m.memberOrder })),
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

// ---------------------------------------------------------------------------
// Member team registration — create-then-join (teamFormation = PICK)
// ---------------------------------------------------------------------------
//
// A signed-in player either STARTS a new team (becoming captain + first member) or JOINS an
// existing team (open, or protected by an optional per-team join code). Identity always comes from
// the signed-in account's profile — never typed on the form, and a player can never register anyone
// but themselves. One account = one team per tournament. Rosters lock when registration closes.

/** A signed-in player's identity, resolved from their linked profile (NEVER taken from the form). */
export interface PlayerIdentity {
  userId: number
  playerId: string | null
  name: string
  handle: string | null // CueVerse ID
}

/** A team a player may join (for the "Join Existing Team" dropdown). */
export interface JoinableTeam {
  teamId: number
  name: string
  size: number // current roster count
  capacity: number // team size
  full: boolean
  protected: boolean // has a join code
}

export interface MyTeamMembership {
  teamId: number
  name: string
  capacity: number
  spaces: number
  isCaptain: boolean
  protected: boolean
  complete: boolean // roster is full → eligible to compete
  members: { userId: number | null; name: string; handle: string | null; captain: boolean }[]
}

const nameKey = (s: string) => s.trim().toLowerCase()

/** A signed-in account holds at most ONE registration state per tournament: on a team (captain or
 *  member) OR a free agent OR nothing. This is the single source of truth for that check. */
export type RegState =
  | { kind: 'captain' | 'member'; teamId: number; teamName: string }
  | { kind: 'freeagent'; freeAgentId: number }
  | null

export async function accountState(tournamentId: number, userId: number): Promise<RegState> {
  const m = await prisma.tournamentTeamMember.findFirst({ where: { userId, team: { tournamentId, withdrawn: false } }, include: { team: true } })
  if (m?.team) return { kind: m.captain ? 'captain' : 'member', teamId: m.team.id, teamName: m.team.name }
  const fa = await prisma.tournamentFreeAgent.findFirst({ where: { tournamentId, userId, status: 'WAITING' } })
  if (fa) return { kind: 'freeagent', freeAgentId: fa.id }
  return null
}

/** Gate: a PICK team tournament with registration still OPEN (rosters unlocked). */
export async function requirePickTeamOpen(tournamentId: number): Promise<{ ok: true; teamSize: number } | { ok: false; error: string }> {
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId } })
  if (!t) return { ok: false, error: 'Tournament not found.' }
  if (t.participantFormat !== 'TEAM') return { ok: false, error: 'This tournament is not a team event.' }
  if (t.teamFormation !== 'PICK') return { ok: false, error: 'This tournament forms teams by random draw — register as an individual instead.' }
  if (t.registrationStatus !== 'OPEN') return { ok: false, error: 'Registration is closed — rosters are locked.' }
  await assertCompetitionUnlocked(prisma, tournamentId)
  return { ok: true, teamSize: t.teamSize ?? 2 }
}

async function canRegister(userId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const { resolveMemberStatus } = await import('@/lib/moderation/service')
  const s = await resolveMemberStatus(userId)
  if (s.canRegister) return { ok: true }
  return { ok: false, error: s.status === 'BANNED' ? 'This account is banned and cannot register.' : s.status === 'TIMED_OUT' ? 'This account is timed out and cannot register.' : 'This account cannot register.' }
}

function validateJoinCode(code: string): string | null {
  if (code && (code.length < 3 || code.length > 40)) return 'The team join code must be 3–40 characters.'
  return null
}

/** START a new team: the signed-in player becomes captain + first roster member. Optional join code. */
export async function startTeam(actor: Actor, tournamentId: number, teamName: string, captain: PlayerIdentity, joinCode: string | null): Promise<{ ok: boolean; error?: string; teamId?: number }> {
  const gate = await requirePickTeamOpen(tournamentId)
  if (!gate.ok) return gate
  const clean = teamName.trim()
  if (!clean) return { ok: false, error: 'Enter a team name.' }
  if (clean.length > 60) return { ok: false, error: 'Team name must be 60 characters or fewer.' }

  const mod = await canRegister(actor.userId)
  if (!mod.ok) return mod
  const st = await accountState(tournamentId, actor.userId)
  if (st && st.kind !== 'freeagent') return { ok: false, error: `You are already on team "${st.teamName}" in this tournament.` }

  // Unique team name within the tournament, ignoring capitalization.
  const active = await prisma.tournamentTeam.findMany({ where: { tournamentId, withdrawn: false }, select: { name: true } })
  if (active.some((t) => nameKey(t.name) === nameKey(clean))) return { ok: false, error: `A team named "${clean}" already exists in this tournament.` }

  const code = (joinCode ?? '').trim()
  const codeErr = validateJoinCode(code)
  if (codeErr) return { ok: false, error: codeErr }
  const joinCodeHash = code ? hashSecret(code) : null

  const teamId = await prisma.$transaction(async (tx) => {
    // A free agent converting to a captain gives up their free-agent slot atomically (no duplicate).
    if (st?.kind === 'freeagent') await tx.tournamentFreeAgent.delete({ where: { id: st.freeAgentId } })
    const reg = await tx.registration.create({ data: { tournamentId, userId: actor.userId, username: clean, displayName: clean, status: 'APPROVED', approvedAt: new Date() } })
    const team = await tx.tournamentTeam.create({ data: { tournamentId, registrationId: reg.id, name: clean, joinCodeHash } })
    await tx.tournamentTeamMember.create({ data: { teamId: team.id, userId: actor.userId, playerId: captain.playerId, name: captain.name, handle: captain.handle, memberOrder: 0, captain: true } })
    // History never records the code — only whether the team is protected.
    await recordAudit(actor, { action: 'tournament.team.start', entity: 'TournamentTeam', entityId: team.id, newValue: { name: clean, protected: !!joinCodeHash } }, tx)
    return team.id
  })
  return { ok: true, teamId }
}

/** Teams a player can join: name, roster space, and whether a join code is required. */
export async function listJoinableTeams(tournamentId: number): Promise<JoinableTeam[]> {
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { teamSize: true } })
  const capacity = t?.teamSize ?? 2
  const teams = await prisma.tournamentTeam.findMany({
    where: { tournamentId, withdrawn: false },
    include: { _count: { select: { members: true } } },
    orderBy: { name: 'asc' },
  })
  return teams.map((tm) => ({ teamId: tm.id, name: tm.name, size: tm._count.members, capacity, full: tm._count.members >= capacity, protected: !!tm.joinCodeHash }))
}

/** JOIN an existing team. Adds ONLY the signed-in account. Protected teams require the correct code. */
export async function joinTeam(actor: Actor, tournamentId: number, teamId: number, player: PlayerIdentity, joinCode: string | null): Promise<{ ok: boolean; error?: string }> {
  const gate = await requirePickTeamOpen(tournamentId)
  if (!gate.ok) return gate
  const mod = await canRegister(actor.userId)
  if (!mod.ok) return mod
  const st = await accountState(tournamentId, actor.userId)
  if (st && st.kind !== 'freeagent') return { ok: false, error: `You are already on team "${st.teamName}" in this tournament.` }

  const team = await prisma.tournamentTeam.findFirst({ where: { id: teamId, tournamentId, withdrawn: false } })
  if (!team) return { ok: false, error: 'That team is not available.' }
  if (team.joinCodeHash && !verifySecret((joinCode ?? '').trim(), team.joinCodeHash)) return { ok: false, error: 'Incorrect team join code.' }

  try {
    await prisma.$transaction(async (tx) => {
      const count = await tx.tournamentTeamMember.count({ where: { teamId } })
      if (count >= gate.teamSize) throw new Error('FULL')
      // A free agent joining gives up their free-agent slot atomically (no duplicate registration).
      if (st?.kind === 'freeagent') await tx.tournamentFreeAgent.delete({ where: { id: st.freeAgentId } })
      await tx.tournamentTeamMember.create({ data: { teamId, userId: actor.userId, playerId: player.playerId, name: player.name, handle: player.handle, memberOrder: count, captain: false } })
      await recordAudit(actor, { action: 'tournament.team.join', entity: 'TournamentTeam', entityId: teamId, newValue: { player: player.name, team: team.name } }, tx)
    })
  } catch (e) {
    if (e instanceof Error && e.message === 'FULL') return { ok: false, error: 'That team is already full.' }
    throw e
  }
  return { ok: true }
}

/** The signed-in player's team membership in this tournament (roster, captain, spaces), or null. */
export async function getMyTeamMembership(userId: number, tournamentId: number): Promise<MyTeamMembership | null> {
  const m = await prisma.tournamentTeamMember.findFirst({
    where: { userId, team: { tournamentId, withdrawn: false } },
    include: { team: { include: { members: { orderBy: { memberOrder: 'asc' } } } } },
  })
  if (!m?.team) return null
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { teamSize: true } })
  const capacity = t?.teamSize ?? 2
  const team = m.team
  return {
    teamId: team.id,
    name: team.name,
    capacity,
    spaces: Math.max(0, capacity - team.members.length),
    isCaptain: m.captain,
    protected: !!team.joinCodeHash,
    complete: team.members.length >= capacity,
    members: team.members.map((x) => ({ userId: x.userId, name: x.name, handle: x.handle, captain: x.captain })),
  }
}

/** The signed-in player WITHDRAWS from their team (registration must be OPEN). If the captain leaves,
 *  the next member is promoted; if they are the last member, the team is disbanded. */
export async function withdrawFromTeam(actor: Actor, tournamentId: number): Promise<{ ok: boolean; error?: string }> {
  const gate = await requirePickTeamOpen(tournamentId)
  if (!gate.ok) return gate
  const m = await prisma.tournamentTeamMember.findFirst({
    where: { userId: actor.userId, team: { tournamentId, withdrawn: false } },
    include: { team: { include: { members: { orderBy: { memberOrder: 'asc' } } } } },
  })
  if (!m?.team) return { ok: false, error: 'You are not on a team in this tournament.' }
  const team = m.team
  await prisma.$transaction(async (tx) => {
    const others = team.members.filter((x) => x.id !== m.id)
    if (m.captain && others.length === 0) {
      // Last member (the captain) → disband the team.
      await tx.tournamentTeam.update({ where: { id: team.id }, data: { withdrawn: true } })
      await tx.registration.update({ where: { id: team.registrationId }, data: { status: 'WITHDRAWN', withdrawnAt: new Date() } })
      await tx.tournamentTeamMember.delete({ where: { id: m.id } })
      await recordAudit(actor, { action: 'tournament.team.disband', entity: 'TournamentTeam', entityId: team.id, newValue: { name: team.name } }, tx)
      return
    }
    if (m.captain) {
      // Promote the next-in-line to captain, then remove the departing captain.
      await tx.tournamentTeamMember.update({ where: { id: others[0].id }, data: { captain: true } })
      await tx.tournamentTeamMember.delete({ where: { id: m.id } })
      await recordAudit(actor, { action: 'tournament.team.captainWithdraw', entity: 'TournamentTeam', entityId: team.id, newValue: { team: team.name, promoted: others[0].name } }, tx)
      return
    }
    await tx.tournamentTeamMember.delete({ where: { id: m.id } })
    await recordAudit(actor, { action: 'tournament.team.withdraw', entity: 'TournamentTeam', entityId: team.id, newValue: { team: team.name, player: m.name } }, tx)
  })
  return { ok: true }
}

/** The captain REMOVES a roster member (by their account id). Recorded in history; never a code. */
export async function removeTeamMember(actor: Actor, tournamentId: number, memberUserId: number): Promise<{ ok: boolean; error?: string }> {
  const gate = await requirePickTeamOpen(tournamentId)
  if (!gate.ok) return gate
  const captainM = await prisma.tournamentTeamMember.findFirst({ where: { userId: actor.userId, captain: true, team: { tournamentId, withdrawn: false } }, include: { team: true } })
  if (!captainM?.team) return { ok: false, error: 'Only the team captain can remove members.' }
  if (memberUserId === actor.userId) return { ok: false, error: 'Use Withdraw to leave your own team.' }
  const target = await prisma.tournamentTeamMember.findFirst({ where: { teamId: captainM.team.id, userId: memberUserId } })
  if (!target) return { ok: false, error: 'That player is not on your team.' }
  await prisma.$transaction(async (tx) => {
    await tx.tournamentTeamMember.delete({ where: { id: target.id } })
    await recordAudit(actor, { action: 'tournament.team.removeMember', entity: 'TournamentTeam', entityId: captainM.team!.id, newValue: { team: captainM.team!.name, removed: target.name } }, tx)
  })
  return { ok: true }
}

/** The captain SETS, CHANGES, or REMOVES the optional join code (registration must be OPEN). The
 *  plaintext is hashed and never returned; history records only whether the team became protected. */
export async function setTeamJoinCode(actor: Actor, tournamentId: number, code: string | null): Promise<{ ok: boolean; error?: string; protected?: boolean }> {
  const gate = await requirePickTeamOpen(tournamentId)
  if (!gate.ok) return gate
  const captainM = await prisma.tournamentTeamMember.findFirst({ where: { userId: actor.userId, captain: true, team: { tournamentId, withdrawn: false } }, include: { team: true } })
  if (!captainM?.team) return { ok: false, error: 'Only the team captain can change the join code.' }
  const clean = (code ?? '').trim()
  const codeErr = validateJoinCode(clean)
  if (codeErr) return { ok: false, error: codeErr }
  const joinCodeHash = clean ? hashSecret(clean) : null
  await prisma.tournamentTeam.update({ where: { id: captainM.team.id }, data: { joinCodeHash } })
  await recordAudit(actor, { action: 'tournament.team.setJoinCode', entity: 'TournamentTeam', entityId: captainM.team.id, newValue: { protected: !!joinCodeHash } })
  return { ok: true, protected: !!joinCodeHash }
}

// ---------------------------------------------------------------------------
// Random-draw team assembly (teamFormation = RANDOM)
// ---------------------------------------------------------------------------

/** Deterministic shuffle (mulberry32 seeded by tournament id) so a redraw is stable + reproducible. */
function shuffleSeeded<T>(items: T[], seed: number): T[] {
  const a = [...items]
  let s = (seed * 2654435761) >>> 0
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Assemble RANDOM-draw teams from the solo entrants of a TEAM tournament (teamFormation = RANDOM):
 * every approved individual signup is shuffled and grouped into teams of `teamSize`. Each team gets
 * a bracket-entrant Registration ("Team N") + a TournamentTeam whose members reference the drawn
 * players (by playerId). The original solo registrations are withdrawn (superseded by the team).
 *
 * NEVER silently drops players: if the entrant count is not an exact multiple of the team size, the
 * draw is BLOCKED and the admin is told precisely how many players to add or remove. Idempotent:
 * refuses (no-op) if teams already exist. Runs at registration close, before seeding.
 */
export async function assembleRandomTeams(actor: Actor, tournamentId: number): Promise<{ ok: boolean; error?: string; teams?: number }> {
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId } })
  if (!t) return { ok: false, error: 'Tournament not found.' }
  if (t.participantFormat !== 'TEAM' || t.teamFormation !== 'RANDOM') return { ok: false, error: 'This tournament does not use random-draw teams.' }
  await assertCompetitionUnlocked(prisma, tournamentId)
  const size = t.teamSize ?? 2

  const already = await prisma.tournamentTeam.count({ where: { tournamentId } })
  if (already > 0) return { ok: true, teams: already } // already drawn — no-op

  // Solo entrants = approved registrations that are NOT themselves team entrants.
  const solos = await prisma.registration.findMany({ where: { tournamentId, status: 'APPROVED', team: { is: null } }, orderBy: { id: 'asc' } })
  const n = solos.length
  if (n < size) {
    return { ok: false, error: `Random-draw teams of ${size} need at least ${size} registered players — you have ${n}. Add ${size - n} more before generating.` }
  }
  const remainder = n % size
  if (remainder !== 0) {
    const add = size - remainder
    // Never discard anyone: block and tell the admin exactly what to change.
    return {
      ok: false,
      error: `Random-draw teams of ${size} need the number of players to be an exact multiple of ${size}. You have ${n}. Add ${add} more player${add === 1 ? '' : 's'} (to ${n + add}) or remove ${remainder} (to ${n - remainder}) before generating — no player is ever dropped from the draw.`,
    }
  }

  const drawn = shuffleSeeded(solos, tournamentId)
  const numTeams = n / size
  await prisma.$transaction(async (tx) => {
    for (let ti = 0; ti < numTeams; ti++) {
      const members = drawn.slice(ti * size, ti * size + size)
      const teamName = `Team ${ti + 1}`
      const reg = await tx.registration.create({
        data: { tournamentId, username: teamName, displayName: teamName, status: 'APPROVED', approvedAt: new Date(), addedByAdmin: true },
      })
      const team = await tx.tournamentTeam.create({ data: { tournamentId, registrationId: reg.id, name: teamName } })
      await tx.tournamentTeamMember.createMany({
        data: members.map((m, i) => ({ teamId: team.id, playerId: m.playerId, name: m.displayName || m.username, handle: m.cueverseId, memberOrder: i, captain: i === 0 })),
      })
    }
    // Retire the (now fully drawn) solo registrations — the team entrants replace them in the bracket.
    await tx.registration.updateMany({ where: { id: { in: drawn.map((r) => r.id) } }, data: { status: 'WITHDRAWN', withdrawnAt: new Date() } })
    await recordAudit(actor, { action: 'tournament.team.randomDraw', entity: 'Tournament', entityId: tournamentId, newValue: { teams: numTeams, teamSize: size } }, tx)
  })
  return { ok: true, teams: numTeams }
}

/** Ensure RANDOM-draw teams are assembled before seeding (no-op for PICK / already-drawn). Called
 *  at the start of bracket generation, group start, and Swiss start. */
export async function ensureRandomTeamsAssembled(actor: Actor, tournamentId: number): Promise<{ ok: boolean; error?: string }> {
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { participantFormat: true, teamFormation: true } })
  if (t?.participantFormat === 'TEAM' && t.teamFormation === 'RANDOM') {
    const r = await assembleRandomTeams(actor, tournamentId)
    if (!r.ok) return { ok: false, error: r.error }
  }
  return { ok: true }
}

/** Exclude INCOMPLETE pick-your-own teams before seeding: a team with fewer than `teamSize` members
 *  cannot enter the competition. Such teams are withdrawn (recorded in history) so only full teams
 *  seed. No-op for non-PICK tournaments. Called at the start of bracket/group/Swiss generation. */
export async function excludeIncompletePickTeams(actor: Actor, tournamentId: number): Promise<{ ok: boolean; error?: string; excluded?: number }> {
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { participantFormat: true, teamFormation: true, teamSize: true } })
  if (!(t?.participantFormat === 'TEAM' && t.teamFormation === 'PICK')) return { ok: true, excluded: 0 }
  const size = t.teamSize ?? 2
  const teams = await prisma.tournamentTeam.findMany({ where: { tournamentId, withdrawn: false }, include: { _count: { select: { members: true } } } })
  const incomplete = teams.filter((tm) => tm._count.members < size)
  if (incomplete.length === 0) return { ok: true, excluded: 0 }
  await prisma.$transaction(async (tx) => {
    for (const tm of incomplete) {
      await tx.tournamentTeam.update({ where: { id: tm.id }, data: { withdrawn: true } })
      await tx.registration.update({ where: { id: tm.registrationId }, data: { status: 'WITHDRAWN', withdrawnAt: new Date(), note: 'Incomplete roster at registration close.' } })
      await recordAudit(actor, { action: 'tournament.team.incompleteExcluded', entity: 'TournamentTeam', entityId: tm.id, newValue: { name: tm.name, roster: tm._count.members, needed: size } }, tx)
    }
  })
  return { ok: true, excluded: incomplete.length }
}
