'use server'

import { revalidatePath } from 'next/cache'
import { requireCapability } from '@/lib/competition/staff-auth'
import type { ActionResult } from '@/lib/competition/actions'
import * as svc from './service'

function revalidate() {
  for (const p of ['/staff/players', '/staff/registrations', '/account', '/register', '/']) revalidatePath(p)
}
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim()

/** Link an account to a canonical player profile. Requires `manage_players`. */
export async function linkAccountAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireCapability('manage_players')
    const userId = Number(fd.get('userId'))
    const playerId = str(fd, 'playerId')
    if (!userId || !playerId) return { error: 'Select an account and a profile.' }
    const res = await svc.linkAccountToProfile(actor, userId, playerId)
    if (!res.ok) return { error: res.error }
    revalidate()
    return { ok: true, message: 'Account linked to profile.' }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Action failed.' }
  }
}

/** Unlink an account from its profile. Requires `manage_players`. */
export async function unlinkAccountAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireCapability('manage_players')
    const res = await svc.unlinkAccount(actor, str(fd, 'playerId'))
    if (!res.ok) return { error: res.error }
    revalidate()
    return { ok: true, message: 'Account unlinked.' }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Action failed.' }
  }
}

/** Manually create a player profile. Requires `manage_players`. */
export async function createProfileAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireCapability('manage_players')
    const primaryName = str(fd, 'primaryName')
    if (!primaryName) return { error: 'Display name is required.' }
    await svc.createProfile(actor, {
      primaryName,
      cueverseId: str(fd, 'cueverseId') || undefined,
      discord: str(fd, 'discord') || undefined,
      timeZone: str(fd, 'timeZone') || undefined,
    })
    revalidate()
    return { ok: true, message: 'Profile created.' }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Action failed.' }
  }
}

/** Edit a player profile's public details / active flag. Requires `manage_players`. */
export async function updateProfileAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await requireCapability('manage_players')
    const playerId = str(fd, 'playerId')
    if (!playerId) return { error: 'Missing profile.' }
    const patch: svc.ProfilePatch = {}
    if (fd.has('primaryName')) patch.primaryName = str(fd, 'primaryName')
    if (fd.has('cueverseId')) patch.cueverseId = str(fd, 'cueverseId') || null
    if (fd.has('discord')) patch.discord = str(fd, 'discord') || null
    if (fd.has('timeZone')) patch.timeZone = str(fd, 'timeZone') || null
    if (fd.has('active')) patch.active = fd.getAll('active').includes('true')
    await svc.updateProfile(actor, playerId, patch)
    revalidate()
    return { ok: true, message: 'Profile updated.' }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Action failed.' }
  }
}
