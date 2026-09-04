import { NextResponse, type NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

import { readSessionStanding } from '@/lib/auth/account-standing'

import {
  PATHNAME_HEADER,
  SEARCH_HEADER,
  isDataPath,
  isPublicPath,
  privateAccessTarget,
} from '@/lib/auth/site-privacy'

/**
 * The privacy wall.
 *
 * Next 16 calls this file `proxy.ts` — the former `middleware.ts` — and it always runs on the
 * Node.js runtime, which is what makes the database check below possible at all. A `runtime` segment
 * config is rejected here for that reason: there is nothing to choose.
 *
 * The whole site is private. This runs before any route is matched, so a protected page is never
 * rendered, never streamed, and never briefly visible — there is no client-side redirect and no
 * hidden component anywhere in this design. A logged-out visitor's request is answered here or not
 * at all.
 *
 * ── What this checks, and what it deliberately does not ──────────────────────────────────────────
 * A cryptographic check on the session token: correct signature, unexpired, issued by this
 * deployment. That is everything that can be decided without a database, and it is enough to answer
 * the request.
 *
 * It then asks the database two questions that a signature cannot answer: is the session named in
 * the token still there, and is the account behind it still allowed in?
 *
 * ── Why that check lives HERE and not only in the layout ─────────────────────────────────────────
 * It used to be in the frontend layout alone, which meant it only ran when a PAGE rendered. A direct
 * request to `/api/…` never passes through a layout — so a member banned a minute ago, or one whose
 * session had been revoked, still held a valid token and could read straight out of Payload's REST
 * and GraphQL endpoints. Payload's own access rules did not cover it either: `media` and both
 * globals are `read: () => true`.
 *
 * So the account check moved to the one place every protected request passes through, whatever it
 * is — page, Server Action, route handler, REST, GraphQL, export, feed. It needs the database, and
 * a proxy file has one.
 *
 * The layout guard stays as defence in depth. It is no longer the only thing standing between a
 * banned account and the data.
 *
 * ── Why the token is verified rather than merely present ─────────────────────────────────────────
 * Checking that a cookie called `payload-token` exists is not a check. Anyone can set that cookie
 * to any value. Verifying the signature means the only way past this line is a token this server
 * actually issued.
 */

/** Payload's cookie. One session system for the whole site; there is no second one. */
const SESSION_COOKIE = 'payload-token'

/**
 * Payload does not sign with the raw secret.
 *
 * `payload.secret` is `sha256(PAYLOAD_SECRET)` as hex, truncated to 32 characters — see
 * `this.secret = ...` in payload's entry module. Signing with the raw value here would reject every
 * genuine session, and the failure would look exactly like "nobody is logged in", which is the most
 * expensive kind of wrong to debug. Derived with Web Crypto so this file runs on the edge runtime.
 */
let cachedKey: { raw: string; key: Uint8Array } | null = null
async function signingKey(raw: string): Promise<Uint8Array> {
  if (cachedKey && cachedKey.raw === raw) return cachedKey.key
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  const key = new TextEncoder().encode(hex.slice(0, 32))
  cachedKey = { raw, key }
  return key
}

async function hasValidSession(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (!token) return false
  const secret = process.env.PAYLOAD_SECRET
  /*
    No secret configured means no token can be verified, so nothing is let through.

    Failing closed matters more than it looks: a missing environment variable is exactly the
    condition under which a wall like this would otherwise silently stop being a wall.
  */
  if (!secret) return false
  try {
    /* `jwtVerify` checks the signature AND `exp`, so an expired token fails here, not later. */
    const { payload: claims } = await jwtVerify(token, await signingKey(secret), { algorithms: ['HS256'] })

    /*
      A correct signature proves the token was issued here. It proves nothing about NOW.

      The session may have been revoked and the account may have been banned since it was signed,
      and both must take effect immediately rather than when the token happens to expire. `sid` is
      the session Payload itself looks up on every request; checking the same row means a revoked
      session stops working here exactly when it stops working there.
    */
    const userId = Number(claims.id)
    const sid = typeof claims.sid === 'string' ? claims.sid : ''
    const standing = await readSessionStanding(userId, sid)
    return standing.ok
  } catch {
    return false
  }
}

/** Nothing behind the wall may be indexed, stored by a shared cache, or kept by a browser. */
function applyPrivacyHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex')
  /*
    `private` is the load-bearing word.

    The site was public until now, so a CDN and any intermediary may still be holding pages that
    used to be served to everybody. `private, no-store` says this response belongs to one reader and
    must not be written to a shared cache; `must-revalidate` stops a stored copy being reused after
    a session ends.
  */
  response.headers.set('Cache-Control', 'private, no-store, max-age=0, must-revalidate')
  response.headers.set('Vary', 'Cookie')
  return response
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const dev = process.env.NODE_ENV !== 'production'

  /*
    The pathname, forwarded to the app.

    A layout cannot ask which URL it is rendering, and it needs to know: the frontend layout is
    shared by the private-access page and by every protected page, so it has to tell them apart to
    avoid guarding the very page it redirects to. Set from `request.nextUrl` — never copied from an
    incoming header, which a client could forge to name an allowlisted path.
  */
  const forward = new Headers(request.headers)
  forward.set(PATHNAME_HEADER, pathname)
  /* The query as well, so the layout can read `returnTo` when it sends a signed-in visitor onward. */
  forward.set(SEARCH_HEADER, search)

  if (isPublicPath(pathname, { dev })) {
    /* Public, but still not indexable and still not cacheable by anything shared. */
    return applyPrivacyHeaders(NextResponse.next({ request: { headers: forward } }))
  }

  if (await hasValidSession(request)) {
    return applyPrivacyHeaders(NextResponse.next({ request: { headers: forward } }))
  }

  if (isDataPath(pathname)) {
    /*
      A fetch gets a fetch's answer.

      One shape for every protected path, carrying no detail: not whether the route exists, not
      whether a record behind it exists, not why the request failed. A caller learns that they are
      not authenticated and nothing else.
    */
    return applyPrivacyHeaders(NextResponse.json(
      { error: 'unauthorized' },
      { status: 401, headers: { 'WWW-Authenticate': 'Session' } },
    ))
  }

  const target = new URL(privateAccessTarget(pathname, search), request.nextUrl.origin)
  return applyPrivacyHeaders(NextResponse.redirect(target, 307))
}

/**
 * What the wall runs on: everything.
 *
 * The matcher excludes only `_next/static`, because a build asset has no request-time meaning and
 * excluding it here saves an invocation on every hashed file. `_next/image` is NOT excluded — it is
 * a proxy that will return local media to whoever asks — and neither is anything else. The
 * allowlist above, not this matcher, is where public routes are decided; keeping the matcher wide
 * means a mistake there fails closed.
 */
export const config = {
  matcher: ['/((?!_next/static).*)'],
}
