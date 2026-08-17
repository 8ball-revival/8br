'use server'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'
import config from '@payload-config'
import { requireCapability } from '@/lib/competition/staff-auth'
import { prisma } from '@/lib/prisma'
import { updateProfile, changeCueverseId } from '@/lib/players/service'
import { targetTier } from '@/lib/staff/password-reset'
import { recordAudit } from '@/lib/competition/audit'
import { validateEmail, validatePreferredName, validateCueverseId, validateDiscord, validateTimeZone } from '@/lib/account/validation'
import { propagateIdentityChange, identityChanged } from '@/lib/players/identity-propagation'

export interface ProfilePatch {
  preferredName?: string
  cueverseId?: string
  timeZone?: string
  discord?: string
  email?: string
}
export interface ProfileResult {
  ok?: boolean
  error?: string
  /** How many competition records were re-labelled by the change, for operator feedback. */
  propagated?: number
}

/**
 * ADMIN edit of a player's safe profile fields. Admins may edit Members; only the Head
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

  // 2) CueVerse ID — admin override. Routes through the identity service, which also
  //    syncs the login username. A collision returns a clear inline conflict error (no private data).
  let cueverseChanged = false
  if (player && patch.cueverseId != null && patch.cueverseId.trim() && patch.cueverseId.trim() !== player.cueverseId) {
    const r = await changeCueverseId(actorRef, player.id, patch.cueverseId.trim(), { override: true, reason: 'admin correction' })
    if (!r.ok) return { error: r.error }
    cueverseChanged = true
  }

  // 3) Email (private). The username is NOT editable — it is derived from the CueVerse ID above.
  let emailChanged = false
  if (patch.email != null && patch.email.trim()) {
    try {
      const p = await getPayload({ config: await config })
      await p.update({ collection: 'users', id: userId, data: { email: patch.email.trim().toLowerCase() }, overrideAccess: true })
      emailChanged = true
    } catch {
      return { error: 'Could not save the email — it may already be in use.' }
    }
  }

  // Push the new identity out to every competition record that copied the old one. Without this a
  // rename only lands on the profile, and the same person shows up under two names depending on which
  // page you are looking at.
  let propagated = 0
  if (player) {
    const after = await prisma.player.findUnique({
      where: { id: player.id },
      select: { cueverseId: true, primaryName: true },
    })
    const change = {
      playerId: player.id,
      oldCueverseId: before.cueverseId,
      newCueverseId: after?.cueverseId ?? before.cueverseId,
      oldPreferredName: before.preferredName,
      newPreferredName: after?.primaryName ?? before.preferredName,
    }
    if (identityChanged(change)) {
      const report = await propagateIdentityChange(change)
      propagated = report.total
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
      cueverseIdChanged: cueverseChanged,
      emailChanged,
      competitionRecordsRelabelled: propagated,
    },
  })

  revalidatePath(`/staff/members/${userId}`)
  revalidatePath('/staff/members')
  if (propagated > 0) {
    // Anything that displays a player's name is now stale.
    for (const path of ['/', '/seasons', '/tournaments', '/rankings', '/players']) revalidatePath(path, 'layout')
  }
  return { ok: true, propagated }
}
