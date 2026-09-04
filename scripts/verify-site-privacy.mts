/**
 * The privacy wall, checked against a running server rather than against the source.
 *
 * ── Why this is an HTTP suite ────────────────────────────────────────────────────────────────────
 * A wall that is asserted by reading the code proves the code says what it says. What matters here
 * is what an unauthenticated stranger actually receives, so almost every check below is a real
 * request to the dev server with a real (or deliberately forged) cookie, reading the real status,
 * headers and body.
 *
 * The sessions are real too. Payload rejects a signed token whose `sid` has no session row, so a
 * test that only signed a JWT would prove the middleware and nothing beyond it. These are minted by
 * writing the session row the way a sign-in writes it and signing the same claims — which means the
 * authenticated cases exercise `payload.auth` and the layout guard, not a stub.
 *
 * Every session created here carries a marker prefix and is deleted in `finally`, including after a
 * failure. Nothing else on the account is touched.
 *
 * Requires the dev server on :3000 and DATABASE_URL/PAYLOAD_SECRET in the environment.
 */
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { PrismaClient } from '@prisma/client'
import { SignJWT } from 'jose'

import {
  PRIVATE_ACCESS_PATH,
  PUBLIC_ALLOWLIST,
  isDataPath,
  isPublicPath,
  normalisePath,
  privateAccessTarget,
} from '../src/lib/auth/site-privacy'
import { safeReturnTo } from '../src/lib/account/return-to'

const BASE = process.env.PRIVACY_BASE_URL ?? 'http://localhost:3000'
const SESSION_PREFIX = 'privacy-suite-'
const prisma = new PrismaClient()

/** The schedules Vercel actually calls, so the allowlist cannot drift away from them. */
const VERCEL_CRON_PATHS: string[] = (JSON.parse(readFileSync('vercel.json', 'utf8')).crons ?? [])
  .map((c: { path: string }) => c.path)

let passed = 0
let failed = 0
function section(name: string) { console.log(`\n${name}`) }
function check(label: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  ok   ${label}`) }
  else { failed++; console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ''}`) }
}

/** Payload signs with sha256(secret) hex, truncated to 32 — not the raw secret. */
function derivedSecret(): string {
  const raw = process.env.PAYLOAD_SECRET
  if (!raw) throw new Error('PAYLOAD_SECRET is required to mint a test session')
  return createHash('sha256').update(raw).digest('hex').slice(0, 32)
}

interface Minted { cookie: string; sid: string; userId: number }

/** A session exactly as a sign-in leaves one: a row Payload will find, and a token it will accept. */
async function mintSession(userId: number, opts: { expiresInSeconds?: number } = {}): Promise<Minted> {
  const ttl = opts.expiresInSeconds ?? 7200
  const sid = `${SESSION_PREFIX}${randomUUID()}`
  const now = new Date()
  const expiresAt = new Date(now.getTime() + ttl * 1000)
  const nextOrder = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COALESCE(MAX(_order), 0) + 1 AS n FROM payload.users_sessions WHERE _parent_id = ${userId}`
  await prisma.$executeRaw`
    INSERT INTO payload.users_sessions (_order, _parent_id, id, created_at, expires_at)
    VALUES (${Number(nextOrder[0].n)}, ${userId}, ${sid}, ${now}, ${expiresAt})`

  const issuedAt = Math.floor(now.getTime() / 1000)
  const user = await prisma.$queryRaw<{ email: string }[]>`
    SELECT email FROM payload.users WHERE id = ${userId}`
  const token = await new SignJWT({ id: userId, collection: 'users', email: user[0].email, sid })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ttl)
    .sign(new TextEncoder().encode(derivedSecret()))
  return { cookie: `payload-token=${token}`, sid, userId }
}

/** A token this server never issued: right shape, wrong signature. */
async function forgedToken(): Promise<string> {
  const token = await new SignJWT({ id: 2, collection: 'users', email: 'x@x', sid: 'nope' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(new TextEncoder().encode('not-the-signing-key-000000000000'))
  return `payload-token=${token}`
}

interface Res { status: number; location: string | null; body: string; headers: Headers }
async function get(path: string, cookie?: string): Promise<Res> {
  const res = await fetch(`${BASE}${path}`, {
    redirect: 'manual',
    headers: cookie ? { cookie } : {},
  })
  return {
    status: res.status,
    location: res.headers.get('location'),
    body: await res.text().catch(() => ''),
    headers: res.headers,
  }
}

/** Does this response send the visitor to the door? */
function redirectsToDoor(r: Res): boolean {
  if (r.status !== 307 && r.status !== 302 && r.status !== 308 && r.status !== 303) return false
  return (r.location ?? '').includes(PRIVATE_ACCESS_PATH)
}

async function main() {
  /* ── The allowlist itself, with no server involved ──────────────────────────────────────────── */
  section('The allowlist is narrow, and everything else is protected')

  check('the door is public', isPublicPath(PRIVATE_ACCESS_PATH))
  check('so is the existing sign-in page', isPublicPath('/login'))
  check('so is the password-reset flow that already existed', isPublicPath('/reset-password'))
  check('build assets are public', isPublicPath('/_next/static/chunk.js'))
  check('robots.txt is public, because a crawler has no session', isPublicPath('/robots.txt'))
  check("Payload's own login endpoint is public", isPublicPath('/api/users/login'))
  check('the two audited cron routes are public to the wall', isPublicPath('/api/cron/cueverse')
    && isPublicPath('/api/cron/site-builder-schedule'))
  /*
    Named exactly, not by prefix.

    A prefix would hand a blanket exemption to any cron route added later — including one whose
    author forgot to check a secret. That is deny-by-default failing inside the allowlist, which is
    the one place nobody would look for it.
  */
  check('...but an unaudited one under the same prefix is not',
    !isPublicPath('/api/cron/anything-added-later') && !isPublicPath('/api/cron'))

  /*
    Deny by default.

    The point of the list being exact rather than prefixed: a path that merely STARTS with an
    allowlisted one is a different route and must not inherit its exemption.
  */
  for (const near of ['/login-as-admin', '/private-accessible', '/api/users/login-bypass', '/robots.txt.bak']) {
    check(`a near miss is not public: ${near}`, !isPublicPath(near))
  }
  for (const p of ['/', '/seasons/16427', '/players/sixohtwo', '/rankings', '/yahoo', '/the-break',
    '/staff', '/register', '/setup', '/recovery', '/admin', '/api/users', '/api/graphql',
    '/a-route-that-does-not-exist-yet']) {
    check(`protected by default: ${p}`, !isPublicPath(p))
  }
  check('the image proxy is NOT public, so media cannot be pulled through it',
    !isPublicPath('/_next/image?url=%2Fassets%2Fx.webp'))
  check('a route invented tomorrow inherits the wall', !isPublicPath(`/${randomUUID()}`))

  /* The image proxy sits under `_next`, so the matcher must not exclude all of `_next`. */
  check('the dev-only session route is not public in production',
    !isPublicPath('/dev-e2e-session', { dev: false })
    && isPublicPath('/dev-e2e-session', { dev: true }))

  section('Path handling cannot be walked around')
  check('traversal is refused rather than resolved', normalisePath('/login/../seasons') === null)
  check('a trailing slash is the same route', normalisePath('/login/') === '/login' && isPublicPath('/login/'))
  check('doubled slashes collapse', normalisePath('//login') === '/login')
  check('a path that is not a path is refused', normalisePath('https://evil.example') === null)
  check('...and is therefore not public', !isPublicPath('https://evil.example'))

  section('Data paths answer with data, not a document')
  for (const p of ['/api/users', '/api/graphql', '/sitemap.xml', '/rankings/export', '/news/feed.xml']) {
    check(`treated as data: ${p}`, isDataPath(p))
  }
  check('an ordinary page is not', !isDataPath('/seasons/16427'))

  section('The return path cannot leave the site')
  check('the door never points at itself', privateAccessTarget(PRIVATE_ACCESS_PATH) === PRIVATE_ACCESS_PATH)
  check('...nor at the sign-in page it replaces', privateAccessTarget('/login') === PRIVATE_ACCESS_PATH)
  check('the root needs no returnTo', privateAccessTarget('/') === PRIVATE_ACCESS_PATH)
  check('a real page is carried', privateAccessTarget('/seasons/16427') ===
    `${PRIVATE_ACCESS_PATH}?returnTo=%2Fseasons%2F16427`)
  for (const evil of ['https://evil.example/x', '//evil.example', '/\\evil.example', 'javascript:alert(1)']) {
    check(`rejected as a return target: ${evil}`, safeReturnTo(evil, '/') === '/')
  }
  check('a local path is kept', safeReturnTo('/rankings', '/') === '/rankings')

  /* ── Everything below needs the server ──────────────────────────────────────────────────────── */
  const up = await fetch(BASE, { redirect: 'manual' }).then(() => true).catch(() => false)
  if (!up) {
    console.log(`\nSERVER NOT REACHABLE at ${BASE} — HTTP checks skipped.`)
    return
  }

  section('A logged-out visitor is turned away from every page')
  const pages = ['/', '/seasons/16427', '/tournaments', '/players/sixohtwo', '/rankings', '/yahoo',
    '/the-break', '/achievements', '/staff', '/staff/members', '/register', '/setup', '/recovery',
    '/news/archive', '/account', '/creator']
  for (const p of pages) {
    const r = await get(p)
    check(`${p} redirects to the door`, redirectsToDoor(r), `${r.status} -> ${r.location}`)
  }

  const withReturn = await get('/seasons/16427')
  check('...carrying where they were going',
    (withReturn.location ?? '').includes('returnTo=%2Fseasons%2F16427'), String(withReturn.location))

  section('A logged-out visitor learns nothing from a bad URL')
  /*
    Existence must not be inferable.

    A season that exists and one that does not have to answer identically, or the wall becomes a
    lookup service for which records exist.
  */
  const real = await get('/seasons/16427')
  const fake = await get('/seasons/99999999')
  const malformed = await get('/seasons/%2e%2e%2f%2e%2e')
  check('a real record and a missing one answer identically',
    real.status === fake.status && redirectsToDoor(fake), `${real.status} vs ${fake.status}`)
  check('a real player and a missing one answer identically',
    (await get('/players/sixohtwo')).status === (await get('/players/nobody-at-all')).status)
  check('a malformed URL is still protected',
    malformed.status !== 200, `${malformed.status}`)
  check('no response body carries site data',
    !/sixohtwo|Starkiller|8BRCAM Season/i.test(real.body + fake.body), 'body leaked a name')

  section('Data endpoints answer 401 with nothing in them')
  const dataPaths = ['/api/users', '/api/seasons', '/api/graphql', '/api/news/export',
    '/api/news/media', '/api/news/view', '/sitemap.xml', '/rankings/export',
    '/news/feed.xml', '/news/atom.xml']
  for (const p of dataPaths) {
    const r = await get(p)
    const clean = r.body.length < 200 && !/cueverse|player|season|rating|email/i.test(r.body)
    check(`${p} → 401, no data`, r.status === 401 && clean, `${r.status} ${r.body.slice(0, 80)}`)
  }
  const api = await get('/api/users')
  check('the 401 is JSON, not an HTML login page',
    (api.headers.get('content-type') ?? '').includes('json'), String(api.headers.get('content-type')))
  check('...and does not say whether the route exists', !/not found|no such|unknown route/i.test(api.body))

  section('The door, and only the door, opens')
  const door = await get(PRIVATE_ACCESS_PATH)
  check('the private-access page is reachable', door.status === 200, String(door.status))
  check('it says what it must', /Private Access/i.test(door.body)
    && /currently private/i.test(door.body)
    && /must log in to access the website and its data/i.test(door.body))
  check('it offers a way in', /Sign in/i.test(door.body))
  /*
    Judged on what a reader can SEE, not on the raw HTML.

    A dev build names its script chunks after the components they came from, so the string
    "rankings" appears in a `<script src>` on every page. That is a filename, not data — testing the
    raw markup reports it as a leak and teaches whoever sees the failure to loosen the check. The
    visible text is the thing the requirement is actually about.
  */
  const doorText = door.body
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<head[\s\S]*?<\/head>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
  check('it shows no site data', !/sixohtwo|Starkiller|deep\.cerebro|Season Progress|\d,\d{3}/i.test(doorText),
    doorText.slice(0, 160))
  /*
    And the metadata describes the door, not the site behind it.

    Scoped to the description tags rather than the whole document on purpose: searching the raw HTML
    for "brackets" also matches `bracketSurface`, a CSS custom-property name in the display runtime,
    and a check that fails on a token name is a check somebody will delete.
  */
  const descriptions = (door.body.match(/<meta[^>]+(?:name|property)="[^"]*description"[^>]*>/gi) ?? []).join(' ')
  check('...and its social preview describes the door, not the site',
    descriptions.length > 0
    && !/bracket|standing|climb the rankings|tournament/i.test(descriptions),
    descriptions.slice(0, 200))
  check('it does not advertise account creation', !/Create an account/i.test(door.body))
  check('the existing sign-in page still opens', (await get('/login')).status === 200)
  check('robots.txt is served', (await get('/robots.txt')).status === 200)

  section('No redirect loop')
  let hops = 0
  let path = '/seasons/16427'
  const seen = new Set<string>()
  while (hops < 8) {
    const r = await get(path)
    if (r.status === 200) break
    if (!r.location) break
    const next = new URL(r.location, BASE)
    const key = next.pathname + next.search
    if (seen.has(key)) { break }
    seen.add(key)
    path = key
    hops += 1
  }
  const settled = await get(path)
  check('following the redirect settles on a 200 door', settled.status === 200 && hops <= 2,
    `${hops} hops, ended ${path} ${settled.status}`)
  check('the door does not redirect', (await get(PRIVATE_ACCESS_PATH)).status === 200)

  section('A token this server did not issue is not a session')
  const forged = await forgedToken()
  check('a forged signature is refused', redirectsToDoor(await get('/rankings', forged)))
  check('a garbage cookie is refused', redirectsToDoor(await get('/rankings', 'payload-token=not-a-jwt')))
  check('an empty cookie is refused', redirectsToDoor(await get('/rankings', 'payload-token=')))
  const expired = await mintSession(2, { expiresInSeconds: -60 })
  check('an expired token is refused', redirectsToDoor(await get('/rankings', expired.cookie)))
  check('a forged token gets 401 on data, not a redirect', (await get('/api/users', forged)).status === 401)

  section('A signed-in account gets the site')
  const owner = await mintSession(2)
  check('the home page opens', (await get('/', owner.cookie)).status === 200)
  check('a season opens', (await get('/seasons/16427', owner.cookie)).status === 200)
  check('the rankings open', (await get('/rankings', owner.cookie)).status === 200)
  check('a data endpoint answers', (await get('/api/users/me', owner.cookie)).status === 200)
  const onward = await get(PRIVATE_ACCESS_PATH, owner.cookie)
  check('the door sends a signed-in visitor onward, and does not render itself',
    onward.status === 307 && (onward.location ?? '').endsWith('/'), `${onward.status} -> ${onward.location}`)

  section('Signing in returns you to where you were going')
  const back = await get(`${PRIVATE_ACCESS_PATH}?returnTo=%2Frankings`, owner.cookie)
  check('a safe internal path is honoured',
    (back.location ?? '').endsWith('/rankings'), `${back.status} -> ${back.location}`)
  for (const evil of ['https%3A%2F%2Fevil.example', '%2F%2Fevil.example', '%2F%5Cevil.example']) {
    const r = await get(`${PRIVATE_ACCESS_PATH}?returnTo=${evil}`, owner.cookie)
    const dest = new URL(r.location ?? '/', BASE)
    check(`an external return target is refused: ${decodeURIComponent(evil)}`,
      dest.origin === new URL(BASE).origin && dest.pathname === '/', String(r.location))
  }

  section('Administration is still a separate permission')
  const ownerStaff = await get('/staff', owner.cookie)
  check('the Owner reaches the staff area', ownerStaff.status === 200, String(ownerStaff.status))
  const member = await prisma.$queryRaw<{ id: number }[]>`
    SELECT u.id FROM payload.users u
    WHERE NOT EXISTS (SELECT 1 FROM payload.users_roles r
                      WHERE r.parent_id = u.id AND r.value::text IN ('owner', 'admin'))
    ORDER BY u.id ASC LIMIT 1`
  /*
    Judged on content, because this application refuses in the page rather than by redirecting.

    A member asking for /staff gets a 200 carrying a refusal, so the status code says nothing about
    authorisation and an assertion on it would be measuring the wrong thing. What matters is that the
    staff tools are not in the response — and that they ARE in the Owner's.
  */
  const staffMarkers = /Members|Audit|Penalties|Site Builder|Security/
  check("...and the staff tools are actually in the Owner's page",
    staffMarkers.test(ownerStaff.body), 'owner saw no staff navigation')
  if (member.length) {
    const m = await mintSession(member[0].id)
    check('a member reaches the site', (await get('/', m.cookie)).status === 200)
    const memberStaff = await get('/staff', m.cookie)
    check('...but sees no staff tools — logging in is not being an administrator',
      !staffMarkers.test(memberStaff.body), `${memberStaff.status}`)
    check('...and no member data leaks into that refusal',
      !/@member\.8br\.invalid|stepatdis/i.test(memberStaff.body))
  } else {
    check('a non-admin account exists to test with', false, 'none found')
  }

  section('Revoking a session ends access immediately')
  /*
    The layer the middleware cannot provide.

    Deleting the session row leaves the token cryptographically perfect and unexpired — the
    middleware still admits it. Access must stop anyway, which is what proves the server-side guard
    behind it is real and not decoration.
  */
  const doomed = await mintSession(2)
  check('the session works before revocation', (await get('/', doomed.cookie)).status === 200)
  await prisma.$executeRaw`DELETE FROM payload.users_sessions WHERE id = ${doomed.sid}`
  const after = await get('/', doomed.cookie)
  check('a revoked session no longer opens the site', after.status !== 200, `${after.status}`)

  section('Nothing behind the wall may be indexed or shared-cached')
  const prot = await get('/rankings')
  check('a protected response says noindex',
    (prot.headers.get('x-robots-tag') ?? '').includes('noindex'), String(prot.headers.get('x-robots-tag')))
  check('...and must not be stored by a shared cache',
    /private/.test(prot.headers.get('cache-control') ?? '')
    && /no-store/.test(prot.headers.get('cache-control') ?? ''), String(prot.headers.get('cache-control')))
  check('...and varies by cookie, so one reader\'s copy is not served to another',
    (prot.headers.get('vary') ?? '').toLowerCase().includes('cookie'), String(prot.headers.get('vary')))
  const doorHeaders = await get(PRIVATE_ACCESS_PATH)
  check('the door itself is noindex',
    (doorHeaders.headers.get('x-robots-tag') ?? '').includes('noindex')
    && /noindex/.test(doorHeaders.body))
  const robots = await get('/robots.txt')
  check('robots.txt disallows everything', /Disallow:\s*\/\s*$/m.test(robots.body), robots.body.slice(0, 120))
  check('...and no longer advertises a sitemap', !/sitemap/i.test(robots.body))

  section('A revoked or moderated account is refused EVERYWHERE, not only on pages')
  /*
    The hole this closes, and why the layout was not enough.

    The account check used to live only in the frontend layout, so it only ran when a page rendered.
    A direct request to /api/... never passes through a layout - and Payload's own access rules did
    not cover it either: `media` and both globals are `read: () => true`, so a banned account with a
    valid token really did read documents straight out of REST. Measured before the fix: /api/media
    returned 3345 bytes of documents.

    Each path below is a different way out of the database - Payload REST, a Payload global, a CSV
    export, an RSS feed, a page - and each is checked under each way an account stops being allowed.
  */
  const EXITS = ['/api/users/me', '/api/media', '/api/globals/site-branding',
    '/rankings/export', '/news/feed.xml', '/']
  const moderated = await mintSession(2)

  /* First prove these paths DO serve a good session, or the refusals below prove nothing. */
  let served = 0
  for (const path of EXITS) {
    const r = await get(path, moderated.cookie)
    if (r.status === 200 && r.body.length > 20) served += 1
  }
  check('a good session is served by every one of these exits', served === EXITS.length, `${served}/${EXITS.length}`)

  for (const status of ['BANNED', 'DELETED'] as const) {
    await prisma.memberModeration.upsert({
      where: { userId: moderated.userId },
      create: { userId: moderated.userId, status, bannedAt: new Date() },
      update: { status, bannedAt: new Date(), timeoutUntil: null },
    })
    for (const path of EXITS) {
      const r = await get(path, moderated.cookie)
      check(`${status}: ${path} is refused`,
        (r.status === 401 || redirectsToDoor(r)) && r.status !== 200,
        `${r.status} ${r.body.slice(0, 60)}`)
    }
  }
  await prisma.memberModeration.deleteMany({ where: { userId: moderated.userId } })

  /* Revocation: the token stays cryptographically perfect and unexpired; the session row goes. */
  await prisma.$executeRaw`DELETE FROM payload.users_sessions WHERE id = ${moderated.sid}`
  for (const path of EXITS) {
    const r = await get(path, moderated.cookie)
    check(`REVOKED: ${path} is refused`, r.status === 401 || redirectsToDoor(r), `${r.status}`)
  }

  section('Scheduled jobs refuse without their secret, and do no work')
  for (const path of VERCEL_CRON_PATHS) {
    const anon = await get(path)
    check(`${path} refuses an unauthenticated caller`, anon.status === 404 || anon.status === 401, `${anon.status}`)
    check('...returning no data', anon.body.length < 40 && !/docs|entries|revision/i.test(anon.body),
      anon.body.slice(0, 60))
  }
  /*
    Each handler is read as well, because a status code cannot show ORDER.

    What matters is that the secret is checked before the job reads anything or does anything - a
    route that refuses after starting work has already done the work.
  */
  for (const file of ['src/app/api/cron/cueverse/route.ts',
    'src/app/api/cron/site-builder-schedule/route.ts']) {
    const src = readFileSync(file, 'utf8')
    const name = file.split('/').slice(-2)[0]
    check(`${name}: compares the secret in constant time`, src.includes('timingSafeEqual'))
    check(`${name}: fails closed when the secret is unset`, /if \(!secret\) return false/.test(src))
    const guardAt = src.indexOf('!authorised(request)')
    const workAt = Math.max(src.indexOf('await runDueSchedules('), src.indexOf('await refreshCueVerseLeaderboard('))
    check(`${name}: refuses before doing any work`, guardAt > 0 && workAt > guardAt,
      `guard@${guardAt} work@${workAt}`)
  }

  section('Authentication answers do not reveal whether an account exists')
  /*
    Compared byte for byte, deliberately.

    An enumeration oracle is rarely a different MESSAGE; it is usually a different status, a
    different shape, or one stray field. Comparing whole bodies catches all three.
  */
  const postJson = async (path: string, body: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: res.status, body: await res.text() }
  }
  const realEmail = 'stepatdis@gmail.com'
  const fakeEmail = 'definitely-not-a-user@nowhere.invalid'

  const loginReal = await postJson('/api/users/login', { email: realEmail, password: 'wrong-password-xyz' })
  const loginFake = await postJson('/api/users/login', { email: fakeEmail, password: 'wrong-password-xyz' })
  check('a failed login answers identically for a real and an unknown account',
    loginReal.status === loginFake.status && loginReal.body === loginFake.body,
    `${loginReal.status}:${loginReal.body.slice(0, 50)} vs ${loginFake.status}:${loginFake.body.slice(0, 50)}`)
  check('...and names neither the account nor the reason',
    !/no such|not found|unknown user|no account/i.test(loginReal.body), loginReal.body.slice(0, 80))

  const forgotReal = await postJson('/api/users/forgot-password', { email: realEmail })
  const forgotFake = await postJson('/api/users/forgot-password', { email: fakeEmail })
  check('a password-reset request answers identically either way',
    forgotReal.status === forgotFake.status && forgotReal.body === forgotFake.body,
    `${forgotReal.status}:${forgotReal.body.slice(0, 40)} vs ${forgotFake.status}:${forgotFake.body.slice(0, 40)}`)

  const actions = readFileSync('src/lib/account/actions.ts', 'utf8')
  check("the site's own reset action succeeds whether or not the account exists",
    /never reveal whether the account exists/.test(actions) && /return \{ ok: true \}/.test(actions))
  /*
    The site's sign-in DOES say "banned" or "deleted", and that is not a leak.

    Those branches are reached only after `payload.login` has accepted the password, so the caller
    has already proved the account is theirs. Telling somebody why their own account will not open is
    the right answer; the PRE-authentication branch stays generic, and that is the one an enumerator
    can reach.
  */
  check('...while a wrong password stays generic before authentication',
    /Invalid CueVerse ID\/email or password\./.test(actions))

  section('The allowlist is exactly what is reported')
  check('nothing has been added to it unnoticed',
    PUBLIC_ALLOWLIST.exact.length === 7
    && PUBLIC_ALLOWLIST.prefixes.length === 6
    && PUBLIC_ALLOWLIST.cron.length === 2,
    `${PUBLIC_ALLOWLIST.exact.length} exact, ${PUBLIC_ALLOWLIST.prefixes.length} prefixes, ${PUBLIC_ALLOWLIST.cron.length} cron`)
  check('...and every cron entry it names is one vercel.json actually schedules',
    PUBLIC_ALLOWLIST.cron.every((c) => VERCEL_CRON_PATHS.includes(c)),
    PUBLIC_ALLOWLIST.cron.join(', '))
}

try {
  await main()
} catch (err) {
  failed++
  console.log(`\n  FAIL suite threw -- ${(err as Error).message}`)
} finally {
  /*
    Every session AND every moderation row this run wrote, whether it finished or not.

    The moderation cleanup is here rather than inline for a reason worth recording: an earlier
    version of this check crashed between banning an account and restoring it, and left the Owner
    banned on the replica. A restore that only runs on the happy path is not a restore.
  */
  const removed = await prisma.$executeRaw`
    DELETE FROM payload.users_sessions WHERE id LIKE ${`${SESSION_PREFIX}%`}`
    .catch(() => 0)
  const cleared = await prisma.memberModeration.deleteMany({ where: { userId: 2 } })
    .then((r) => r.count).catch(() => 0)
  console.log(`\ncleanup: removed ${removed} test session(s), ${cleared} moderation row(s)`)
  await prisma.$disconnect()
  console.log(`RESULT: ${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}
