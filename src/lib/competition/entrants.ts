import 'server-only'
import { prisma } from '@/lib/prisma'

/**
 * Public competitive identity for a tournament entrant. Resolved from the linked
 * canonical Player profile when the account has been linked; otherwise from the
 * identity the account submitted at registration. NEVER includes email, account
 * password data, staff notes, or any private account field.
 */
export interface EntrantIdentity {
  /** Preferred Name — the public community name (was CueVerse-ID-only before the identity
   *  redesign). Falls back to the submitted registration name / account id for manual entrants. */
  displayName: string
  preferredName: string
  cueverseId: string | null
  discord: string | null // public via the Discord contact affordance only
  slug: string | null // public profile slug when the entrant resolves to a canonical profile
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
    // CURRENT public identity = Preferred Name (CueVerse ID), resolved live from the linked
    // profile so a rename/ID change propagates everywhere. Manual (account-less) entrants keep
    // the identity they submitted until a profile is linked. Never any private field.
    const preferredName = p?.primaryName ?? r.displayName ?? r.cueverseId ?? r.username
    const cueverseId = p?.cueverseId ?? r.cueverseId ?? null
    out.set(r.id, {
      displayName: preferredName,
      preferredName,
      cueverseId,
      discord: p?.discord ?? r.discord ?? null,
      // The public-profile slug is the linked profile's CueVerse ID (URL-safe, resolved by the
      // live /players/[slug] route). Null for account-less manual entrants (no profile page).
      slug: p?.cueverseId ?? null,
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
