import 'server-only'
import { cookies } from 'next/headers'
import { scryptSync, timingSafeEqual, createHmac } from 'node:crypto'

/**
 * BREAK-GLASS RECOVERY AUTH.
 *
 * A private, env-gated operator credential that is deliberately NOT a row in the `users`
 * table — so it can never surface in /users, the Staff list, or the Payload /admin UI. Its
 * only power (transferring ownership away from a rogue Owner) is exercised in actions.ts and
 * is ALWAYS written to the audit log. This module is purely the credential + session layer.
 *
 * The feature is INERT unless BOTH RECOVERY_USERNAME and RECOVERY_PASSWORD_HASH are set; if
 * either is missing the route 404s and none of these helpers grant access.
 */

const COOKIE = '8br_recovery'
const SESSION_TTL_MS = 20 * 60 * 1000 // ~20 minutes

/** Both env vars present and non-empty. When false the whole feature is disabled. */
export function isRecoveryEnabled(): boolean {
  return Boolean((process.env.RECOVERY_USERNAME || '').trim()) && Boolean((process.env.RECOVERY_PASSWORD_HASH || '').trim())
}

/** Constant-time buffer equality that never throws and is safe for differing lengths. */
function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    // Still burn a comparison against a same-length copy to avoid a trivial length-timing oracle.
    try {
      timingSafeEqual(a, Buffer.alloc(a.length))
    } catch {
      /* ignore */
    }
    return false
  }
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/**
 * Verify the operator credential. Username is compared constant-time to RECOVERY_USERNAME;
 * the password is scrypt-hashed with the stored salt and compared constant-time to the stored
 * hash. Never throws on mismatch or malformed input — returns false.
 */
export function verifyRecoveryCredentials(username: string, password: string): boolean {
  if (!isRecoveryEnabled()) return false
  const expectedUser = (process.env.RECOVERY_USERNAME || '').trim()
  const stored = (process.env.RECOVERY_PASSWORD_HASH || '').trim()

  const userOk = safeEqual(Buffer.from(username ?? '', 'utf8'), Buffer.from(expectedUser, 'utf8'))

  // Stored format: "<saltHex>:<hashHex>" — 16-byte salt, 64-byte scrypt key.
  const parts = stored.split(':')
  if (parts.length !== 2) return false
  let passOk = false
  try {
    const salt = Buffer.from(parts[0], 'hex')
    const expected = Buffer.from(parts[1], 'hex')
    if (salt.length === 0 || expected.length === 0) return false
    const actual = scryptSync(password ?? '', salt, expected.length)
    passOk = safeEqual(actual, expected)
  } catch {
    passOk = false
  }
  // Combine without short-circuiting so both checks always run.
  return userOk && passOk
}

// --------------------------------------------------------------------------- Signed session cookie

function secret(): string {
  return process.env.PAYLOAD_SECRET || ''
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('hex')
}

function encodeSession(exp: number): string {
  const body = Buffer.from(JSON.stringify({ exp }), 'utf8').toString('base64url')
  return `${body}.${sign(body)}`
}

/** Issue a signed recovery session cookie (httpOnly, Secure, SameSite=Strict, ~20 min). */
export async function setRecoverySession(): Promise<void> {
  const exp = Date.now() + SESSION_TTL_MS
  const store = await cookies()
  store.set(COOKIE, encodeSession(exp), {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/recovery',
    expires: new Date(exp),
  })
}

/** Validate the signature and expiry of the current recovery session cookie. */
export async function readRecoverySession(): Promise<boolean> {
  if (!isRecoveryEnabled()) return false
  const store = await cookies()
  const raw = store.get(COOKIE)?.value
  if (!raw) return false
  const dot = raw.lastIndexOf('.')
  if (dot <= 0) return false
  const body = raw.slice(0, dot)
  const sig = raw.slice(dot + 1)
  const expectedSig = sign(body)
  if (!safeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expectedSig, 'utf8'))) return false
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { exp?: number }
    if (typeof parsed.exp !== 'number') return false
    return parsed.exp > Date.now()
  } catch {
    return false
  }
}

/** Clear the recovery session cookie. */
export async function clearRecoverySession(): Promise<void> {
  const store = await cookies()
  store.delete(COOKIE)
}
