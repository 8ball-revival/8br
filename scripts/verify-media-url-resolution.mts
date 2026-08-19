/**
 * How media URLs resolve, in development and in production.
 *
 * These exist because of a failure that was hard to read: every next/image asset rendered broken in
 * local development while the raw file served perfectly, and the optimizer request did not error —
 * it HUNG. The cause was self-reference. With NEXT_PUBLIC_SITE_URL set locally, Payload emits
 * absolute urls, next/image treats an absolute url as remote, and the dev server fetches the image
 * back from itself while still rendering the page that asked for it.
 *
 * The rule that falls out: development leaves NEXT_PUBLIC_SITE_URL unset so paths stay relative, and
 * production sets it so remotePatterns can allow the site's own media route. These checks pin both
 * halves, and pin that production does not quietly allow localhost.
 */

import { readFileSync } from 'node:fs'

let passed = 0
let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed += 1 } else { failed += 1; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** The remotePatterns builder from next.config.ts, evaluated for a given site url. */
function remotePatternsFor(siteUrl: string | undefined) {
  if (!siteUrl) return []
  try {
    const url = new URL(siteUrl)
    return [{
      protocol: url.protocol.replace(':', ''),
      hostname: url.hostname,
      pathname: '/api/media/file/**',
    }]
  } catch {
    return []
  }
}

// ─────────────────────────────────────────────────── development
console.log('\ndevelopment: no site url, relative paths')
{
  check('with NEXT_PUBLIC_SITE_URL unset there are no remote image hosts at all',
    remotePatternsFor(undefined).length === 0)

  // localPatterns is what serves relative media paths, and it must stay.
  const cfg = readFileSync('next.config.ts', 'utf8')
  check('localPatterns still covers the media route', /localPatterns[\s\S]{0,200}\/api\/media\/file\/\*\*/.test(cfg))

  // src/lib/site.ts must keep the localhost fallback, or canonical urls break locally.
  const site = readFileSync('src/lib/site.ts', 'utf8')
  check('canonical urls fall back to localhost in development',
    /NEXT_PUBLIC_SITE_URL\s*\|\|\s*'http:\/\/localhost:3000'/.test(site))

  // The guidance must be somewhere a developer will actually read.
  const example = readFileSync('.env.example', 'utf8')
  check('.env.example warns against setting it locally',
    /LEAVE THIS UNSET IN LOCAL DEVELOPMENT/i.test(example))
  check('...and explains the deadlock rather than just forbidding it',
    /deadlock|fetches the image back from\s*#?\s*itself|still rendering/i.test(example))
}

// ─────────────────────────────────────────────────── production
console.log('\nproduction: site url set, own origin only')
{
  const prod = remotePatternsFor('https://8br.gg')
  check('production allows exactly one remote host', prod.length === 1, String(prod.length))
  check('...which is the site itself', prod[0]?.hostname === '8br.gg', prod[0]?.hostname)
  check('...over https only', prod[0]?.protocol === 'https', prod[0]?.protocol)
  check('...restricted to the media route', prod[0]?.pathname === '/api/media/file/**')

  // The point of reverting the port change: production must not be broadened for a local case.
  check('production does NOT allow localhost',
    !prod.some((p) => p.hostname === 'localhost' || p.hostname === '127.0.0.1'))
  check('production does not allow a wildcard host',
    !prod.some((p) => p.hostname.includes('*')))
  check('production does not allow arbitrary paths',
    !prod.some((p) => p.pathname === '/**' || p.pathname === '**'))

  const cfg = readFileSync('next.config.ts', 'utf8')
  check('no localhost host is hardcoded in the image config',
    !/hostname:\s*['"](localhost|127\.0\.0\.1)['"]/.test(cfg))
  check('no port is hardcoded in the image config',
    !/port:\s*['"]3000['"]/.test(cfg))
}

// ─────────────────────────────────────────────────── the self-reference itself
console.log('\nno self-referential optimizer request')
{
  // The shape that hangs: an absolute url pointing back at the same origin serving the page.
  const wouldSelfFetch = (siteUrl: string | undefined, mediaHref: string) => {
    if (!mediaHref.startsWith('http')) return false
    if (!siteUrl) return false
    try { return new URL(mediaHref).origin === new URL(siteUrl).origin } catch { return false }
  }

  check('relative media never self-fetches, whatever the site url',
    !wouldSelfFetch('http://localhost:3000', '/api/media/file/8br-logo.png'))
  check('an absolute local url pointing at the dev server WOULD self-fetch — the bug',
    wouldSelfFetch('http://localhost:3000', 'http://localhost:3000/api/media/file/8br-logo.png'))
  check('production serving its own absolute url is also self-referential in principle',
    wouldSelfFetch('https://8br.gg', 'https://8br.gg/api/media/file/8br-logo.png'),
    'it works there only because the optimizer runs separately from the renderer')
  check('with no site url configured, media stays relative and the case cannot arise',
    !wouldSelfFetch(undefined, '/api/media/file/8br-logo.png'))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exitCode = failed > 0 ? 1 : 0
