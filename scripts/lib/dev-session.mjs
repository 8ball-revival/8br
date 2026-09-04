/**
 * A real session for the local verification suites, now that the site is private.
 *
 * ── Why the suites need this at all ──────────────────────────────────────────────────────────────
 * Every suite that drives a browser or fetches a page used to be an anonymous visitor, because the
 * site answered anonymous visitors. It does not any more. Rather than weaken the wall with a
 * development bypass — a switch that exists solely to be left on by accident — the suites
 * authenticate the same way a person does: with a session Payload will accept.
 *
 * ── Why it writes a session row ──────────────────────────────────────────────────────────────────
 * A signed token alone gets past the middleware and no further: Payload looks the `sid` up on every
 * request, so a token without a matching session is rejected by the layout guard. Minting the row as
 * well is what makes this a genuine sign-in rather than a way of testing half the wall.
 *
 * Every session created here carries a marker prefix and is removed by `revokeDevSessions()`, which
 * a caller should run in a `finally` so an interrupted suite cleans up on the next run.
 */
import { createHash, randomUUID } from 'node:crypto'

import { PrismaClient } from '@prisma/client'
import { SignJWT } from 'jose'

export const DEV_SESSION_PREFIX = 'verify-suite-'

/** Payload signs with sha256(secret) as hex, truncated to 32 — not with the raw secret. */
function derivedSecret() {
  const raw = process.env.PAYLOAD_SECRET
  if (!raw) throw new Error('PAYLOAD_SECRET is required to mint a verification session')
  return createHash('sha256').update(raw).digest('hex').slice(0, 32)
}

/**
 * Mint a session for the Owner, or for a named account.
 *
 * The Owner by default because the visual suites photograph pages that only an Owner can open; a
 * suite that needs an ordinary member's view can name one.
 */
export async function mintDevSession({ email } = {}) {
  const prisma = new PrismaClient()
  try {
    const rows = email
      ? await prisma.$queryRaw`SELECT id, email FROM payload.users WHERE email = ${email} LIMIT 1`
      : await prisma.$queryRaw`
          SELECT u.id, u.email FROM payload.users u
          JOIN payload.users_roles r ON r.parent_id = u.id AND r.value::text = 'owner'
          ORDER BY u.id ASC LIMIT 1`
    if (!rows.length) throw new Error(`No account found${email ? ` for ${email}` : ' with the owner role'}`)
    const user = rows[0]

    const sid = `${DEV_SESSION_PREFIX}${randomUUID()}`
    const now = new Date()
    const ttl = 7200
    const expiresAt = new Date(now.getTime() + ttl * 1000)
    const order = await prisma.$queryRaw`
      SELECT COALESCE(MAX(_order), 0) + 1 AS n FROM payload.users_sessions WHERE _parent_id = ${user.id}`
    await prisma.$executeRaw`
      INSERT INTO payload.users_sessions (_order, _parent_id, id, created_at, expires_at)
      VALUES (${Number(order[0].n)}, ${user.id}, ${sid}, ${now}, ${expiresAt})`

    const iat = Math.floor(now.getTime() / 1000)
    const token = await new SignJWT({ id: user.id, collection: 'users', email: user.email, sid })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt(iat)
      .setExpirationTime(iat + ttl)
      .sign(new TextEncoder().encode(derivedSecret()))

    return { cookie: `payload-token=${token}`, token, sid, userId: user.id, email: user.email }
  } finally {
    await prisma.$disconnect()
  }
}

/** Remove every session this helper has ever created. Never touches a real sign-in. */
export async function revokeDevSessions() {
  const prisma = new PrismaClient()
  try {
    return await prisma.$executeRaw`
      DELETE FROM payload.users_sessions WHERE id LIKE ${`${DEV_SESSION_PREFIX}%`}`
  } catch {
    return 0
  } finally {
    await prisma.$disconnect()
  }
}
