import 'server-only'
import { getCurrentUser } from '@/lib/account/auth'
import type { Actor } from './audit'

/** Roles allowed into the competition administration console. */
export const ADMIN_ROLES = ['admin', 'senior_editor'] as const

export interface StaffUser extends Actor {
  roles: string[]
  isAdmin: boolean
}

export type StaffAccess =
  | { status: 'ok'; actor: StaffUser }
  | { status: 'anon' }
  | { status: 'forbidden'; username: string }

/**
 * Resolve competition-admin access from the Payload session (no second auth
 * system). Distinguishes not-signed-in (prompt) from signed-in-but-not-staff
 * (403), so the console can respond appropriately.
 */
export async function resolveStaffAccess(): Promise<StaffAccess> {
  const user = await getCurrentUser()
  if (!user) return { status: 'anon' }
  const isStaff = ADMIN_ROLES.some((r) => user.roles.includes(r))
  if (!isStaff) return { status: 'forbidden', username: user.username }
  return {
    status: 'ok',
    actor: {
      userId: Number(user.id),
      username: user.username,
      roles: user.roles,
      isAdmin: user.roles.includes('admin'),
    },
  }
}

/** For server actions: returns the staff actor or throws (actions must be authorized). */
export async function requireStaffActor(): Promise<StaffUser> {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') throw new Error('Forbidden: staff access required.')
  return access.actor
}
