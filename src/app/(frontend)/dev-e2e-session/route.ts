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

/**
 * The three gates, in one place.
 *
 * Returns a response when the caller may not proceed, and nothing when they may. Written out here
 * rather than repeated because the DELETE below needs exactly the same gates: a way to remove
 * somebody's sessions is not a smaller privilege than a way to create one, and two copies of an
 * authorisation check is how one of them ends up a gate short.
 */
async function openGate(url: URL): Promise<NextResponse | null> {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }
  const expected = process.env.SITE_BUILDER_E2E_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'Not enabled.' }, { status: 404 })
  }
  const provided = url.searchParams.get('secret') ?? ''
  if (!secretMatches(provided, expected)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }
  return null
}

/**
 * The marker every session this route issues carries.
 *
 * A valid UUID prefix, so the value is still a well-formed session id, and unmistakable, so a sweep
 * can never catch a real one. Eight characters is a whole UUID group: `e2e5e551-…`.
 */
export const E2E_SESSION_PREFIX = 'e2e5e551'

export async function GET(req: Request): Promise<NextResponse> {
  const gate = await openGate(new URL(req.url))
  if (gate) return gate

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
  /*
    A recognisable identifier, so these sessions can always be found again.

    A verification run that crashes, is interrupted, or has its browser killed never reaches its own
    cleanup, and the session it created stays in the table indefinitely. Thirty-three rows where
    there had been nine is how that ends up being discovered — as a puzzle, weeks later, with no way
    to tell a test's session from somebody's real one.

    The prefix removes the puzzle. Every session this route issues starts with it; nothing else in
    the application produces one; and it is still a unique identifier, because everything after the
    prefix is random. Sessions can therefore be swept by pattern rather than by an audit of
    timestamps, and a crashed run cleans up after itself on the NEXT run rather than never.
  */
  const sid = `${E2E_SESSION_PREFIX}${crypto.randomUUID().slice(E2E_SESSION_PREFIX.length)}`
  /*
    One instant for both timestamps.

    `createdAt` and `expiresAt` were computed from two separate `Date.now()` calls, so they
    occasionally landed a millisecond apart — which showed up later as a session whose lifetime was
    999 999 999 rather than a round number, and made it fractionally harder to tell this route's
    sessions from a real sign-in. Taking the instant once removes the ambiguity at the source.
  */
  const issuedAtDate = new Date()
  const expiresAt = new Date(issuedAtDate.getTime() + (collection.config.auth.tokenExpiration ?? 7200) * 1000)
  const existing = (Array.isArray((user as { sessions?: { id?: string }[] }).sessions)
    ? (user as { sessions: { id?: string }[] }).sessions
    : [])
    /*
      Every earlier session from THIS route is dropped as the new one is created.

      Self-healing: whatever the last run left behind goes now, whether or not it ended tidily. Only
      sessions carrying the prefix are touched — a real sign-in on this machine is not this route's
      business and is left exactly alone.
    */
    .filter((session) => !String(session?.id ?? '').startsWith(E2E_SESSION_PREFIX))

  await payload.update({
    collection: 'users',
    id: user.id,
    data: { sessions: [...existing, { id: sid, createdAt: issuedAtDate.toISOString(), expiresAt: expiresAt.toISOString() }] } as never,
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

/**
 * Revoke the sessions this route created.
 *
 * Called by a verification suite when it finishes, successfully or not. It removes ONLY sessions
 * carrying the marker prefix, so it cannot log anybody out of anything they did themselves — and it
 * needs the same three gates the sign-in needs, because a way to remove somebody's sessions is not
 * a smaller privilege than a way to create one.
 *
 * `?all=1` sweeps every marked session on the account rather than one; that is what a suite calls
 * from its `finally`, and what clears up after a run that never got there.
 */
export async function DELETE(req: Request): Promise<NextResponse> {
  const url = new URL(req.url)
  const gate = await openGate(url)
  if (gate) return gate

  const { getPayload } = await import('payload')
  const config = (await import('@payload-config')).default
  const payload = await getPayload({ config })

  const email = process.env.SITE_BUILDER_E2E_EMAIL
  if (!email) return NextResponse.json({ error: 'No account is configured.' }, { status: 400 })

  const found = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
    limit: 1,
    overrideAccess: true,
    depth: 0,
  })
  const user = found.docs[0]
  if (!user) return NextResponse.json({ error: 'That account does not exist.' }, { status: 404 })

  const sessions = Array.isArray((user as { sessions?: { id?: string }[] }).sessions)
    ? (user as { sessions: { id?: string }[] }).sessions
    : []
  const sid = url.searchParams.get('sid')
  const sweepAll = url.searchParams.get('all') === '1'

  const keep = sessions.filter((session) => {
    const id = String(session?.id ?? '')
    if (!id.startsWith(E2E_SESSION_PREFIX)) return true   // never ours; never touched
    if (sweepAll) return false
    return sid ? id !== sid : true
  })
  const removed = sessions.length - keep.length

  if (removed > 0) {
    await payload.update({
      collection: 'users',
      id: user.id,
      data: { sessions: keep } as never,
      overrideAccess: true,
      context: { skipAudit: true },
    })
  }

  return NextResponse.json({ ok: true, removed, remaining: keep.length })
}
