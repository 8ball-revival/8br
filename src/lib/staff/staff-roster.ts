import 'server-only'
import { prisma } from '@/lib/prisma'

export interface StaffMember {
  userId: number
  cueverseId: string | null
  email: string | null
  preferredName: string | null
  headAdmin: boolean
}

export interface StaffRoster {
  headAdmin: StaffMember | null
  admins: StaffMember[] // admins who are NOT the head admin
}

async function decorate(rows: { id: number; email: string | null }[], headAdminId: number | null): Promise<StaffMember[]> {
  const out: StaffMember[] = []
  for (const r of rows) {
    const player = await prisma.player.findFirst({ where: { linkedUserId: String(r.id) }, select: { primaryName: true, cueverseId: true } })
    out.push({ userId: r.id, cueverseId: player?.cueverseId ?? null, email: r.email, preferredName: player?.primaryName ?? null, headAdmin: r.id === headAdminId })
  }
  return out
}

/** The staff roster: the single Head Admin plus every Admin-role account. */
export async function getStaffRoster(): Promise<StaffRoster> {
  const hd = await prisma.staffDesignation.findFirst({ where: { headAdmin: true }, select: { userId: true } })
  const headAdminId = hd?.userId ?? null
  // Every account carrying the 'admin' or 'owner' role (the visible top tier below Head Admin).
  const adminRows = await prisma.$queryRawUnsafe<{ id: number; username: string | null; email: string | null }[]>(
    `SELECT DISTINCT u.id, u.username, u.email
       FROM payload.users u
       JOIN payload.users_roles r ON r.parent_id = u.id
      WHERE r.value IN ('admin','owner')
      ORDER BY u.username ASC`,
  )
  const all = await decorate(adminRows, headAdminId)
  return {
    headAdmin: all.find((a) => a.headAdmin) ?? null,
    admins: all.filter((a) => !a.headAdmin),
  }
}

/** Members eligible to be promoted to Admin (role = member only), for the picker. */
export async function searchPromotableMembers(query: string): Promise<StaffMember[]> {
  const q = query.trim().toLowerCase()
  const like = `%${q}%`
  const rows = await prisma.$queryRawUnsafe<{ id: number; email: string | null }[]>(
    `SELECT u.id, u.email
       FROM payload.users u
       LEFT JOIN public."Player" p ON p."linkedUserId" = u.id::text
      WHERE u.id NOT IN (SELECT parent_id FROM payload.users_roles WHERE value IN ('admin','owner'))
        AND ($1 = ''
             OR lower(u.username) LIKE $2
             OR lower(u.email) LIKE $2
             OR lower(coalesce(p."cueverseIdNormalized", '')) LIKE $2
             OR lower(coalesce(p."primaryName", '')) LIKE $2)
      ORDER BY u.username ASC
      LIMIT 15`,
    q, like,
  )
  return decorate(rows, null)
}
