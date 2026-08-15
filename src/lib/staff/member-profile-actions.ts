'use server'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'
import config from '@payload-config'
import { requireCapability } from '@/lib/competition/staff-auth'
import { prisma } from '@/lib/prisma'
import { updateProfile, changeCueverseId } from '@/lib/players/service'
import { targetTier } from '@/lib/staff/password-reset'
import { recordAudit } from '@/lib/competition/audit'
import { validateUsername, validateEmail, validatePreferredName, validateCueverseId, validateDiscord, validateTimeZone } from '@/lib/account/validation'

export interface ProfilePatch {
  preferredName?: string
  cueverseId?: string
  timeZone?: string
  discord?: string
  username?: string
  email?: string
}
export interface ProfileResult { ok?: boolean; error?: string }

/**
 * ADMIN edit of a player's safe profile fields — NO cooldown (CueVerse ID change uses the override
 * path so the 7-day member cooldown does not apply to staff). Admins may edit Members; only the Head
 * Admin may edit Admin/Head-Admin accounts. Derived stats (rating, W/L/D, achievements, bracket
 * results) are never editable here. Audited; no secrets recorded.
 */
export async function adminUpdateMemberProfileAction(userId: number, patch: ProfilePatch): Promise<ProfileResult> {
  const actor = await requireCapability('moderate_members')

  const tier = await targetTier(userId)
  if ((tier === 'admin' || tier === 'headAdmin') && !actor.isHeadAdmin) {
    return { error: 'Only the Head Admin may edit an Admin account’s profile.' }
  }

  // Validate every supplied field up front.
  const checks: [string | undefined, (v: string) => string | null][] = [
    [patch.preferredName, validatePreferredName],
    [patch.cueverseId, validateCueverseId],
    [patch.timeZone, (v) => (v.trim() ? validateTimeZone(v) : null)],
    [patch.discord, (v) => (v.trim() ? validateDiscord(v) : null)],
    [patch.username, validateUsername],
    [patch.email, validateEmail],
  ]
  for (const [val, fn] of checks) {
    if (val == null) continue
    const err = fn(val)
    if (err) return { error: err }
  }

  const player = await prisma.player.findFirst({ where: { linkedUserId: String(userId) } })
  const before = {
    preferredName: player?.primaryName ?? null,
    cueverseId: player?.cueverseId ?? null,
    timeZone: player?.timeZone ?? null,
    discord: player?.discord ?? null,
  }

  const actorRef = { userId: actor.userId, username: actor.username }

  // 1) Player identity fields (preferred name, discord, time zone).
  if (player && (patch.preferredName != null || patch.discord != null || patch.timeZone != null)) {
    await updateProfile(actorRef, player.id, {
      ...(patch.preferredName != null ? { primaryName: patch.preferredName.trim() } : {}),
      ...(patch.discord != null ? { discord: patch.discord.trim() || null } : {}),
      ...(patch.timeZone != null ? { timeZone: patch.timeZone.trim() || null } : {}),
    })
  }

  // 2) CueVerse ID — admin override (no cooldown).
  if (player && patch.cueverseId != null && patch.cueverseId.trim() && patch.cueverseId.trim() !== player.cueverseId) {
    const r = await changeCueverseId(actorRef, player.id, patch.cueverseId.trim(), { override: true })
    if (!r.ok) return { error: r.error }
  }

  // 3) Payload account fields (username, email). Payload enforces uniqueness; surface a clean error.
  const userPatch: Record<string, string> = {}
  if (patch.username != null && patch.username.trim()) userPatch.username = patch.username.trim()
  if (patch.email != null && patch.email.trim()) userPatch.email = patch.email.trim().toLowerCase()
  if (Object.keys(userPatch).length) {
    try {
      const p = await getPayload({ config: await config })
      await p.update({ collection: 'users', id: userId, data: userPatch, overrideAccess: true })
    } catch {
      return { error: 'Could not save username/email — it may already be in use.' }
    }
  }

  // Audit the CHANGED profile fields (email/username changes noted as booleans — no value logged).
  await recordAudit(actorRef, {
    action: 'account.profile.update',
    entity: 'User',
    entityId: userId,
    oldValue: before,
    newValue: {
      preferredName: patch.preferredName ?? before.preferredName,
      cueverseId: patch.cueverseId ?? before.cueverseId,
      timeZone: patch.timeZone ?? before.timeZone,
      discord: patch.discord ?? before.discord,
      usernameChanged: !!userPatch.username,
      emailChanged: !!userPatch.email,
    },
  })

  revalidatePath(`/staff/members/${userId}`)
  return { ok: true }
}
