import 'server-only'
import { prisma } from '@/lib/prisma'
import { normalizeCueverseId, cueverseLoginKey, validateCueverseId } from '@/lib/account/validation'
import { recordAudit } from '@/lib/competition/audit'

/**
 * CENTRAL ACCOUNT-IDENTITY SERVICE.
 *
 * CueVerse ID is the single canonical account identity, username, and login name. There is no
 * separately-meaningful "username". Concretely:
 *
 *   • Player.cueverseId            — the canonical CueVerse ID, preserving the player's chosen casing
 *                                    (the value shown everywhere).
 *   • Player.cueverseIdNormalized  — trim+lowercase of cueverseId (= cueverseLoginKey). A UNIQUE index
 *                                    on this column is the authoritative, case-insensitive uniqueness
 *                                    constraint for account identity.
 *   • payload.users.username       — the login field Payload's auth REQUIRES. It is a CONTROLLED
 *                                    PROJECTION that ALWAYS equals cueverseLoginKey(cueverseId). It is
 *                                    never independently editable and is written ONLY through this
 *                                    service (the Users collection rejects any other username change).
 *
 * Every identity create/change path routes through here so the two stores can never diverge.
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

/**
 * Is a CueVerse ID available (case-insensitively), ignoring an optional player's own row?
 * The check is advisory — the UNIQUE index on cueverseIdNormalized is the real guard against
 * simultaneous claims — but it lets callers surface a clean conflict message before writing.
 */
export async function isCueverseIdAvailable(candidate: string, exceptPlayerId?: string): Promise<boolean> {
  const key = cueverseLoginKey(candidate)
  if (!key) return false
  const clash = await prisma.player.findFirst({
    where: { cueverseIdNormalized: key, ...(exceptPlayerId ? { id: { not: exceptPlayerId } } : {}) },
    select: { id: true },
  })
  return !clash
}

/**
 * Push the CueVerse ID login key onto the Payload account's `username` (the auth projection).
 * Sets req.context.allowIdentitySync so the Users guard (which otherwise rejects username edits)
 * permits it. Returns ok/false so the caller can compensate on cross-ORM failure.
 */
async function syncPayloadUsername(userId: number, loginKey: string): Promise<{ ok: boolean; conflict?: boolean }> {
  try {
    const { getPayload } = await import('payload')
    const configMod = await import('@payload-config')
    const p = await getPayload({ config: await configMod.default })
    await p.update({
      collection: 'users',
      id: userId,
      data: { username: loginKey },
      overrideAccess: true,
      context: { allowIdentitySync: true },
    })
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    return { ok: false, conflict: /unique|already|duplicate/i.test(msg) }
  }
}

/**
 * Create (or return) the Player identity for a new account, and align the account's login username
 * to the CueVerse ID. `cueverseId` defaults to the account's current username when not supplied
 * (Payload-admin-created accounts). Idempotent when a profile already exists.
 */
export async function createOrLinkAccountProfile(
  userId: number,
  username: string,
  opts: { cueverseId?: string | null } = {},
): Promise<{ ok: boolean; error?: string }> {
  const existing = await prisma.player.findUnique({ where: { linkedUserId: String(userId) } })
  if (existing) return { ok: true }
  const cueverseId = normalizeCueverseId(opts.cueverseId ?? username) || username
  const normalized = cueverseLoginKey(cueverseId)
  // Guard against claiming an identity already held by another player (case-insensitive).
  if (!(await isCueverseIdAvailable(cueverseId))) return { ok: false, error: 'That CueVerse ID is already taken.' }
  try {
    await prisma.player.create({
      data: {
        primaryName: cueverseId,
        cueverseId,
        cueverseIdNormalized: normalized,
        cueverseIdChangedAt: new Date(),
        linkedUserId: String(userId),
        linkStatus: 'VERIFIED',
        linkedAt: new Date(),
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (/unique|constraint/i.test(msg)) return { ok: false, error: 'That CueVerse ID is already taken.' }
    return { ok: false, error: 'Could not create your player identity.' }
  }
  // Keep the login projection aligned. On creation the caller has typically just set username to the
  // login key already; this makes it authoritative regardless of how the account was created.
  await syncPayloadUsername(userId, normalized)
  return { ok: true }
}

/** Update editable public identity fields (Preferred Name, Discord, Time Zone). Not an identity change. */
export async function updateProfile(
  _actor: AccountActor,
  profileId: string,
  data: { primaryName?: string; discord?: string | null; timeZone?: string | null },
): Promise<{ ok: boolean }> {
  await prisma.player.update({ where: { id: profileId }, data })
  return { ok: true }
}

export interface ChangeCueverseResult {
  ok: boolean
  error?: string
  /** Set when the change failed because the identity is already taken (for inline conflict UI). */
  conflict?: boolean
}

/**
 * Change the account's canonical CueVerse ID. This is the ONLY supported way to change identity.
 * It validates format, enforces case-insensitive uniqueness, applies the 7-day cooldown (unless an
 * admin passes override), updates the Player (display + normalized) AND the Payload login username in
 * one logical operation (with compensating rollback on cross-ORM failure), preserves the linked
 * account and every relationship (all keyed by immutable IDs), and writes an audit entry recording
 * the previous and new IDs. A case-only recasing (same normalized key) is allowed and updates the
 * displayed capitalization site-wide without colliding with the account's own identity.
 */
export async function changeCueverseId(
  actor: AccountActor,
  profileId: string,
  newIdRaw: string,
  opts: { override?: boolean; reason?: string | null } = {},
): Promise<ChangeCueverseResult> {
  const profile = await prisma.player.findUnique({ where: { id: profileId } })
  if (!profile) return { ok: false, error: 'Profile not found.' }

  const newId = normalizeCueverseId(newIdRaw)
  const formatErr = validateCueverseId(newId)
  if (formatErr) return { ok: false, error: formatErr }

  const newKey = cueverseLoginKey(newId)
  const oldId = profile.cueverseId ?? ''
  const oldKey = cueverseLoginKey(oldId)
  const caseOnly = newKey === oldKey

  // No-op: identical value (same casing too).
  if (newId === oldId) return { ok: true }

  // Cooldown applies to player-initiated changes (admins pass override). A case-only recasing is
  // treated as a normal change for cooldown purposes (no special exemption defined).
  if (!opts.override && profile.cueverseIdChangedAt) {
    const nextAllowed = new Date(profile.cueverseIdChangedAt.getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000)
    if (nextAllowed > new Date()) {
      return { ok: false, error: `You can change your CueVerse ID again after ${nextAllowed.toDateString()}.` }
    }
  }

  // Uniqueness (case-insensitive), excluding this player's own row — so a case-only recasing is allowed.
  if (!caseOnly && !(await isCueverseIdAvailable(newId, profileId))) {
    return { ok: false, error: 'That CueVerse ID is already taken.', conflict: true }
  }

  // Apply to the Player (canonical). The UNIQUE index on cueverseIdNormalized is the final guard
  // against a concurrent claim slipping between the check above and this write.
  try {
    await prisma.player.update({
      where: { id: profileId },
      data: { cueverseId: newId, cueverseIdNormalized: newKey, cueverseIdChangedAt: new Date() },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (/unique|constraint/i.test(msg)) return { ok: false, error: 'That CueVerse ID is already taken.', conflict: true }
    return { ok: false, error: 'Could not change the CueVerse ID.' }
  }

  // Mirror to the Payload login username. On a case-only recasing the key is unchanged, so this is a
  // no-op and can't conflict. If the account has no linked user (shouldn't happen for a linked
  // profile), the sync simply fails and we compensate by reverting the Player change.
  if (profile.linkedUserId) {
    const uid = Number(profile.linkedUserId)
    const sync = await syncPayloadUsername(uid, newKey)
    if (!sync.ok) {
      // Compensating rollback: keep the two stores consistent by reverting the canonical change.
      await prisma.player.update({
        where: { id: profileId },
        data: { cueverseId: oldId || null, cueverseIdNormalized: oldKey || null, cueverseIdChangedAt: profile.cueverseIdChangedAt },
      }).catch(() => {})
      return { ok: false, error: sync.conflict ? 'That CueVerse ID is already taken.' : 'Could not update the login identity — no change was made.', conflict: sync.conflict }
    }
  }

  // Immutable audit trail: previous → new, who, whether an admin override was used.
  await recordAudit(actor, {
    action: 'account.cueverseId.change',
    entity: 'Player',
    entityId: profileId,
    oldValue: { cueverseId: oldId || null },
    newValue: { cueverseId: newId, adminOverride: !!opts.override, caseOnly },
    reason: opts.reason ?? null,
  }).catch(() => {})

  return { ok: true }
}
