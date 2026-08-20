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

  /*
   * A generated address can be occupied by somebody who no longer uses that handle.
   *
   * Addresses are derived from the CueVerse ID, and a member who is later RENAMED keeps the address
   * minted from their original handle. So a handle can be free while the address derived from it is
   * not — and because the duplicate check above only looks at the username, that case reached the
   * insert and failed on the unique index with "Could not create the account", which says nothing.
   *
   * Blocking the handle forever would be wrong: the person who used it has moved on. A numbered
   * variant is taken instead. Addresses are internal plumbing on a domain that can never receive
   * mail, so which one a member holds is invisible to them; the CueVerse ID is the identity.
   */
  let email = supplied
  if (!email) {
    const base = generatedEmailFor(cueverseId)
    email = base
    for (let n = 2; n < 50; n++) {
      const taken = await p.find({
        collection: 'users', where: { email: { equals: email } }, limit: 1, overrideAccess: true,
      })
      if (taken.totalDocs === 0) break
      const [local, domain] = base.split('@')
      email = `${local}-${n}@${domain}`
    }
  } else {
    const taken = await p.find({
      collection: 'users', where: { email: { equals: email } }, limit: 1, overrideAccess: true,
    })
    if (taken.totalDocs > 0) return { error: 'That email address is already in use.' }
  }

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
    /*
     * Say what actually went wrong.
     *
     * This used to return "Could not create the account. Check the details and try again." for every
     * failure that was not a duplicate, which told staff nothing and sent them checking details that
     * were fine. The underlying message is the useful part — it is generated by our own validation,
     * names the field, and contains nothing private.
     */
    return { error: msg ? `Could not create the account: ${msg}` : 'Could not create the account.' }
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
