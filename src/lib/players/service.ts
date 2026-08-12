import 'server-only'
import { prisma } from '@/lib/prisma'

/**
 * Minimal account-identity service. Each WCC account (Payload user) may have ONE linked
 * Player record that carries its competitive identity (CueVerse ID + optional display name,
 * Discord, time zone). There are no public player-profile PAGES in WCC — this record only
 * backs the account's identity and its tournament registrations.
 */

const COOLDOWN_DAYS = 7

export type AccountActor = { userId: number; username: string }

/** Whether the CueVerse ID can be changed now, and when it next can (7-day cooldown). */
export function cueverseCooldownState(changedAt: Date | null | undefined): { canChange: boolean; nextAvailableAt: Date | null } {
  if (!changedAt) return { canChange: true, nextAvailableAt: null }
  const nextAvailableAt = new Date(changedAt.getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000)
  return { canChange: nextAvailableAt <= new Date(), nextAvailableAt }
}

/** The Player record linked to a Payload account, or null. */
export async function getProfileByUserId(userId: number) {
  return prisma.player.findUnique({ where: { linkedUserId: String(userId) } })
}

/** Create (or return) the Player identity for a new account. */
export async function createOrLinkAccountProfile(
  userId: number,
  username: string,
  opts: { cueverseId?: string | null } = {},
): Promise<{ ok: boolean; error?: string }> {
  const existing = await prisma.player.findUnique({ where: { linkedUserId: String(userId) } })
  if (existing) return { ok: true }
  const cueverseId = (opts.cueverseId ?? username).trim() || username
  try {
    await prisma.player.create({
      data: {
        primaryName: cueverseId,
        cueverseId,
        cueverseIdChangedAt: new Date(),
        linkedUserId: String(userId),
        linkStatus: 'VERIFIED',
        linkedAt: new Date(),
      },
    })
    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not create your player identity.' }
  }
}

/** Update editable public identity fields (Preferred Name, Discord, Time Zone). */
export async function updateProfile(
  _actor: AccountActor,
  profileId: string,
  data: { primaryName?: string; discord?: string | null; timeZone?: string | null },
): Promise<{ ok: boolean }> {
  await prisma.player.update({ where: { id: profileId }, data })
  return { ok: true }
}

/** Change the account's CueVerse ID (site-wide display identity), enforcing a 7-day cooldown. */
export async function changeCueverseId(
  _actor: AccountActor,
  profileId: string,
  newId: string,
  opts: { override?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  const profile = await prisma.player.findUnique({ where: { id: profileId } })
  if (!profile) return { ok: false, error: 'Profile not found.' }
  if (!opts.override && profile.cueverseIdChangedAt) {
    const nextAllowed = new Date(profile.cueverseIdChangedAt.getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000)
    if (nextAllowed > new Date()) {
      return { ok: false, error: `You can change your CueVerse ID again after ${nextAllowed.toDateString()}.` }
    }
  }
  await prisma.player.update({
    where: { id: profileId },
    data: { cueverseId: newId, cueverseIdChangedAt: new Date() },
  })
  return { ok: true }
}
