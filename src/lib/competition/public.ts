import 'server-only'
import type { Season } from '@prisma/client'
import { formatDate } from '@/lib/format'
import { getActiveSeason } from './queries'

export type PublicSeason = Season

/** The season the public site presents (null when none has been created yet). */
export async function getPublicSeason(): Promise<PublicSeason | null> {
  return getActiveSeason()
}

export function isRegistrationOpen(s: Pick<Season, 'registrationStatus'> | null): boolean {
  return s?.registrationStatus === 'OPEN'
}

export function registrationDeadlineLabel(s: Pick<Season, 'registrationClosesAt'> | null): string {
  if (s?.registrationClosesAt) return `Registration closes ${formatDate(s.registrationClosesAt.toISOString())}`
  return 'Registration deadline to be announced'
}
