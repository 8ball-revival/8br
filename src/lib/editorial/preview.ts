import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Signed preview links.
 *
 * An author who wants a second opinion before submitting needs to show somebody the article, and
 * that somebody may not have an account. A signed link solves it without weakening the permission
 * model: the token names one article and one expiry, is signed with the application secret, and
 * grants read access to nothing else.
 *
 * Three properties matter and all three are structural rather than conventional. The token cannot be
 * altered (any change breaks the signature), it cannot outlive its expiry (the expiry is inside the
 * signed material), and it cannot be probed one byte at a time (comparison is constant-time).
 */

const DEFAULT_TTL_HOURS = 72

function secret(): string {
  const value = process.env.PAYLOAD_SECRET
  // Refusing to mint a token is the right failure: a preview link signed with a guessable key would
  // be worse than no preview link at all.
  if (!value) throw new Error('PAYLOAD_SECRET is required to sign preview links.')
  return value
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

/** Mint a token for one article. */
export function createPreviewToken(articleId: number, ttlHours = DEFAULT_TTL_HOURS): string {
  const expires = Date.now() + ttlHours * 3600 * 1000
  const payload = `${articleId}.${expires}`
  return `${payload}.${sign(payload)}`
}

/**
 * Read a token, or null.
 *
 * Returns null for every kind of failure — wrong shape, bad signature, expired — without saying
 * which. A caller cannot tell a forged token from an expired one, and does not need to.
 */
export function readPreviewToken(token: string): { articleId: number } | null {
  if (typeof token !== 'string' || token.length > 200) return null

  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [rawId, rawExpires, signature] = parts

  const articleId = Number.parseInt(rawId, 10)
  const expires = Number.parseInt(rawExpires, 10)
  if (!Number.isInteger(articleId) || articleId <= 0) return null
  if (!Number.isInteger(expires)) return null

  let expected: string
  try {
    expected = sign(`${rawId}.${rawExpires}`)
  } catch {
    return null
  }

  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  // Length is checked first because timingSafeEqual throws on a mismatch; the length of a signature
  // is not a secret.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  // Expiry is checked last, so a forged token and an expired one take the same path.
  if (expires <= Date.now()) return null

  return { articleId }
}
