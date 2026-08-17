'use server'

import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'
import config from '@payload-config'

import { requireCapability } from '@/lib/competition/staff-auth'
import { recordAudit } from '@/lib/competition/audit'
import { createOrLinkAccountProfile } from '@/lib/players/service'
import {
  normalizeCueverseId,
  cueverseLoginKey,
  validateCueverseId,
  validateEmail,
  validatePassword,
  validatePreferredName,
} from '@/lib/account/validation'

/**
 * Staff-created member accounts.
 *
 * Deliberately mirrors the public signup path (lib/account/actions.ts → createAccount) rather than
 * inventing a second way to mint an account: the same CueVerse ID normalisation and validation, the
 * same login-key derivation, the same one-account-one-Player-profile provisioning, and the same
 * rollback if profile creation fails. The only differences are that a staff member supplies the
 * details and the action is capability-gated.
 *
 * Gated on `manage_players` (ADMIN or OWNER). New accounts are always created as `member` — this is
 * not a route to mint staff; role changes go through the separate, Owner-gated roles service.
 */

export interface CreateMemberResult {
  ok?: boolean
  error?: string
  userId?: number
}

export async function createMemberAction(input: {
  cueverseId: string
  email: string
  password: string
  preferredName?: string
}): Promise<CreateMemberResult> {
  const actor = await requireCapability('manage_players')

  const cueverseId = normalizeCueverseId(input.cueverseId ?? '')
  const preferredName = (input.preferredName ?? '').trim()
  const email = (input.email ?? '').trim()
  const password = input.password ?? ''

  const err =
    validateCueverseId(cueverseId) ||
    (preferredName ? validatePreferredName(preferredName) : null) ||
    validateEmail(email) ||
    validatePassword(password)
  if (err) return { error: err }

  const username = cueverseLoginKey(cueverseId)
  const p = await getPayload({ config: await config })

  // Duplicate check is case-insensitive: `username` is the lowered CueVerse ID.
  const existing = await p.find({
    collection: 'users',
    where: { username: { equals: username } },
    limit: 1,
    overrideAccess: true,
  })
  if (existing.totalDocs > 0) return { error: 'That CueVerse ID or email is already in use.' }

  let userId: number
  try {
    // skipAutoProfile: the profile is created below with the chosen CueVerse ID casing, so the
    // Users afterChange back-fill must not pre-create one from the lowered username.
    const created = await p.create({
      collection: 'users',
      data: { username, email, password, roles: ['member'] },
      overrideAccess: true,
      context: { skipAutoProfile: true },
    })
    userId = Number(created.id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (/unique|already|duplicate/i.test(msg)) {
      return { error: 'That CueVerse ID or email is already in use.' }
    }
    return { error: 'Could not create the account. Check the details and try again.' }
  }

  const provision = await createOrLinkAccountProfile(userId, username, { cueverseId })
  if (!provision.ok) {
    // Roll the account back so a failed provision cannot leave a user with no Player profile.
    await p.delete({ collection: 'users', id: userId, overrideAccess: true }).catch(() => {})
    return { error: provision.error }
  }

  await recordAudit(actor, {
    action: 'member.create',
    entity: 'User',
    entityId: userId,
    newValue: { cueverseId, createdByStaff: true },
  })

  revalidatePath('/staff/members')
  return { ok: true, userId }
}
