'use server'

import { revalidatePath } from 'next/cache'

import { requireStaffActor } from '@/lib/competition/staff-auth'
import { promoteToAdmin, demoteAdmin, setHeadAdministrator, transferOwnership, type RoleActor } from './roles-service'

export interface RoleResult {
  ok?: boolean
  error?: string
}

async function roleActor(): Promise<RoleActor> {
  const a = await requireStaffActor()
  return { userId: a.userId, username: a.username, isOwner: a.isOwner, isHeadAdmin: a.isHeadAdmin }
}

function revalidateStaff() {
  for (const p of ['/staff/members', '/staff/staff']) revalidatePath(p)
}

export async function promoteToAdminAction(targetUserId: number, reason?: string): Promise<RoleResult> {
  const res = await promoteToAdmin(await roleActor(), targetUserId, reason)
  if (!res.ok) return { error: res.error }
  revalidateStaff()
  return { ok: true }
}

export async function demoteAdminAction(targetUserId: number, reason?: string): Promise<RoleResult> {
  const res = await demoteAdmin(await roleActor(), targetUserId, reason)
  if (!res.ok) return { error: res.error }
  revalidateStaff()
  return { ok: true }
}

export async function setHeadAdministratorAction(targetUserId: number, reason?: string): Promise<RoleResult> {
  const res = await setHeadAdministrator(await roleActor(), targetUserId, reason)
  if (!res.ok) return { error: res.error }
  revalidateStaff()
  return { ok: true }
}

export async function transferOwnershipAction(toUserId: number, reason?: string): Promise<RoleResult> {
  const res = await transferOwnership(await roleActor(), toUserId, reason)
  if (!res.ok) return { error: res.error }
  revalidateStaff()
  return { ok: true }
}
