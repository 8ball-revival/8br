/**
 * The privacy wall: which paths a logged-out visitor may reach, and what they get if they do not.
 *
 * ── Why this is a module and not a list inside the middleware ────────────────────────────────────
 * Two callers have to agree exactly. The middleware decides whether a request is answered at all,
 * and the frontend layout decides whether a page renders — and if their idea of "public" ever
 * differs by one path, the disagreement is either a hole or a redirect loop. Both import this.
 *
 * It is also pure, so the allowlist can be asserted directly by the test suite rather than inferred
 * from a running server.
 *
 * ── Deny by default ──────────────────────────────────────────────────────────────────────────────
 * There is no list of protected routes anywhere. Everything is protected; this file names the few
 * exceptions. A route added tomorrow inherits the wall because nobody has to remember to add it.
 */

/** Where a logged-out visitor is sent. */
export const PRIVATE_ACCESS_PATH = '/private-access'

/** The header the middleware writes the resolved pathname into, for the layout to read back. */
export const PATHNAME_HEADER = 'x-8br-pathname'

/** The query string alongside it, so the layout can honour `returnTo` on the door. */
export const SEARCH_HEADER = 'x-8br-search'

/**
 * Exactly-matched public paths.
 *
 * Exact rather than prefixed: a prefix test on `/login` also admits `/login-anything`, and the
 * whole value of a narrow allowlist is that it cannot be widened by a near miss.
 */
const PUBLIC_EXACT = new Set<string>([
  PRIVATE_ACCESS_PATH,
  /* The existing sign-in page and its Server Action, which POSTs back to this same path. */
  '/login',
  /* The password-reset flow, which already existed. Requesting a link must work while logged out. */
  '/reset-password',
  /* Files a browser or crawler asks for by fixed name. None of them carries site data. */
  '/favicon.ico',
  '/icon.png',
  '/robots.txt',
  '/manifest.webmanifest',
])

/**
 * Public path prefixes, matched as whole segments.
 *
 * `/api/cron` matches `/api/cron` and `/api/cron/anything`, never `/api/cronies`.
 */
const PUBLIC_PREFIXES: string[] = [
  /*
    Build output only: hashed JS and CSS.

    NOT `/_next` as a whole. `/_next/image` is an image proxy that will fetch and return any local
    file it is pointed at, which would hand out uploaded media — avatars, article art — to anyone
    who guessed a path. Authenticated readers reach it normally, because their request carries the
    session and never gets this far.
  */
  '/_next/static',

  /*
    Payload's own authentication endpoints.

    The admin panel signs in through these rather than through the site's Server Action, so blocking
    them would leave an administrator unable to authenticate anywhere. They are the authentication
    submission endpoints the allowlist is explicitly for. Everything else under `/api/users` — the
    collection reads that would list accounts — stays protected.
  */
  '/api/users/login',
  '/api/users/logout',
  '/api/users/refresh-token',
  '/api/users/forgot-password',
  '/api/users/reset-password',

]

/**
 * Scheduled jobs, named one by one rather than by prefix.
 *
 * These carry their own bearer secret and never a session cookie, so putting them behind the wall
 * would simply stop the crons — Vercel does not have a session. They are open to the WALL, not to
 * the world: each handler validates a dedicated secret in constant time as the first statement of
 * the handler, before it reads anything or does any work, and refuses outright when the secret is
 * unset. Both were audited against exactly that.
 *
 * Listed exactly, and this is the point. `/api/cron` as a prefix would hand a blanket exemption to
 * any cron route added later, including one whose author forgot to check a secret — which is the
 * deny-by-default rule failing inside the allowlist, the one place it would not be noticed. A new
 * job has to be added here, and adding it means someone looked at it.
 *
 * These two are the entries in `vercel.json`. If a schedule is added there, it belongs here too.
 */
const CRON_EXACT: string[] = [
  '/api/cron/cueverse',
  '/api/cron/site-builder-schedule',
]

/**
 * Development-only public paths.
 *
 * `dev-e2e-session` mints a session for the automated suites. It already refuses in production, and
 * refuses without a secret — but it is also excluded from the allowlist there, so the wall does not
 * depend on that route's own guard being correct.
 */
const DEV_ONLY_PREFIXES: string[] = ['/dev-e2e-session']

/**
 * Paths whose answer is data rather than a document.
 *
 * These get a 401 instead of a redirect. A redirect to an HTML page is the wrong answer to a fetch:
 * the caller either parses the login page as if it were the payload, or follows it and caches it.
 */
const DATA_PREFIXES: string[] = ['/api']
const DATA_EXACT = new Set<string>([
  '/sitemap.xml',
  '/rankings/export',
  '/news/feed.xml',
  '/news/atom.xml',
])

/** Whole-segment prefix test: `/a/b` matches `/a/b` and `/a/b/c`, never `/a/bc`. */
function underPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

/**
 * Normalise a pathname before any decision is made about it.
 *
 * A trailing slash and a doubled slash are the same route to Next and must be the same route to the
 * wall, or `/login/` is protected while `/login` is not — which is a redirect loop for anyone who
 * types the slash. Anything containing a `..` segment is refused outright rather than resolved:
 * this runs before the router, and guessing at traversal is how an allowlist gets walked out of.
 */
export function normalisePath(pathname: string): string | null {
  if (!pathname.startsWith('/')) return null
  if (pathname.includes('..')) return null
  const collapsed = pathname.replace(/\/{2,}/g, '/')
  const trimmed = collapsed.length > 1 ? collapsed.replace(/\/+$/, '') : collapsed
  return trimmed === '' ? '/' : trimmed
}

/** Whether a logged-out visitor may be served this path at all. */
export function isPublicPath(pathname: string, opts: { dev?: boolean } = {}): boolean {
  const path = normalisePath(pathname)
  if (path == null) return false
  if (PUBLIC_EXACT.has(path)) return true
  if (CRON_EXACT.includes(path)) return true
  if (PUBLIC_PREFIXES.some((p) => underPrefix(path, p))) return true
  if (opts.dev && DEV_ONLY_PREFIXES.some((p) => underPrefix(path, p))) return true
  return false
}

/** Whether an unauthenticated request here should be answered with 401 rather than a redirect. */
export function isDataPath(pathname: string): boolean {
  const path = normalisePath(pathname)
  if (path == null) return false
  if (DATA_EXACT.has(path)) return true
  return DATA_PREFIXES.some((p) => underPrefix(path, p))
}

/**
 * Where to send a logged-out visitor, carrying where they were going.
 *
 * Only the path and query are kept, and only from the request's own URL — never from a parameter a
 * visitor supplied — so there is nothing here for an open redirect to travel in. `safeReturnTo`
 * checks it again on the way back out, because the value survives a round trip through a URL that
 * anyone can edit in the address bar.
 */
export function privateAccessTarget(pathname: string, search = ''): string {
  const path = normalisePath(pathname) ?? '/'
  /* Sending somebody back to the page they were already sent away from is the loop. */
  if (path === PRIVATE_ACCESS_PATH || path === '/login') return PRIVATE_ACCESS_PATH
  const returnTo = `${path}${search || ''}`
  if (returnTo === '/') return PRIVATE_ACCESS_PATH
  return `${PRIVATE_ACCESS_PATH}?returnTo=${encodeURIComponent(returnTo)}`
}

/** The allowlist, for the test suite and for the report. Order is presentation only. */
export const PUBLIC_ALLOWLIST = {
  exact: [...PUBLIC_EXACT].sort(),
  cron: [...CRON_EXACT].sort(),
  prefixes: [...PUBLIC_PREFIXES].sort(),
  devOnlyPrefixes: [...DEV_ONLY_PREFIXES],
} as const
