import 'server-only'
import { getPayload } from 'payload'
import config from '@payload-config'
import { prisma } from '@/lib/prisma'
import { recordAudit } from '@/lib/competition/audit'
import { isAdmin } from '@/lib/auth/roles'
import type { StaffUser } from '@/lib/competition/staff-auth'
import { canResetTarget, hmacCode, isResetExpired, attemptLimitExceeded, generateTempCode, RESET_TTL_MS, type TargetTier } from './reset-authz'

export { canResetTarget, type TargetTier }

/** Server secret that keys the temp-code HMAC (never exposed). Falls back to a derived constant only
 *  so non-configured environments still function; production always has PAYLOAD_SECRET. */
const resetSecret = () => process.env.RESET_HMAC_SECRET || process.env.PAYLOAD_SECRET || 'wcc-reset-fallback-key'

/**
 * ADMIN-INITIATED PASSWORD RESET.
 * An Admin/Head-Admin generates a one-time 5-digit numeric code for a player. The code becomes the
 * player's Payload password (Payload hashes it), every existing session is revoked, and a Prisma-side
 * PasswordResetState row records a forced permanent-password change with a 15-minute expiry. The code
 * is shown to the actor exactly once (never persisted in plaintext; never logged). On the player's
 * next sign-in the forced-change gate sends them to set a permanent password, which clears the state.
 *
 * Permissions: Admins may reset MEMBERS. Head Admin may reset Members + Admins. NO ONE may reset the
 * Head Admin through this portal (they use the established self-service / infrastructure recovery).
 */

const payloadClient = async () => getPayload({ config: await config })

/** The role tier of a target user (for permission decisions + UI). */
export async function targetTier(userId: number): Promise<TargetTier> {
  const roles = (await prisma.$queryRawUnsafe<{ value: string }[]>(
    'SELECT value FROM payload.users_roles WHERE parent_id = $1',
    userId,
  )).map((r) => r.value)
  const d = await prisma.staffDesignation.findUnique({ where: { userId }, select: { headAdmin: true } })
  if (d?.headAdmin) return 'headAdmin'
  return isAdmin(roles) ? 'admin' : 'member'
}

export interface ResetResult { ok: boolean; error?: string; code?: string; expiresAt?: string }

export async function resetPlayerPassword(actor: StaffUser, targetUserId: number, reason?: string): Promise<ResetResult> {
  const target = await prisma.$queryRawUnsafe<{ id: number; username: string | null; email: string | null }[]>(
    'SELECT id, username, email FROM payload.users WHERE id = $1',
    targetUserId,
  )
  if (!target.length) return { ok: false, error: 'Player not found.' }

  const tier = await targetTier(targetUserId)
  const authz = canResetTarget(actor, tier)
  if (!authz.ok) return { ok: false, error: authz.error }

  // Crypto-secure one-time 5-digit numeric code.
  const code = generateTempCode()
  const expiresAt = new Date(Date.now() + RESET_TTL_MS)

  const p = await payloadClient()
  // Set the code as the account password (Payload salts + hashes it) with elevated access.
  await p.update({ collection: 'users', id: targetUserId, data: { password: code }, overrideAccess: true })

  // Revoke every existing session for the target, then record the forced-change state.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('DELETE FROM payload.users_sessions WHERE _parent_id = $1', targetUserId)
    const codeHmac = hmacCode(code, resetSecret())
    await tx.passwordResetState.upsert({
      where: { userId: targetUserId },
      create: { userId: targetUserId, forceChange: true, tempCodeHash: codeHmac, expiresAt, attempts: 0, issuedByUser: actor.userId },
      update: { forceChange: true, tempCodeHash: codeHmac, expiresAt, attempts: 0, issuedByUser: actor.userId },
    })
    // Audit — records WHO/WHOM/WHEN/why + that sessions were revoked. NEVER the code itself.
    await recordAudit(actor, {
      action: 'account.password.reset',
      entity: 'User',
      entityId: targetUserId,
      newValue: { forcedChange: true, sessionsRevoked: true, expiresAt: expiresAt.toISOString(), targetTier: tier },
      reason: reason?.trim() || undefined,
    }, tx)
  })

  return { ok: true, code, expiresAt: expiresAt.toISOString() }
}

/** Sign-in gate: what to do about a pending admin reset for this user (called after Payload auth). */
export async function pendingResetGate(userId: number): Promise<{ expired: boolean; forceChange: boolean }> {
  const state = await prisma.passwordResetState.findUnique({ where: { userId } })
  if (!state) return { expired: false, forceChange: false }
  // Expired temp code OR too many failed attempts → block normal access (reject the sign-in).
  if (isResetExpired(state.expiresAt, Date.now()) || attemptLimitExceeded(state.attempts)) {
    return { expired: true, forceChange: true }
  }
  return { expired: false, forceChange: state.forceChange }
}

/** True when the signed-in user still owes a permanent password (drives the /account/set-password gate). */
export async function needsPermanentPassword(userId: number): Promise<boolean> {
  const state = await prisma.passwordResetState.findUnique({ where: { userId }, select: { forceChange: true } })
  return !!state?.forceChange
}

/** Complete the forced change: set the permanent password and clear the reset state (one-time use). */
export async function completeForcedPasswordChange(userId: number, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  const state = await prisma.passwordResetState.findUnique({ where: { userId } })
  if (!state) return { ok: false, error: 'No pending password change.' }
  if (attemptLimitExceeded(state.attempts)) return { ok: false, error: 'Too many attempts — ask an administrator for a new code.' }
  if (isResetExpired(state.expiresAt, Date.now())) {
    // Expired: retire the dead state so the code can never be used again.
    await prisma.passwordResetState.delete({ where: { userId } }).catch(() => {})
    return { ok: false, error: 'Your temporary code has expired — ask an administrator for a new one.' }
  }
  const p = await payloadClient()
  await p.update({ collection: 'users', id: userId, data: { password: newPassword }, overrideAccess: true })
  await prisma.passwordResetState.delete({ where: { userId } }).catch(() => {}) // one-time: state gone after use
  return { ok: true }
}

/** Record a failed temp-code attempt (brute-force guard). Returns whether the code is now dead. */
export async function recordFailedResetAttempt(userId: number): Promise<{ dead: boolean }> {
  const state = await prisma.passwordResetState.findUnique({ where: { userId } })
  if (!state) return { dead: true }
  const attempts = state.attempts + 1
  await prisma.passwordResetState.update({ where: { userId }, data: { attempts } })
  return { dead: attemptLimitExceeded(attempts) }
}
