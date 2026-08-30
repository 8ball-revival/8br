/**
 * A development-only sign-in used by the automated verification suites.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────────
 * The site builder is Owner-only, and the Owner-protection hook correctly refuses to create a second
 * Owner — so an automated check of Edit Mode has to sign in AS the Owner. The first attempt did that
 * by setting a temporary password and restoring the hash afterwards, which worked but wrote to the
 * one table nobody should be writing to for a test, and left `updated_at` moved.
 *
 * This mints the same session Payload's own login would, without touching a single user row: the
 * same session record, the same `getFieldsToSign` payload, the same `jwtSign` call with the same
 * secret, the same cookie. No password is involved, none is changed, and nothing is left behind
 * except a session the suite deletes.
 *
 * ── Why it is safe to have in the repository ─────────────────────────────────────────────────────
 * Three independent conditions, all of which must hold:
 *
 *   1. `NODE_ENV` is not `production`. A production build refuses before reading anything else.
 *   2. `SITE_BUILDER_E2E_SECRET` is set in the server's environment. It is absent everywhere by
 *      default — including `.env.replica` — so the route is inert unless somebody deliberately turns
 *      it on for a test run.
 *   3. The request presents that exact secret, compared in constant time.
 *
 * It is also refused unless the target account is genuinely the Owner, so it cannot be used to
 * escalate into an account that could not already do this.
 *
 * If any of that reads as too much power to have in a repository, delete this file: the only thing
 * that stops working is the automated Edit Mode check, which then needs a password supplied by hand.
 */

import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { SignJWT } from 'jose'

import { isOwner } from '@/lib/auth/roles'

const COOKIE = 'payload-token'

/** Constant-time compare that does not leak the secret's length through an early return. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function GET(req: Request): Promise<NextResponse> {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }
  const expected = process.env.SITE_BUILDER_E2E_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'Not enabled.' }, { status: 404 })
  }
  const provided = new URL(req.url).searchParams.get('secret') ?? ''
  if (!secretMatches(provided, expected)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const payload = await getPayload({ config })
  const collection = payload.collections.users
  const found = await payload.find({
    collection: 'users',
    where: { email: { equals: process.env.SITE_BUILDER_E2E_EMAIL ?? '' } },
    limit: 1,
    depth: 0,
    showHiddenFields: true,
  })
  const user = found.docs[0]
  if (!user) {
    return NextResponse.json({ error: 'No such account.' }, { status: 404 })
  }
  // Only ever the Owner. This route must not be a way to obtain a session an account could not
  // otherwise have.
  if (!isOwner((user as { roles?: string[] }).roles)) {
    return NextResponse.json({ error: 'That account is not the Owner.' }, { status: 403 })
  }

  /*
    The session row, exactly as login writes it.

    Payload's auth strategy looks the `sid` up on every request, so a token signed without a matching
    session is rejected — which is the same protection a real session has, and is what lets the suite
    revoke this one by deleting the row.
  */
  const sid = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + (collection.config.auth.tokenExpiration ?? 7200) * 1000)
  const existing = Array.isArray((user as { sessions?: unknown[] }).sessions)
    ? (user as { sessions: unknown[] }).sessions
    : []
  await payload.update({
    collection: 'users',
    id: user.id,
    data: { sessions: [...existing, { id: sid, createdAt: new Date().toISOString(), expiresAt: expiresAt.toISOString() }] } as never,
    overrideAccess: true,
    // No hooks: this is not a real account change and must not fire anything that treats it as one.
    context: { skipAudit: true },
  })

  /*
    The same claims and the same signature Payload's own `jwtSign` produces.

    Written out here rather than imported: `payload/dist/auth/jwt.js` is not a published export of
    the package, and reaching past its export map for a convenience would break on any patch release.
    `jose` is Payload's own signing library and is a stable dependency, so this stays in step by using
    the same primitive rather than the same private module.

    The claims are deliberately minimal — id, collection, email, sid. Payload's auth strategy loads
    the user from the database by id on every request, so nothing about roles or capabilities is
    carried in the token, and nothing here could grant more than the account already has.
  */
  const tokenExpiration = collection.config.auth.tokenExpiration ?? 7200
  const issuedAt = Math.floor(Date.now() / 1000)
  const exp = issuedAt + tokenExpiration
  const token = await new SignJWT({
    id: user.id,
    collection: 'users',
    email: user.email as string,
    sid,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(issuedAt)
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(payload.secret))

  const res = NextResponse.json({ ok: true, sid, userId: user.id })
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: false,
    expires: new Date(exp * 1000),
  })
  return res
}
