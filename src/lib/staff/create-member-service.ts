import 'server-only'

import { getPayload } from 'payload'
import config from '@payload-config'

import { recordAudit } from '@/lib/competition/audit'
import { createOrLinkAccountProfile } from '@/lib/players/service'
import { prisma } from '@/lib/prisma'
import type { Actor } from '@/lib/competition/audit'
import {
  normalizeCueverseId,
  cueverseLoginKey,
  validateCueverseId,
  validateEmail,
  validatePassword,
  validatePreferredName,
  generatedEmailFor,
  TEMPORARY_PASSWORD,
} from '@/lib/account/validation'

/**
 * Creating a member account.
 *
 * Deliberately mirrors the public signup path (lib/account/actions.ts → createAccount) rather than
 * inventing a second way to mint an account: the same CueVerse ID normalisation and validation, the
 * same login-key derivation, the same one-account-one-Player-profile provisioning, and the same
 * rollback if profile creation fails.
 *
 * This is the shared implementation behind both the "Create New Member" button and the archive
 * importer. It takes an explicit `actor` instead of reading the session, so it can run in a script;
 * the capability check lives in the server action that wraps it.
 */

export interface CreateMemberInput {
  cueverseId: string
  /** Optional. Left blank, a reserved non-deliverable address is derived from the CueVerse ID. */
  email?: string
  /** Optional. Left blank, the account starts on the shared temporary password. */
  password?: string
  preferredName?: string
}

export interface CreateMemberResult {
  ok?: boolean
  error?: string
  userId?: number
  playerId?: string
}

export async function createMember(actor: Actor, input: CreateMemberInput): Promise<CreateMemberResult> {
  const cueverseId = normalizeCueverseId(input.cueverseId ?? '')
  const preferredName = (input.preferredName ?? '').trim()
  const supplied = (input.email ?? '').trim()
  const password = input.password || TEMPORARY_PASSWORD

  // The CueVerse ID is the only thing staff must supply. Email is validated when given and derived
  // when not, so a member can be created from a handle alone.
  const err =
    validateCueverseId(cueverseId) ||
    (preferredName ? validatePreferredName(preferredName) : null) ||
    (supplied ? validateEmail(supplied) : null) ||
    validatePassword(password)
  if (err) return { error: err }

  const email = supplied || generatedEmailFor(cueverseId)

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

  // The profile is provisioned from the CueVerse ID; a supplied Preferred Name is the display name.
  const profile = await prisma.player.findUnique({
    where: { linkedUserId: String(userId) },
    select: { id: true },
  })
  if (profile && preferredName) {
    await prisma.player.update({ where: { id: profile.id }, data: { primaryName: preferredName } })
  }

  await recordAudit(actor, {
    action: 'member.create',
    entity: 'User',
    entityId: userId,
    newValue: { cueverseId, createdByStaff: true },
  })

  return { ok: true, userId, playerId: profile?.id }
}
