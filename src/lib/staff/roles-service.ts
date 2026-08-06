import 'server-only'
import type { Prisma } from '@prisma/client'
import { getPayload } from 'payload'
import config from '@payload-config'
import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from '@/lib/competition/audit'
import { isOwner, isAdmin, OWNER, ADMIN, MEMBER, type Role } from '@/lib/auth/roles'

/**
 * SHARED staff role-management service — the single, invariant-enforcing path for Admin
 * and Head-Administrator management. Roles live on the Payload user (`roles`); the Head
 * Administrator is a DESIGNATION in the Prisma `StaffDesignation` sidecar (never a role).
 *
 * Server-side invariants (all enforced here, never via hidden UI):
 *  - Exactly one Owner — never zero, never many (Payload hooks also guard this; ownership
 *    changes only through `transferOwnership`).
 *  - Exactly one Head Administrator whenever any Administrator exists.
 *  - Only the Owner or the Head Administrator may create/promote/demote/remove Admins.
 *  - Admins cannot modify their own role or remove themselves, cannot modify the Owner.
 *  - The Head Administrator cannot be demoted/removed until another Admin is designated Head.
 */

export interface RoleActor extends Actor {
  isOwner: boolean
  isHeadAdmin: boolean
}

type Res = { ok: boolean; error?: string }

async function payload() {
  return getPayload({ config: await config })
}

/** Whether the actor may manage Administrators (Owner or the Head Administrator). */
function canManageAdmins(actor: RoleActor): boolean {
  return actor.isOwner || actor.isHeadAdmin
}

async function rolesOf(userId: number): Promise<string[]> {
  const p = await payload()
  const doc = await p.findByID({ collection: 'users', id: userId, overrideAccess: true }).catch(() => null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Array.isArray((doc as any)?.roles) ? (doc as any).roles : []
}

async function setRoles(userId: number, roles: Role[], context?: Record<string, unknown>): Promise<void> {
  const p = await payload()
  await p.update({ collection: 'users', id: userId, data: { roles }, overrideAccess: true, ...(context ? { context } : {}) })
}

// --------------------------------------------------------------------------- Head Admin designation

export async function getHeadAdminUserId(): Promise<number | null> {
  const d = await prisma.staffDesignation.findFirst({ where: { headAdmin: true }, select: { userId: true } })
  return d?.userId ?? null
}

export async function isHeadAdmin(userId: number): Promise<boolean> {
  const d = await prisma.staffDesignation.findUnique({ where: { userId }, select: { headAdmin: true } })
  return !!d?.headAdmin
}

/** Set `userId` as the sole Head Administrator (clears any previous), transactionally. */
async function designateHeadAdmin(tx: Prisma.TransactionClient, userId: number): Promise<void> {
  await tx.staffDesignation.updateMany({ where: { headAdmin: true, userId: { not: userId } }, data: { headAdmin: false } })
  await tx.staffDesignation.upsert({ where: { userId }, create: { userId, headAdmin: true }, update: { headAdmin: true } })
}

// --------------------------------------------------------------------------- Promote / demote

/** Promote a Member to Administrator. Auto-designates the first Admin as Head Administrator. */
export async function promoteToAdmin(actor: RoleActor, targetUserId: number, reason?: string): Promise<Res> {
  if (!canManageAdmins(actor)) return { ok: false, error: 'Only the Owner or Head Administrator may manage Administrators.' }
  const roles = await rolesOf(targetUserId)
  if (isOwner(roles)) return { ok: false, error: 'The Owner cannot be modified here.' }
  if (isAdmin(roles)) return { ok: false, error: 'That account is already an Administrator.' }

  await setRoles(targetUserId, [ADMIN])
  // Head-Admin invariant: if there is no Head Administrator yet, this becomes it.
  const currentHead = await getHeadAdminUserId()
  await prisma.$transaction(async (tx) => {
    if (currentHead == null) await designateHeadAdmin(tx, targetUserId)
    await recordAudit(actor, { action: 'staff.promote', entity: 'User', entityId: targetUserId, newValue: { role: ADMIN, headAdmin: currentHead == null }, reason }, tx)
  })
  return { ok: true }
}

/** Demote an Administrator to Member (also used for "remove admin"). */
export async function demoteAdmin(actor: RoleActor, targetUserId: number, reason?: string): Promise<Res> {
  if (!canManageAdmins(actor)) return { ok: false, error: 'Only the Owner or Head Administrator may manage Administrators.' }
  if (targetUserId === actor.userId) return { ok: false, error: 'You cannot change your own role or remove yourself.' }
  const roles = await rolesOf(targetUserId)
  if (isOwner(roles)) return { ok: false, error: 'The Owner cannot be demoted. Transfer ownership first.' }
  if (!isAdmin(roles)) return { ok: false, error: 'That account is not an Administrator.' }
  if (await isHeadAdmin(targetUserId))
    return { ok: false, error: 'This is the Head Administrator. Designate another Administrator as Head first.' }

  await setRoles(targetUserId, [MEMBER])
  await prisma.$transaction(async (tx) => {
    await tx.staffDesignation.updateMany({ where: { userId: targetUserId }, data: { headAdmin: false } })
    await recordAudit(actor, { action: 'staff.demote', entity: 'User', entityId: targetUserId, oldValue: { role: ADMIN }, newValue: { role: MEMBER }, reason }, tx)
  })
  return { ok: true }
}

/** Replace the Head Administrator. Owner may do this anytime; the current Head Admin may
 *  transfer to another Administrator. The target must already be an Administrator. */
export async function setHeadAdministrator(actor: RoleActor, targetUserId: number, reason?: string): Promise<Res> {
  if (!(actor.isOwner || actor.isHeadAdmin)) return { ok: false, error: 'Only the Owner or current Head Administrator may set the Head Administrator.' }
  const roles = await rolesOf(targetUserId)
  if (!isAdmin(roles) || isOwner(roles)) return { ok: false, error: 'The Head Administrator must be an existing Administrator.' }
  const prev = await getHeadAdminUserId()
  if (prev === targetUserId) return { ok: true }
  await prisma.$transaction(async (tx) => {
    await designateHeadAdmin(tx, targetUserId)
    await recordAudit(actor, { action: 'staff.headAdmin.transfer', entity: 'User', entityId: targetUserId, oldValue: { previousHeadAdmin: prev }, reason }, tx)
  })
  return { ok: true }
}

// --------------------------------------------------------------------------- Ownership transfer

/**
 * Transfer the single Owner designation to another account. Owner-only. Uses the Payload
 * owner-transfer context so the collection hooks permit the (otherwise blocked) change,
 * keeping exactly one Owner at all times: the new account becomes Owner, the old becomes Admin.
 */
export async function transferOwnership(actor: RoleActor, toUserId: number, reason?: string): Promise<Res> {
  if (!actor.isOwner) return { ok: false, error: 'Only the Owner may transfer ownership.' }
  if (toUserId === actor.userId) return { ok: false, error: 'You already own the site.' }
  const targetRoles = await rolesOf(toUserId)
  if (targetRoles.length === 0 && !(await payloadUserExists(toUserId))) return { ok: false, error: 'Target account not found.' }

  const ctx = { allowOwnerTransfer: true }
  // Grant the new Owner first, then demote the old — both under the transfer context.
  await setRoles(toUserId, [OWNER], ctx)
  await setRoles(actor.userId, [ADMIN], ctx)

  const currentHead = await getHeadAdminUserId()
  await prisma.$transaction(async (tx) => {
    // The former Owner is now an Admin; if no Head Administrator exists, designate them.
    if (currentHead == null) await designateHeadAdmin(tx, actor.userId)
    await recordAudit(actor, { action: 'owner.transfer', entity: 'User', entityId: toUserId, oldValue: { previousOwner: actor.userId }, newValue: { newOwner: toUserId }, reason }, tx)
  })
  return { ok: true }
}

async function payloadUserExists(userId: number): Promise<boolean> {
  const p = await payload()
  const doc = await p.findByID({ collection: 'users', id: userId, overrideAccess: true }).catch(() => null)
  return !!doc
}
