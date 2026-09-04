import { NextResponse, type NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

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
 * It does NOT decide whether the account behind a valid token is banned, deleted or disabled —
 * that needs a query, and the edge runtime has no database. `requireViewer()` in the frontend
 * layout does it, on the server, before the page renders. So the two layers are:
 *
 *   this file  — is there a real, current session at all?  (every request, cheap, no I/O)
 *   requireViewer — is the account behind it allowed in?   (protected documents, authoritative)
 *
 * Neither is decorative. Strip the layout guard and a banned member keeps browsing until their
 * token expires; strip this and every protected route has to remember to guard itself.
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
    /* `jwtVerify` checks the signature AND `exp`, so an expired session fails here, not later. */
    await jwtVerify(token, await signingKey(secret), { algorithms: ['HS256'] })
    return true
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

export async function middleware(request: NextRequest) {
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
