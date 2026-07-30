import 'server-only'
import type { Season } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/** The season the public site and admin default to (most recent, non-completed). */
export async function getActiveSeason(): Promise<Season | null> {
  const live = await prisma.season.findFirst({
    where: { seasonStatus: { not: 'COMPLETED' } },
    orderBy: { createdAt: 'desc' },
  })
  return live ?? prisma.season.findFirst({ orderBy: { createdAt: 'desc' } })
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
