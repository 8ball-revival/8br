'use server'
import { requireStaffActor } from '@/lib/competition/staff-auth'
import { prisma } from '@/lib/prisma'
import { resetPlayerPassword, targetTier, type ResetResult } from './password-reset'

export interface StaffAccount {
  userId: number
  cueverseId: string | null
  email: string | null
  preferredName: string | null
  tier: 'member' | 'admin' | 'headAdmin'
}

/** Staff account search for the Reset-Password picker: by Preferred Name, CueVerse ID, email, or user id.
 *  There is no separate "username" — CueVerse ID is the account identity. Joins the Player identity
 *  layer so display casing (cueverseId) and Preferred Name are searchable and displayed. */
export async function searchStaffAccountsAction(query: string): Promise<StaffAccount[]> {
  await requireStaffActor()
  const q = query.trim()
  const like = `%${q.toLowerCase()}%`
  const idMatch = /^\d+$/.test(q) ? Number(q) : -1
  const rows = await prisma.$queryRawUnsafe<
    { id: number; email: string | null; cueverseId: string | null; primaryName: string | null }[]
  >(
    `SELECT u.id, u.email, p."cueverseId" AS "cueverseId", p."primaryName" AS "primaryName"
       FROM payload.users u
       LEFT JOIN public."Player" p ON p."linkedUserId" = u.id::text
      WHERE ($1 = ''
             OR lower(u.username) LIKE $2
             OR lower(u.email) LIKE $2
             OR lower(coalesce(p."cueverseIdNormalized", '')) LIKE $2
             OR lower(coalesce(p."primaryName", '')) LIKE $2
             OR u.id = $3)
      ORDER BY u.username ASC
      LIMIT 20`,
    q, like, idMatch,
  )
  const out: StaffAccount[] = []
  for (const r of rows) {
    out.push({ userId: r.id, cueverseId: r.cueverseId, email: r.email, preferredName: r.primaryName, tier: await targetTier(r.id) })
  }
  return out
}

export async function resetPlayerPasswordAction(targetUserId: number, reason?: string): Promise<ResetResult> {
  const actor = await requireStaffActor()
  return resetPlayerPassword(actor, targetUserId, reason)
}
