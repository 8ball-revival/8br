import 'server-only'
import { cache } from 'react'
import { headers as nextHeaders, cookies } from 'next/headers'
import { getPayload } from 'payload'
import config from '@payload-config'
import type { RegistrationStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getActiveSeason } from '@/lib/competition/queries'

export interface CurrentUser {
  id: string
  /** Login key (the controlled projection of the CueVerse ID). Internal — not a display value. */
  username: string
  /** Canonical account identity (display casing). Shown wherever the account is identified. */
  cueverseId: string | null
  /** Optional public display name. */
  preferredName: string | null
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
  // Resolve auth from the request. In Server Actions (POST) the forwarded Cookie header is not
  // reliably surfaced to `p.auth`, so authenticated mutations (create Season/Tournament, etc.)
  // resolved as anonymous → "staff access required" even for a valid Owner, while GET page renders
  // worked. Read the session token from the cookie explicitly (reliable in RSC AND actions) and
  // pass it as an Authorization header so p.auth resolves the user consistently in both contexts.
  const reqHeaders = new Headers(await nextHeaders())
  const token = (await cookies()).get('payload-token')?.value
  if (token && !reqHeaders.has('authorization')) reqHeaders.set('authorization', `JWT ${token}`)
  const { user } = await p.auth({ headers: reqHeaders })
  if (!user) return null
  const u = user as { id: string | number; username?: string; email?: string; roles?: string[]; createdAt?: string }
  // Resolve the canonical CueVerse ID (display casing) + optional Preferred Name from the linked Player.
  const profile = await prisma.player.findUnique({
    where: { linkedUserId: String(u.id) },
    select: { cueverseId: true, primaryName: true },
  }).catch(() => null)
  return {
    id: String(u.id),
    username: String(u.username ?? ''),
    cueverseId: profile?.cueverseId ?? null,
    preferredName: profile?.primaryName ?? null,
    email: String(u.email ?? ''),
    roles: Array.isArray(u.roles) ? u.roles : [],
    createdAt: u.createdAt,
  }
})

/**
 * Verify a password against the CURRENTLY signed-in user — a re-authentication gate for destructive
 * admin actions (e.g. permanently deleting a Season). Returns true only on an exact match. Uses
 * Payload's own credential check; it does NOT issue a new session, so the caller's session is
 * untouched. Repeated wrong attempts count toward Payload's normal login-attempt lockout.
 */
export async function verifyCurrentUserPassword(password: string): Promise<boolean> {
  if (!password) return false
  const current = await getCurrentUser()
  if (!current?.username) return false
  const p = await payload()
  try {
    await p.login({ collection: 'users', data: { username: current.username, password } })
    return true
  } catch {
    return false
  }
}

export interface Season2Registration {
  /** True when the user has an active entry (pending or approved). */
  registered: boolean
  status: RegistrationStatus | null
  registeredAt?: string | null
}

/** The current user's registration for the active tournament (Prisma-backed). */
export async function getSeason2Registration(userId: string): Promise<Season2Registration> {
  const tournament = await getActiveSeason()
  if (!tournament) return { registered: false, status: null }
  const reg = await prisma.registration.findUnique({
    where: { tournamentId_userId: { tournamentId: tournament.id, userId: Number(userId) } },
  })
  if (!reg) return { registered: false, status: null }
  return {
    registered: reg.status === 'PENDING' || reg.status === 'APPROVED',
    status: reg.status,
    registeredAt: reg.createdAt.toISOString(),
  }
}

/** Live registered-player count (approved) for the active tournament — honest zero. */
export async function getSeason2RegisteredCount(): Promise<number> {
  const tournament = await getActiveSeason()
  if (!tournament) return 0
  return prisma.registration.count({ where: { tournamentId: tournament.id, status: 'APPROVED' } })
}
