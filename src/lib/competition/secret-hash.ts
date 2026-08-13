import 'server-only'
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Generic scrypt hashing for short shared secrets (tournament access passwords, per-team join
 * codes). Stored as a self-describing `scrypt$<saltHex>$<hashHex>` string; the plaintext is never
 * persisted, logged, displayed after creation, or placed in a URL. Each caller stores its hash in
 * its OWN column so the concepts stay separate (a team join code is never a tournament password).
 */
const N = 16384
const KEYLEN = 32

export function hashSecret(plain: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(plain, salt, KEYLEN, { N })
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

/** Constant-time verify. Returns false for any malformed stored value. */
export function verifySecret(plain: string, stored: string | null | undefined): boolean {
  if (!stored) return false
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  try {
    const salt = Buffer.from(parts[1], 'hex')
    const expected = Buffer.from(parts[2], 'hex')
    const actual = scryptSync(plain, salt, expected.length, { N })
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}
