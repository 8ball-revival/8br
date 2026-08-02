import 'server-only'
import { getPayload } from 'payload'
import config from '@payload-config'
import { prisma } from '@/lib/prisma'
import { suggestProfilesDetailed, type ProfileSuggestion } from './service'

/** A Payload account not yet linked to a canonical profile, with its submitted identity
 *  (from registration) and informational profile suggestions. Email is never included. */
export interface UnlinkedAccount {
  userId: number
  username: string
  displayName: string | null
  cueverseId: string | null
  discord: string | null
  suggestions: ProfileSuggestion[]
}

async function payload() {
  return getPayload({ config: await config })
}

export async function getUnlinkedAccounts(search = ''): Promise<UnlinkedAccount[]> {
  const p = await payload()
  const linked = new Set(
    (await prisma.player.findMany({ where: { linkedUserId: { not: null } }, select: { linkedUserId: true } })).map((r) => r.linkedUserId!),
  )
  const users = await p.find({ collection: 'users', limit: 500, overrideAccess: true, sort: 'username' })

  // Latest submitted identity per user (from their most recent registration).
  const regs = await prisma.registration.findMany({ orderBy: { createdAt: 'desc' }, select: { userId: true, displayName: true, cueverseId: true, discord: true } })
  const regByUser = new Map<number, { displayName: string | null; cueverseId: string | null; discord: string | null }>()
  for (const r of regs) if (!regByUser.has(r.userId)) regByUser.set(r.userId, { displayName: r.displayName, cueverseId: r.cueverseId, discord: r.discord })

  const q = search.trim().toLowerCase()
  const out: UnlinkedAccount[] = []
  for (const u of users.docs as { id: string | number; username?: string }[]) {
    if (linked.has(String(u.id))) continue
    const reg = regByUser.get(Number(u.id))
    const username = String(u.username ?? '')
    const acct = { userId: Number(u.id), username, displayName: reg?.displayName ?? null, cueverseId: reg?.cueverseId ?? null, discord: reg?.discord ?? null }
    if (q && ![acct.username, acct.displayName, acct.cueverseId, acct.discord].some((v) => v?.toLowerCase().includes(q))) continue
    const suggestions = await suggestProfilesDetailed(acct.cueverseId, acct.discord)
    out.push({ ...acct, suggestions })
  }
  return out
}
