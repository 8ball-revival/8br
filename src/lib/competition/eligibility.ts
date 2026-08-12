import 'server-only'
import { prisma } from '@/lib/prisma'
import { resolveMemberStatus } from '@/lib/moderation/service'

/**
 * SHARED competition-eligibility service — the single gate used by Cup signup, Season
 * signup, and admin "add registered account". Every eligibility decision is made
 * server-side here so no surface can diverge.
 *
 * Checks: account moderation status (ban / timeout / deleted), registration window,
 * profile completeness (linked profile with the public identity fields), and duplicate
 * entry. Missing pieces return a clear, user-facing reason plus a machine `code`.
 */

export type EligibilityCode =
  | 'OK'
  | 'BANNED'
  | 'TIMED_OUT'
  | 'DELETED'
  | 'REGISTRATION_CLOSED'
  | 'NO_PROFILE'
  | 'INCOMPLETE_PROFILE'
  | 'ALREADY_REGISTERED'
  | 'NOT_FOUND'

export interface EligibilityResult {
  ok: boolean
  code: EligibilityCode
  reason?: string
}

const OK: EligibilityResult = { ok: true, code: 'OK' }

/** A linked profile is "complete" for competition when it carries the public identity. */
export function profileCompleteness(p: { primaryName: string | null; cueverseId: string | null; discord: string | null; timeZone: string | null } | null): {
  complete: boolean
  missing: string[]
} {
  // Only the CueVerse ID is required to enter a competition — Preferred Name, Discord, and
  // Time Zone are OPTIONAL and must never block registration (a specific competition rule can
  // require one later, if ever). Every real account carries a CueVerse ID.
  if (!p) return { complete: false, missing: ['your player profile'] }
  const missing: string[] = []
  if (!p.cueverseId?.trim()) missing.push('CueVerse ID')
  return { complete: missing.length === 0, missing }
}

/** Status gate shared by every eligibility path. */
async function statusGate(userId: number): Promise<EligibilityResult | null> {
  const s = await resolveMemberStatus(userId)
  if (s.status === 'BANNED') return { ok: false, code: 'BANNED', reason: 'This account is banned and cannot enter competitions.' }
  if (s.status === 'DELETED') return { ok: false, code: 'DELETED', reason: 'This account has been deleted.' }
  if (s.status === 'TIMED_OUT')
    return { ok: false, code: 'TIMED_OUT', reason: `This account is timed out${s.timeoutUntil ? ` until ${new Date(s.timeoutUntil).toLocaleString()}` : ''} and cannot enter competitions.` }
  return null
}

/**
 * Can a signed-in member SELF-SIGN-UP for this competition right now? Requires an active
 * account, a complete linked profile, an open registration window, and no existing entry.
 */
export async function checkSelfSignupEligibility(userId: number, seasonId: number): Promise<EligibilityResult> {
  const blocked = await statusGate(userId)
  if (blocked) return blocked

  const season = await prisma.tournament.findUnique({ where: { id: seasonId }, select: { id: true, registrationStatus: true } })
  if (!season) return { ok: false, code: 'NOT_FOUND', reason: 'Competition not found.' }
  if (season.registrationStatus !== 'OPEN') return { ok: false, code: 'REGISTRATION_CLOSED', reason: 'Registration for this competition is closed.' }

  const profile = await prisma.player.findUnique({
    where: { linkedUserId: String(userId) },
    select: { id: true, primaryName: true, cueverseId: true, discord: true, timeZone: true },
  })
  if (!profile) return { ok: false, code: 'NO_PROFILE', reason: 'Complete your player profile before entering competitions.' }
  const { complete, missing } = profileCompleteness(profile)
  if (!complete) return { ok: false, code: 'INCOMPLETE_PROFILE', reason: `Add the following to your profile before entering: ${missing.join(', ')}.` }

  const existing = await prisma.registration.findFirst({
    where: { seasonId, OR: [{ userId }, { playerId: profile.id }], status: { in: ['PENDING', 'APPROVED'] } },
    select: { id: true },
  })
  if (existing) return { ok: false, code: 'ALREADY_REGISTERED', reason: 'You are already entered in this competition.' }

  return OK
}

/**
 * Can an admin ADD this registered account to a competition? Same status + profile checks,
 * but the open-registration window is NOT required (admins add outside the public window).
 */
export async function checkAdminAddEligibility(userId: number, seasonId: number): Promise<EligibilityResult> {
  const blocked = await statusGate(userId)
  if (blocked) return blocked
  const profile = await prisma.player.findUnique({
    where: { linkedUserId: String(userId) },
    select: { id: true, primaryName: true, cueverseId: true, discord: true, timeZone: true },
  })
  if (!profile) return { ok: false, code: 'NO_PROFILE', reason: 'That account has no linked player profile yet.' }
  const existing = await prisma.registration.findFirst({
    where: { seasonId, OR: [{ userId }, { playerId: profile.id }], status: { in: ['PENDING', 'APPROVED'] } },
    select: { id: true },
  })
  if (existing) return { ok: false, code: 'ALREADY_REGISTERED', reason: 'That account is already entered.' }
  return OK
}
