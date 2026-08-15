'use server'
import { requireStaffActor } from '@/lib/competition/staff-auth'
import { prisma } from '@/lib/prisma'
import { resetPlayerPassword, targetTier, type ResetResult } from './password-reset'

export interface StaffAccount {
  userId: number
  username: string | null
  email: string | null
  preferredName: string | null
  tier: 'member' | 'admin' | 'headAdmin'
}

/** Staff account search for the Reset-Password picker: by preferred name, CueVerse ID, email, or user id. */
export async function searchStaffAccountsAction(query: string): Promise<StaffAccount[]> {
  await requireStaffActor()
  const q = query.trim()
  const like = `%${q.toLowerCase()}%`
  const idMatch = /^\d+$/.test(q) ? Number(q) : -1
  const rows = await prisma.$queryRawUnsafe<{ id: number; username: string | null; email: string | null }[]>(
    `SELECT u.id, u.username, u.email
       FROM payload.users u
      WHERE ($1 = '' OR lower(u.username) LIKE $2 OR lower(u.email) LIKE $2 OR u.id = $3)
      ORDER BY u.username ASC
      LIMIT 20`,
    q, like, idMatch,
  )
  // Attach preferred name (from the Player identity layer) + role tier.
  const out: StaffAccount[] = []
  for (const r of rows) {
    const player = await prisma.player.findFirst({ where: { linkedUserId: String(r.id) }, select: { primaryName: true } })
    out.push({ userId: r.id, username: r.username, email: r.email, preferredName: player?.primaryName ?? null, tier: await targetTier(r.id) })
  }
  return out
}

export async function resetPlayerPasswordAction(targetUserId: number, reason?: string): Promise<ResetResult> {
  const actor = await requireStaffActor()
  return resetPlayerPassword(actor, targetUserId, reason)
}
