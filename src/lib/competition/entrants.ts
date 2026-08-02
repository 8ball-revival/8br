import 'server-only'
import { prisma } from '@/lib/prisma'

/**
 * Public competitive identity for a season entrant. Resolved from the linked
 * canonical Player profile when the account has been linked; otherwise from the
 * identity the account submitted at registration. NEVER includes email, account
 * password data, staff notes, or any private account field.
 */
export interface EntrantIdentity {
  displayName: string
  cueverseId: string | null
  discord: string | null // public by community norm
}

type ResolvableRegistration = {
  id: number
  username: string
  displayName: string | null
  cueverseId: string | null
  discord: string | null
  playerId: string | null
}

/**
 * Batch-resolve a set of registrations to their public display identity. Linked
 * entrants resolve to their canonical Player profile; unlinked entrants use the
 * name/CueVerse ID/Discord they submitted (falling back to the account User ID as
 * a last resort). Returns a map keyed by registration id.
 */
export async function resolveEntrants(
  regs: ResolvableRegistration[],
): Promise<Map<number, EntrantIdentity>> {
  const pids = [...new Set(regs.map((r) => r.playerId).filter((x): x is string => !!x))]
  const profiles = pids.length
    ? await prisma.player.findMany({
        where: { id: { in: pids } },
        select: { id: true, primaryName: true, cueverseId: true, discord: true },
      })
    : []
  const pmap = new Map(profiles.map((p) => [p.id, p]))

  const out = new Map<number, EntrantIdentity>()
  for (const r of regs) {
    const p = r.playerId ? pmap.get(r.playerId) : null
    out.set(r.id, {
      displayName: p?.primaryName ?? r.displayName ?? r.username,
      cueverseId: p?.cueverseId ?? r.cueverseId ?? null,
      discord: p?.discord ?? r.discord ?? null,
    })
  }
  return out
}

/** Columns to select from Registration for identity resolution (never email). */
export const ENTRANT_SELECT = {
  id: true,
  username: true,
  displayName: true,
  cueverseId: true,
  discord: true,
  playerId: true,
} as const
