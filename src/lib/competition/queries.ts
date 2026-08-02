import 'server-only'
import type { Season } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveEntrants, ENTRANT_SELECT } from './entrants'

/** The season the public site and admin default to (most recent, non-completed).
 *  Scoped to competitionType SEASON so migrated Cups (also comp_season rows) are
 *  never mistaken for the active season. */
export async function getActiveSeason(): Promise<Season | null> {
  const live = await prisma.season.findFirst({
    where: { competitionType: 'SEASON', seasonStatus: { not: 'COMPLETED' } },
    orderBy: { createdAt: 'desc' },
  })
  return live ?? prisma.season.findFirst({ where: { competitionType: 'SEASON' }, orderBy: { createdAt: 'desc' } })
}

export async function getSeasonBySlug(slug: string): Promise<Season | null> {
  return prisma.season.findUnique({ where: { slug } })
}

/** Live registered (approved) player count for a season. */
export async function getApprovedCount(seasonId: number): Promise<number> {
  return prisma.registration.count({ where: { seasonId, status: 'APPROVED' } })
}

/** A single user's registration for a season (public account/register views). */
export async function getUserRegistration(seasonId: number, userId: number) {
  return prisma.registration.findUnique({ where: { seasonId_userId: { seasonId, userId } } })
}

export interface EntrantRow {
  registrationId: number
  displayName: string
  cueverseId: string | null
  status: string
  hasAccount: boolean
  addedByAdmin: boolean
  inGroup: boolean
  playerId: string | null
}

/** All entrants for a season (any status), resolved to public identity, for admin
 *  management. Includes account-link + group-placement flags. */
export async function getEntrants(seasonId: number): Promise<EntrantRow[]> {
  const regs = await prisma.registration.findMany({
    where: { seasonId },
    orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, username: true, displayName: true, cueverseId: true, discord: true, playerId: true, userId: true, status: true, addedByAdmin: true },
  })
  const identities = await resolveEntrants(regs)
  const gp = await prisma.groupPlayer.findMany({ where: { group: { seasonId } }, select: { registrationId: true } })
  const inGroup = new Set(gp.map((g) => g.registrationId))
  return regs.map((r) => ({
    registrationId: r.id,
    displayName: identities.get(r.id)?.displayName ?? r.username,
    cueverseId: identities.get(r.id)?.cueverseId ?? null,
    status: r.status,
    hasAccount: r.userId != null,
    addedByAdmin: r.addedByAdmin,
    inGroup: inGroup.has(r.id),
    playerId: r.playerId,
  }))
}

export interface EntrantCandidateRow { playerId: string; primaryName: string; cueverseId: string | null; alreadyEntered: boolean }

/** Player profiles matching a search (name / CueVerse ID / verified alias), for the
 *  admin "add entrant" tool. Already-entered profiles ARE returned but flagged
 *  `alreadyEntered` so the UI can show them as unavailable rather than hiding them. */
export async function searchEntrantCandidates(seasonId: number, query: string, limit = 15): Promise<EntrantCandidateRow[]> {
  const q = query.trim()
  if (!q) return []
  const nk = q.toLowerCase().replace(/[^a-z0-9]/g, '')
  const entered = new Set(
    (await prisma.registration.findMany({ where: { seasonId, status: 'APPROVED', playerId: { not: null } }, select: { playerId: true } })).map((e) => e.playerId!),
  )
  const rows = await prisma.player.findMany({
    where: {
      active: true,
      OR: [
        { primaryName: { contains: q, mode: 'insensitive' } },
        { cueverseId: { contains: q, mode: 'insensitive' } },
        { aliases: { some: { alias: { contains: nk } } } },
      ],
    },
    orderBy: { primaryName: 'asc' },
    take: limit,
    select: { id: true, primaryName: true, cueverseId: true },
  })
  return rows.map((r) => ({ playerId: r.id, primaryName: r.primaryName, cueverseId: r.cueverseId, alreadyEntered: entered.has(r.id) }))
}

/** Published groups with players + standings, for the PUBLIC groups page. */
export async function getPublishedGroups(seasonId: number) {
  return prisma.seasonGroup.findMany({
    where: { seasonId, published: true },
    orderBy: { ordinal: 'asc' },
    include: {
      players: { orderBy: { seed: 'asc' } },
      standings: { orderBy: [{ rank: 'asc' }] },
    },
  })
}

export interface BuilderPlayer {
  registrationId: number
  seed: number
  displayName: string
  cueverseId: string | null
}
export interface BuilderGroup {
  id: number
  code: string
  name: string
  ordinal: number
  published: boolean
  players: BuilderPlayer[]
}
export interface GroupBuilderData {
  groups: BuilderGroup[]
  unassigned: BuilderPlayer[]
  approvedCount: number
  published: boolean
}

/**
 * Everything the manual group-builder needs: all groups (with players resolved to
 * their public identity), plus the "Unassigned Players" pool — every ACTIVE
 * (APPROVED) entrant not yet placed into a group. Assigned players never appear in
 * the unassigned pool, so the add dropdown can exclude them. No email is selected.
 */
export async function getGroupBuilder(seasonId: number): Promise<GroupBuilderData> {
  const [rawGroups, approved] = await Promise.all([
    prisma.seasonGroup.findMany({
      where: { seasonId },
      orderBy: { ordinal: 'asc' },
      include: { players: { orderBy: { seed: 'asc' }, include: { registration: { select: ENTRANT_SELECT } } } },
    }),
    prisma.registration.findMany({ where: { seasonId, status: 'APPROVED' }, orderBy: { createdAt: 'asc' }, select: ENTRANT_SELECT }),
  ])

  const allRegs = [...approved, ...rawGroups.flatMap((g) => g.players.map((p) => p.registration))]
  const identities = await resolveEntrants(allRegs)
  const toPlayer = (registrationId: number, seed: number, username: string): BuilderPlayer => {
    const idn = identities.get(registrationId)
    return { registrationId, seed, displayName: idn?.displayName ?? username, cueverseId: idn?.cueverseId ?? null }
  }

  const groups: BuilderGroup[] = rawGroups.map((g) => ({
    id: g.id,
    code: g.code,
    name: g.name,
    ordinal: g.ordinal,
    published: g.published,
    players: g.players.map((p) => toPlayer(p.registrationId, p.seed, p.registration.username)),
  }))

  const assigned = new Set(rawGroups.flatMap((g) => g.players.map((p) => p.registrationId)))
  const unassigned = approved
    .filter((r) => !assigned.has(r.id))
    .map((r) => toPlayer(r.id, 0, r.username))

  return { groups, unassigned, approvedCount: approved.length, published: groups.some((g) => g.published) }
}

export interface PlayoffSeed { registrationId: number; seed: number; displayName: string; cueverseId: string | null }
export interface PlayoffBuilderData {
  seeds: PlayoffSeed[]
  pool: { registrationId: number; displayName: string; cueverseId: string | null }[]
  published: boolean
  hasBracket: boolean
}

/** State for the manual playoff builder: the current ordered seed list (reconstructed
 *  from the draft round-1 slots) + the Available Entrants pool (active entrants not
 *  yet seeded). Names are resolved public identities. */
export async function getPlayoffBuilder(seasonId: number): Promise<PlayoffBuilderData> {
  const matches = await prisma.playoffMatch.findMany({ where: { seasonId }, orderBy: [{ round: 'asc' }, { slot: 'asc' }] })
  const published = matches.some((m) => m.published)
  const seededRaw: { registrationId: number; seed: number }[] = []
  for (const m of matches.filter((x) => x.round === 1)) {
    if (m.homeRegistrationId != null) seededRaw.push({ registrationId: m.homeRegistrationId, seed: m.homeSeed ?? 0 })
    if (m.awayRegistrationId != null) seededRaw.push({ registrationId: m.awayRegistrationId, seed: m.awaySeed ?? 0 })
  }
  seededRaw.sort((a, b) => a.seed - b.seed)

  const entrants = await getEntrants(seasonId)
  const active = entrants.filter((e) => e.status === 'APPROVED' || e.status === 'PENDING')
  const byReg = new Map(active.map((e) => [e.registrationId, e]))
  const seeds: PlayoffSeed[] = seededRaw.map((s) => ({
    registrationId: s.registrationId,
    seed: s.seed,
    displayName: byReg.get(s.registrationId)?.displayName ?? 'Unknown',
    cueverseId: byReg.get(s.registrationId)?.cueverseId ?? null,
  }))
  const seededIds = new Set(seededRaw.map((s) => s.registrationId))
  const pool = active.filter((e) => !seededIds.has(e.registrationId)).map((e) => ({ registrationId: e.registrationId, displayName: e.displayName, cueverseId: e.cueverseId }))
  return { seeds, pool, published, hasBracket: matches.length > 0 }
}

/** All groups (published or not) with players (+ registration) + standings, for ADMIN. */
export async function getAllGroups(seasonId: number) {
  return prisma.seasonGroup.findMany({
    where: { seasonId },
    orderBy: { ordinal: 'asc' },
    include: {
      players: { orderBy: { seed: 'asc' }, include: { registration: true } },
      standings: { orderBy: [{ rank: 'asc' }] },
    },
  })
}

export async function getGroupMatches(groupId: number) {
  return prisma.seasonMatch.findMany({
    where: { groupId },
    orderBy: [{ round: 'asc' }, { id: 'asc' }],
  })
}

export async function getSeasonMatches(seasonId: number) {
  return prisma.seasonMatch.findMany({
    where: { seasonId },
    orderBy: [{ groupId: 'asc' }, { round: 'asc' }, { id: 'asc' }],
  })
}

/** Published playoff matches for the PUBLIC playoffs page (bracket order). */
export async function getPublishedPlayoff(seasonId: number) {
  return prisma.playoffMatch.findMany({
    where: { seasonId, published: true },
    orderBy: [{ round: 'asc' }, { slot: 'asc' }],
  })
}

export async function getAllPlayoffMatches(seasonId: number) {
  return prisma.playoffMatch.findMany({
    where: { seasonId },
    orderBy: [{ round: 'asc' }, { slot: 'asc' }],
  })
}

export async function listRegistrations(seasonId: number) {
  return prisma.registration.findMany({
    where: { seasonId },
    orderBy: [{ status: 'asc' }, { username: 'asc' }],
  })
}

/** Aggregate counts for the admin dashboard. */
export async function getDashboardSummary(seasonId: number) {
  const [reg, groups, matchesWaiting, unverified, disputes, playoff] = await Promise.all([
    prisma.registration.groupBy({ by: ['status'], where: { seasonId }, _count: true }),
    prisma.seasonGroup.count({ where: { seasonId } }),
    prisma.seasonMatch.count({ where: { seasonId, status: 'SCHEDULED' } }),
    prisma.seasonMatch.count({
      where: { seasonId, status: { not: 'SCHEDULED' }, verification: 'UNVERIFIED' },
    }),
    prisma.seasonMatch.count({ where: { seasonId, status: 'DISPUTED' } }),
    prisma.playoffMatch.count({ where: { seasonId } }),
  ])
  const byStatus: Record<string, number> = {}
  for (const r of reg) byStatus[r.status] = r._count
  return {
    registrations: byStatus,
    registrationTotal: Object.values(byStatus).reduce((a, b) => a + b, 0),
    groups,
    matchesWaiting,
    unverified,
    disputes,
    playoffMatches: playoff,
  }
}

export async function getRecentAudit(limit = 20) {
  return prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: limit })
}

/**
 * Per-match audit history (reuses the single audit system — no second history
 * store). Returns a Map keyed by entityId (string) of chronological entries for the
 * given entity type ("Match" or "PlayoffMatch").
 */
export async function getMatchHistory(entity: 'Match' | 'PlayoffMatch', entityIds: number[]) {
  if (entityIds.length === 0) return new Map<string, Awaited<ReturnType<typeof prisma.auditLog.findMany>>>()
  const rows = await prisma.auditLog.findMany({
    where: { entity, entityId: { in: entityIds.map(String) } },
    orderBy: { createdAt: 'asc' },
  })
  const byId = new Map<string, typeof rows>()
  for (const r of rows) {
    const k = r.entityId ?? ''
    if (!byId.has(k)) byId.set(k, [])
    byId.get(k)!.push(r)
  }
  return byId
}
