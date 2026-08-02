import 'server-only'
import type { Season } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { formatDate } from '@/lib/format'
import { getActiveSeason } from './queries'

export type PublicSeason = Season

/** The season the public site presents (null when none has been created yet). */
export async function getPublicSeason(): Promise<PublicSeason | null> {
  return getActiveSeason()
}

export interface PublicRegistrant {
  displayName: string
  cueverseId: string | null
  discord: string | null // public contact by community norm
  registeredAt: string
}

/**
 * ACTIVE (APPROVED) registrations for the current season — the live public entrant
 * list. Active immediately (no staff approval). When a registration's account has been
 * linked to a canonical profile, the entrant resolves to that profile's public
 * identity; otherwise the submitted identity is shown. Public fields ONLY (name,
 * CueVerse ID, Discord) — email/notes/auth data are never selected or exposed.
 */
export async function getPublicRegistrations(): Promise<PublicRegistrant[]> {
  const season = await getActiveSeason()
  if (!season) return []
  const regs = await prisma.registration.findMany({
    where: { seasonId: season.id, status: 'APPROVED' },
    orderBy: { createdAt: 'asc' },
    select: { username: true, displayName: true, cueverseId: true, discord: true, playerId: true, createdAt: true },
  })
  const pids = [...new Set(regs.map((r) => r.playerId).filter((x): x is string => !!x))]
  const profiles = pids.length
    ? await prisma.player.findMany({ where: { id: { in: pids } }, select: { id: true, primaryName: true, cueverseId: true, discord: true } })
    : []
  const pmap = new Map(profiles.map((p) => [p.id, p]))
  return regs.map((r) => {
    const p = r.playerId ? pmap.get(r.playerId) : null
    return {
      displayName: p?.primaryName ?? r.displayName ?? r.username,
      cueverseId: p?.cueverseId ?? r.cueverseId ?? null,
      discord: p?.discord ?? r.discord ?? null,
      registeredAt: r.createdAt.toISOString(),
    }
  })
}

export function isRegistrationOpen(s: Pick<Season, 'registrationStatus'> | null): boolean {
  return s?.registrationStatus === 'OPEN'
}

export function registrationDeadlineLabel(s: Pick<Season, 'registrationClosesAt'> | null): string {
  if (s?.registrationClosesAt) return `Registration closes ${formatDate(s.registrationClosesAt.toISOString())}`
  return 'Registration deadline to be announced'
}
