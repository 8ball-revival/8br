import 'server-only'
import { cache } from 'react'
import { headers as nextHeaders } from 'next/headers'
import { getPayload } from 'payload'
import config from '@payload-config'
import type { RegistrationStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getActiveSeason } from '@/lib/competition/queries'

export interface CurrentUser {
  id: string
  username: string
  email: string
  roles: string[]
  createdAt?: string
}

async function payload() {
  return getPayload({ config: await config })
}

/**
 * Current signed-in public user (Payload session cookie). No second auth system.
 * Wrapped in React `cache()` so multiple callers in one request (header + page)
 * share a single `payload.auth` call instead of re-authenticating per component.
 */
export const getCurrentUser = cache(async function getCurrentUser(): Promise<CurrentUser | null> {
  const p = await payload()
  const { user } = await p.auth({ headers: await nextHeaders() })
  if (!user) return null
  const u = user as { id: string | number; username?: string; email?: string; roles?: string[]; createdAt?: string }
  return {
    id: String(u.id),
    username: String(u.username ?? ''),
    email: String(u.email ?? ''),
    roles: Array.isArray(u.roles) ? u.roles : [],
    createdAt: u.createdAt,
  }
})

export interface Season2Registration {
  /** True when the user has an active entry (pending or approved). */
  registered: boolean
  status: RegistrationStatus | null
  registeredAt?: string | null
}

/** The current user's registration for the active season (Prisma-backed). */
export async function getSeason2Registration(userId: string): Promise<Season2Registration> {
  const season = await getActiveSeason()
  if (!season) return { registered: false, status: null }
  const reg = await prisma.registration.findUnique({
    where: { seasonId_userId: { seasonId: season.id, userId: Number(userId) } },
  })
  if (!reg) return { registered: false, status: null }
  return {
    registered: reg.status === 'PENDING' || reg.status === 'APPROVED',
    status: reg.status,
    registeredAt: reg.createdAt.toISOString(),
  }
}

/** Live registered-player count (approved) for the active season — honest zero. */
export async function getSeason2RegisteredCount(): Promise<number> {
  const season = await getActiveSeason()
  if (!season) return 0
  return prisma.registration.count({ where: { seasonId: season.id, status: 'APPROVED' } })
}
