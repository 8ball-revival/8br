import crypto from 'node:crypto'

/**
 * Pure authorization + temp-code crypto for admin-initiated password resets. No I/O, no server-only
 * imports — unit-testable and safe to import anywhere.
 *
 * Security model: the 5-digit code is set as the account's Payload password, so the PRIMARY brute-force
 * protection is Payload's own salted pbkdf2 hash + login-attempt lockout. The reset-state row stores
 * only a KEYED HMAC of the code (never a bare/reversible SHA-256), so even a DB reader cannot recover
 * or cheaply brute-force a low-entropy code without the server secret. Verification is constant-time.
 */
export type TargetTier = 'member' | 'admin' | 'headAdmin'

export const RESET_TTL_MS = 15 * 60 * 1000 // temp code lifetime
export const TEMP_ATTEMPT_LIMIT = 5 // failed permanent-set / verify attempts before the code is dead

export function canResetTarget(actor: { isAdmin: boolean; isOwner: boolean; isHeadAdmin: boolean }, tier: TargetTier): { ok: boolean; error?: string } {
  if (!actor.isAdmin && !actor.isOwner) return { ok: false, error: 'Only staff may reset passwords.' }
  if (tier === 'headAdmin') return { ok: false, error: 'The Head Admin password cannot be reset here — use secure self-service recovery.' }
  if (tier === 'admin' && !actor.isHeadAdmin) return { ok: false, error: 'Only the Head Admin may reset an Admin password.' }
  return { ok: true }
}

/** Keyed HMAC-SHA256 of the code (hex). Requires a server secret; never store a bare hash of the code. */
export function hmacCode(code: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(code).digest('hex')
}

/** Constant-time comparison of a candidate code against a stored HMAC. */
export function verifyCodeHmac(code: string, storedHmac: string, secret: string): boolean {
  const candidate = Buffer.from(hmacCode(code, secret), 'hex')
  let stored: Buffer
  try { stored = Buffer.from(storedHmac, 'hex') } catch { return false }
  if (candidate.length !== stored.length || stored.length === 0) return false
  return crypto.timingSafeEqual(candidate, stored)
}

export function isResetExpired(expiresAt: Date, now: number): boolean {
  return expiresAt.getTime() <= now
}

export function attemptLimitExceeded(attempts: number, limit = TEMP_ATTEMPT_LIMIT): boolean {
  return attempts >= limit
}

/** Crypto-secure 5-digit numeric code (00000–99999). */
export function generateTempCode(): string {
  return String(crypto.randomInt(0, 100000)).padStart(5, '0')
}
