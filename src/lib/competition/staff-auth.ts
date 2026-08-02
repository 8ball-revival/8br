import 'server-only'
import { getCurrentUser } from '@/lib/account/auth'
import { can, isAdmin, isOwner, isStaff, type Capability } from '@/lib/auth/roles'
import type { Actor } from './audit'

export interface StaffUser extends Actor {
  roles: string[]
  isOwner: boolean
  isAdmin: boolean
  can: (cap: Capability) => boolean
}

export type StaffAccess =
  | { status: 'ok'; actor: StaffUser }
  | { status: 'anon' }
  | { status: 'forbidden'; username: string }

/**
 * Resolve staff-console access from the Payload session (no second auth system).
 * Admits any staff role (owner/admin/editor); the actor's `can()` gates individual
 * operations. Distinguishes not-signed-in (prompt) from signed-in-but-not-staff (403).
 */
export async function resolveStaffAccess(): Promise<StaffAccess> {
  const user = await getCurrentUser()
  if (!user) return { status: 'anon' }
  if (!isStaff(user.roles)) return { status: 'forbidden', username: user.username }
  return {
    status: 'ok',
    actor: {
      userId: Number(user.id),
      username: user.username,
      roles: user.roles,
      isOwner: isOwner(user.roles),
      isAdmin: isAdmin(user.roles),
      can: (cap: Capability) => can(user.roles, cap),
    },
  }
}

/** For server actions: returns the staff actor or throws (actions must be authorized). */
export async function requireStaffActor(): Promise<StaffUser> {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') throw new Error('Forbidden: staff access required.')
  return access.actor
}

/**
 * Require a specific capability for a protected server operation. Throws if the
 * signed-in staff member lacks it. Every mutating action must call this — never
 * rely on hidden UI. See lib/auth/roles.ts for the role→capability matrix.
 */
export async function requireCapability(cap: Capability): Promise<StaffUser> {
  const actor = await requireStaffActor()
  if (!actor.can(cap)) throw new Error(`Forbidden: this action requires the "${cap}" capability.`)
  return actor
}
