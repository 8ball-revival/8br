/**
 * The parts that only exist inside a running Next application.
 *
 * ── Why this suite has to exist ──────────────────────────────────────────────────────────────────
 * The database suite tests the navigation's date filter directly, because `getNavigation` goes
 * through `unstable_cache`, which throws outside a request context — a plain script cannot reach it.
 * That unit test is worth keeping and is not enough on its own: it proves the FILTER is right and
 * says nothing about whether the cached read serves what was published, whether publishing actually
 * clears that cache, or whether a draft stays private until it is published.
 *
 * Those are properties of the running application, so they are checked against one: a real Next
 * server, real HTTP, the real header rendered by the real root layout, in a real browser. Nothing
 * here is a mock, and `getNavigation` is not reshaped to make a script's life easier — that would
 * trade a real property of the site for a convenience in the harness.
 *
 * ── Why it runs its own server ───────────────────────────────────────────────────────────────────
 * The suite publishes navigation, rolls it back, and reads the result. Doing that against the
 * development server would mean writing to the working copy of the live data, and doing it against
 * the working copy without writing is impossible.
 *
 * So it makes a disposable clone, starts a Next server of its own against it on another port, and
 * throws both away at the end. The database guard is satisfied for the same reason it is in every
 * other writing suite, and nothing outside `8br_test_integration` is ever opened.
 *
 * Run: npm run test:site-builder:integration      (it needs no other server running)
 */

import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { openSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CLONE = '8br_test_integration'
const PORT = Number(process.env.SB_INTEGRATION_PORT || 3100)
const BASE = `http://localhost:${PORT}`

// ── Build the clone's connection string from the development one ───────────────────────────────
function readEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    for (const raw of readFileSync(file, 'utf8').split(String.fromCharCode(10))) {
      const line = raw.trim()
      const eq = line.indexOf('=')
      if (eq < 1 || line.startsWith('#')) continue
      const key = line.slice(0, eq).trim()
      if (!/^[A-Z0-9_]+$/.test(key)) continue
      let value = line.slice(eq + 1).trim()
      if (value.length > 1 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
        value = value.slice(1, -1)
      }
      out[key] = value
    }
  } catch { /* no such file */ }
  return out
}

const devEnv = readEnvFile('.env.replica')
const sourceUrl = process.env.SB_SOURCE_DATABASE_URL || devEnv.DATABASE_URL
if (!sourceUrl) {
  console.error('No DATABASE_URL in .env.replica; cannot build the integration clone.')
  process.exit(1)
}
const cloneUrl = sourceUrl.replace(/\/[^/?]+(\?|$)/, `/${CLONE}$1`)

/*
  The guard runs against the CLONE, before Prisma is imported.

  `process.env.DATABASE_URL` is set first so every module below — the guard, Prisma, the service —
  agrees about which database this is. A suite that writes has to be unable to reach anything else,
  and that is decided here rather than by remembering to pass a flag.
*/
process.env.DATABASE_URL = cloneUrl
process.env.DIRECT_URL = cloneUrl

const { assertDisposableTestDatabase } = await import('../src/lib/db-guard')
assertDisposableTestDatabase('verify-site-builder-integration')

console.log(`\n  cloning ${sourceUrl.replace(/\/\/.*@/, '//…@').split('/').pop()} → ${CLONE} …`)
execFileSync('bash', ['scripts/db/make-test-clone.sh', CLONE], { stdio: 'ignore' })

const { prisma } = await import('../src/lib/prisma')
const { getDraft, saveDraft } = await import('../src/lib/site-builder/service')
const { updateModuleConfig } = await import('../src/lib/site-builder/operations')
await import('../src/components/site-builder/modules')

const { launch, reporter } = await import('./browser/driver.mjs') as unknown as {
  launch: (o?: { port?: number }) => Promise<Browser>
  reporter: (t: string) => Reporter
}

interface Browser {
  goto: (url: string, wait?: number) => Promise<void>
  eval: <T = unknown>(expr: string) => Promise<T>
  signInAsOwner: () => Promise<boolean>
  close: () => void
}
interface Reporter {
  check: (name: string, ok: boolean, detail?: string) => void
  section: (name: string) => void
  finish: () => number
  failures: () => number
}

const actor = { userId: 999999, username: 'integration-suite' }
const r = reporter('integration')

/** Every navigation label the header actually rendered, plus the markup, for absence checks. */
const HEADER_PROBE = `(function () {
  var header = document.querySelector('header');
  if (!header) return { labels: [], html: '' };
  var labels = [].slice.call(header.querySelectorAll('a')).map(function (a) { return (a.textContent || '').trim() });
  return { labels: labels.filter(Boolean), html: header.innerHTML };
})()`

interface HeaderProbe { labels: string[]; html: string }

/** Click the first button whose trimmed text matches, and say whether one was found. */
const CLICK_BY_TEXT = (pattern: string) => `(function () {
  var re = new RegExp(${JSON.stringify(pattern)}, 'i');
  var hit = [].slice.call(document.querySelectorAll('button')).filter(function (b) {
    return re.test((b.textContent || '').trim())
  })[0];
  if (hit) { hit.click(); return true }
  return false
})()`

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))

const navItem = (over: Partial<Record<string, unknown>>) => ({
  label: 'Link', destination: '/', customHref: '', mobileLabel: '', newTab: false,
  icon: '', badge: '', audience: 'everyone', device: 'both', from: '', until: '',
  children: [], ...over,
})

/** Replace the navigation module's links in the draft, without touching anything else. */
async function setNavItems(items: unknown[]) {
  const draft = (await getDraft('nav'))!
  const module = draft.document.sections[0].modules.find((m) => m.type === 'global.navigation')!
  await saveDraft('nav', updateModuleConfig(draft.document, module.id, { items }), draft.version, actor)
}

let server: ChildProcess | null = null
let tsconfigBefore: string | null = null
// Outside the repository on purpose: Tailwind scans the project for class names, and a Next
// build log is full of minified strings that look exactly like arbitrary-value classes.
const SERVER_LOG = join(tmpdir(), 'sb-integration-server.log')

try {
  // ── Start a server of our own ─────────────────────────────────────────────────────────────────
  console.log(`  starting a Next server on ${BASE} against the clone …`)
  /*
    Its own build directory.

    `next dev` owns `.next`, and the ordinary development server may well be running against the
    real replica in another terminal. Two servers writing one directory produce a failure that looks
    like a code fault and is not one, so this gets `.next-integration` — which `next.config.ts`
    already supports for exactly this reason.

    Next rewrites `tsconfig.json`'s `include` to mention whichever directory it is using, so the
    file is restored at the end; an integration run must not leave a diff behind.
  */
  const serverLog = openSync(SERVER_LOG, 'w')
  tsconfigBefore = readFileSync('tsconfig.json', 'utf8')
  server = spawn('npx', ['next', 'dev', '-p', String(PORT)], {
    env: {
      ...process.env,
      ...devEnv,
      DATABASE_URL: cloneUrl,
      DIRECT_URL: cloneUrl,
      // `.next-verify` is the project's established name for a build that is not the dev server's,
// and it is already in .gitignore — which matters because Tailwind's source detection skips
// ignored paths. A new directory name was not, and the minified CSS inside it was scanned
// for class names, producing a colour-mix rule with mojibake inside its var(), which broke the
// stylesheet for the ordinary dev server until it was cleared.
      NEXT_DIST_DIR: '.next-verify',
      NODE_OPTIONS: '--no-deprecation',
    },
    stdio: ['ignore', serverLog, serverLog],
    shell: true,
  })

  const deadline = Date.now() + 180_000
  let up = false
  while (Date.now() < deadline && !up) {
    try {
      const res = await fetch(`${BASE}/`, { redirect: 'manual' })
      up = res.status < 500
    } catch { /* not listening yet */ }
    if (!up) await new Promise((res) => setTimeout(res, 1000))
  }
  if (!up) {
    const tail = (() => {
      try { return readFileSync(SERVER_LOG, 'utf8').split(String.fromCharCode(10)).slice(-25).join(String.fromCharCode(10)) } catch { return '(no log)' }
    })()
    throw new Error(`The integration server did not come up on ${BASE}.

${tail}`)
  }
  console.log('  server is up\n')

  // ── The endpoint's own authorisation ──────────────────────────────────────────────────────────
  r.section('The scheduled-publication endpoint')
  const cronUrl = `${BASE}/api/cron/site-builder-schedule`
  const secret = devEnv.SITE_BUILDER_CRON_SECRET ?? ''

  for (const [name, headers] of [
    ['no credentials at all', {}],
    ['an empty bearer token', { authorization: 'Bearer ' }],
    ['somebody else’s bearer token', { authorization: 'Bearer not-the-secret' }],
    ['a wrong dedicated header', { 'x-site-builder-cron-secret': 'not-the-secret' }],
    ['the right secret in the wrong header', { 'x-wrong-header': secret }],
    ['a near miss, one character short', { 'x-site-builder-cron-secret': secret.slice(0, -1) }],
    ['the secret with something appended', { 'x-site-builder-cron-secret': `${secret}x` }],
  ] as [string, Record<string, string>][]) {
    const res = await fetch(cronUrl, { headers })
    const body = await res.text()
    r.check(`refused: ${name}`, res.status === 404, `${res.status} ${body.slice(0, 50)}`)
    r.check('  …and the refusal describes nothing', !/revision|activated|schedule|secret/i.test(body), body.slice(0, 60))
  }

  for (const method of ['GET', 'POST']) {
    const res = await fetch(cronUrl, { method, headers: { 'x-site-builder-cron-secret': secret } })
    const body = await res.json().catch(() => ({})) as Record<string, unknown>
    r.check(`${method} with the dedicated header runs the sweep`, res.status === 200 && body.ok === true, String(res.status))
    r.check('  …and leaks no configuration',
      !/postgres|password|secret|DATABASE_URL|@127|@localhost/i.test(JSON.stringify(body)),
      JSON.stringify(body).slice(0, 120))
  }
  const bearer = await fetch(cronUrl, { headers: { authorization: `Bearer ${secret}` } })
  r.check('a bearer token — what Vercel Cron sends — is accepted', bearer.status === 200, String(bearer.status))

  // ── The navigation, through the real read path ────────────────────────────────────────────────
  const owner = await launch()
  const anon = await launch()

  try {
    process.env.SB_BASE = BASE
    await owner.goto(`${BASE}/dev-e2e-session?secret=${encodeURIComponent(devEnv.SITE_BUILDER_E2E_SECRET ?? '')}`, 2000)
    const signedIn = await owner.eval<string>('document.body.innerText.slice(0, 120)')
    r.check('the suite can sign in as the Owner', /"ok"\s*:\s*true/.test(String(signedIn)), String(signedIn).slice(0, 80))

    // A nested, role-gated, date-windowed navigation — every feature at once.
    const NESTED = [
      navItem({
        label: 'Competitions',
        destination: '/seasons',
        children: [
          navItem({ label: 'Nested seasons', destination: '/seasons' }),
          navItem({ label: 'Nested tournaments', destination: '/tournaments' }),
        ],
      }),
      navItem({ label: 'Members only', destination: '/account', audience: 'signedIn' }),
      navItem({ label: 'Visitors only', destination: '/login', audience: 'signedOut' }),
      navItem({ label: 'Owner only', destination: '/rankings', audience: 'owner' }),
      navItem({ label: 'Not yet', destination: '/yahoo', from: '2999-01-01' }),
      navItem({ label: 'Long ago', destination: '/achievements', until: '2000-01-01' }),
    ]

    // ── A draft stays private ───────────────────────────────────────────────────────────────────
    r.section('A draft stays private')
    await setNavItems(NESTED)

    await anon.goto(`${BASE}/`, 2500)
    const anonBefore = await anon.eval<HeaderProbe>(HEADER_PROBE)
    r.check('a signed-out visitor does not see the unpublished navigation',
      !anonBefore.labels.includes('Competitions'), anonBefore.labels.join(', '))
    r.check('and still gets a working header', anonBefore.labels.length > 0, anonBefore.labels.join(', '))
    r.check('the draft is not in the markup at all', !anonBefore.html.includes('Nested seasons'))

    /*
      ── Publishing invalidates the cache ────────────────────────────────────────────────────────

      The publish has to happen INSIDE THE SERVER, and the first version of this test got that
      wrong. It called `publish()` from the script, which writes the right rows and then invalidates
      the script's own cache — a different process from the one rendering the header. The server
      went on serving its cached navigation, the check failed, and it was the test that was broken.

      That is worth keeping in mind rather than only fixing: any "did the cache clear" test that
      does not perform the write through the running application is testing nothing.

      So this drives the real editor. Open the navigation global, press Publish, confirm.
    */
    r.section('Publishing through the editor invalidates the cache')
    await owner.goto(`${BASE}/staff/site-builder/global/nav`, 6000)
    await owner.eval(CLICK_BY_TEXT('^Skip$'))

    const draftLoaded = await owner.eval<boolean>(`document.body.innerText.indexOf('Site navigation') >= 0`)
    r.check('the editor opens on the navigation global', draftLoaded === true)

    const publishOpened = await owner.eval<boolean>(CLICK_BY_TEXT('^Publish'))
    await sleep(1200)
    r.check('the publish dialog opens', publishOpened === true)
    const confirmed = await owner.eval<boolean>(CLICK_BY_TEXT('Publish now'))
    await sleep(4000)
    r.check('and it publishes', confirmed === true)

    /*
      No sleep beyond the publish itself, and no retry loop.

      `revalidatePath('/', 'layout')` runs inside that publish, so the very NEXT request has to
      render the new navigation. Polling would hide precisely the bug this checks for — a global
      that publishes without invalidating, which looks perfectly correct to anybody who waits.
    */
    await anon.goto(`${BASE}/`, 2500)
    const anonAfter = await anon.eval<HeaderProbe>(HEADER_PROBE)
    r.check('the next request after publishing serves the new navigation',
      anonAfter.labels.includes('Competitions'), anonAfter.labels.join(', '))

    r.section('Nesting, roles and dates, in the rendered header')
    r.check('a nested menu renders its children', anonAfter.labels.includes('Nested seasons'), anonAfter.labels.join(', '))
    r.check('and both of them', anonAfter.labels.includes('Nested tournaments'))
    r.check('a signed-out visitor sees the signed-out link', anonAfter.labels.includes('Visitors only'))
    r.check('and not the members-only one', !anonAfter.labels.includes('Members only'))
    r.check('and not the owner-only one', !anonAfter.labels.includes('Owner only'))
    r.check('a link whose window has not opened is absent from the MARKUP, not merely hidden',
      !anonAfter.html.includes('Not yet'))
    r.check('and one whose window has closed is too', !anonAfter.html.includes('Long ago'))

    await owner.goto(`${BASE}/`, 2500)
    const ownerView = await owner.eval<HeaderProbe>(HEADER_PROBE)
    r.check('the Owner sees the members-only link on the same published navigation',
      ownerView.labels.includes('Members only'), ownerView.labels.join(', '))
    r.check('and the owner-only link', ownerView.labels.includes('Owner only'))
    r.check('and not the signed-out one', !ownerView.labels.includes('Visitors only'))
    r.check('the way back is in the page whatever the navigation says',
      ownerView.html.includes('/staff/site-builder'), 'no Site Builder link in the header')

    // ── A scheduled activation invalidates it too ───────────────────────────────────────────────
    /*
      The other way a global becomes public: unattended, through the scheduler. It runs in the
      server process when the cron endpoint is called, so this is the one path where the invalidation
      can be checked without driving any interface at all.
    */
    r.section('A scheduled activation invalidates the cache as well')
    const scheduledLabel = 'Scheduled navigation'
    await setNavItems([navItem({ label: scheduledLabel, destination: '/rankings' })])

    const navPage = (await prisma.sitePage.findUnique({ where: { key: 'nav' }, include: { draft: true } }))!
    const lastNumber = (await prisma.sitePageRevision.findFirst({
      where: { pageId: navPage.id }, orderBy: { number: 'desc' }, select: { number: true },
    }))!.number
    await prisma.sitePageRevision.create({
      data: {
        pageId: navPage.id,
        number: lastNumber + 1,
        document: navPage.draft!.document as never,
        state: 'SCHEDULED',
        scheduledFor: new Date(Date.now() - 60_000),
        previousRevisionId: navPage.publishedRevisionId,
        publishedByUsername: actor.username,
        summary: 'Integration schedule probe',
      },
    })

    const sweep = await fetch(cronUrl, { method: 'POST', headers: { 'x-site-builder-cron-secret': secret } })
    const sweepBody = await sweep.json().catch(() => ({})) as { activated?: number }
    r.check('the cron sweep activates the overdue navigation', sweepBody.activated === 1, JSON.stringify(sweepBody).slice(0, 140))

    await anon.goto(`${BASE}/`, 2500)
    const afterSchedule = await anon.eval<HeaderProbe>(HEADER_PROBE)
    r.check('and the next request serves it',
      afterSchedule.labels.includes(scheduledLabel), afterSchedule.labels.join(', '))

    // ── Rollback, through the control centre ────────────────────────────────────────────────────
    /*
      Driven through the interface for the same reason the publish is: a rollback that only writes
      rows proves nothing about what a visitor is served next.
    */
    r.section('Rollback restores the previous navigation')
    await owner.goto(`${BASE}/staff/site-builder`, 9000)
    const historyOpened = await owner.eval<string>(`(function () {
      var buttons = [].slice.call(document.querySelectorAll('button'));
      var b = buttons.filter(function (x) {
        var label = (x.getAttribute('aria-label') || '') + ' ' + (x.getAttribute('title') || '');
        return /Revision history/i.test(label) && /Navigation/i.test(label)
      })[0];
      if (!b) {
        return 'no history button; saw: ' + buttons.map(function (x) {
          return (x.getAttribute('aria-label') || x.getAttribute('title') || (x.textContent || '').trim()).slice(0, 30)
        }).filter(Boolean).slice(0, 12).join(' | ')
      }
      b.click();
      return 'clicked'
    })()`)
    await sleep(3000)
    r.check('the navigation history opens from the control centre', historyOpened === 'clicked', historyOpened)

    const restored = await owner.eval<string>(`(function () {
      window.confirm = function () { return true };
      var rows = [].slice.call(document.querySelectorAll('li'));
      for (var i = rows.length - 1; i >= 0; i--) {
        var t = rows[i].textContent || '';
        if (t.indexOf('#1') >= 0 && t.indexOf('Live') < 0) {
          var b = [].slice.call(rows[i].querySelectorAll('button')).filter(function (x) {
            return /^Restore$/i.test((x.textContent || '').trim())
          })[0];
          if (b) { b.click(); return 'clicked' }
        }
      }
      return 'no restore button for revision 1'
    })()`)
    await sleep(5000)
    r.check('revision 1 can be restored', restored === 'clicked', restored)

    await anon.goto(`${BASE}/`, 2500)
    const rolled = await anon.eval<HeaderProbe>(HEADER_PROBE)
    r.check('the next request after rolling back serves the original navigation',
      !rolled.labels.includes('Competitions') && !rolled.labels.includes(scheduledLabel),
      rolled.labels.join(', '))
    r.check('and the header still has links', rolled.labels.length > 0, rolled.labels.join(', '))
    r.check('the rolled-back navigation is gone from the markup', !rolled.html.includes('Nested seasons'))

    // ── Nothing unauthenticated may read a draft ────────────────────────────────────────────────
    r.section('Draft configuration is not readable without the capability')
    await setNavItems([navItem({ label: 'Secret draft link', destination: '/rankings' })])

    for (const path of ['/', '/staff/site-builder', '/staff/site-builder/global/nav', '/rankings']) {
      const res = await fetch(`${BASE}${path}`, { redirect: 'manual' })
      const body = await res.text()
      r.check(`unauthenticated GET ${path} exposes no draft`,
        !body.includes('Secret draft link'), `${res.status}, ${body.length} bytes`)
    }
    const anonBuilder = await fetch(`${BASE}/staff/site-builder`, { redirect: 'manual' })
    const anonBuilderBody = await anonBuilder.text()
    r.check('and the control centre itself gives an anonymous caller nothing',
      !/Revision history|Reusable modules|Trash/i.test(anonBuilderBody),
      `${anonBuilder.status}, ${anonBuilderBody.length} bytes`)

    // ── Competition data untouched ──────────────────────────────────────────────────────────────
    r.section('Competition data untouched')
    const seasons = await prisma.season.count()
    const ledger = await prisma.ratingLedger.count()
    r.check('the clone still has its competition data', seasons > 0 && ledger > 0, `${seasons} seasons, ${ledger} ledger rows`)
    const s16426 = await prisma.season.findUnique({ where: { id: 16426 } })
    if (s16426) {
      r.check('Season 16426 is still completed', s16426.lifecycleState === 'COMPLETED', String(s16426.lifecycleState))
      r.check('and still records Kevin', s16426.championName === 'Kevin', String(s16426.championName))
    }
  } finally {
    await owner.close()
    await anon.close()
  }
} finally {
  if (server) {
    // `shell: true` means the child is a shell; killing the tree is what actually stops Next.
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], { stdio: 'ignore' })
      else server.kill('SIGTERM')
    } catch { /* already gone */ }
  }
  // Next rewrites tsconfig.json's `include` for whichever dist directory it used. Put it back.
  if (tsconfigBefore !== null) {
    try { writeFileSync('tsconfig.json', tsconfigBefore) } catch { /* best effort */ }
  }
  try { rmSync('.next-verify', { recursive: true, force: true }) } catch { /* best effort */ }
  /*
    The server log is kept when something failed and removed when nothing did.

    A failing integration test whose server said why, into a file that was then deleted, is a test
    that costs an hour to diagnose. Keeping it only on failure means it is there when it is wanted
    and does not accumulate when it is not.
  */
  if (r.failures() > 0) {
    console.log(`
  the server log is at ${SERVER_LOG}
`)
    try {
      const tail = readFileSync(SERVER_LOG, 'utf8').split(String.fromCharCode(10)).slice(-40).join(String.fromCharCode(10))
      console.log(tail)
    } catch { /* nothing to show */ }
  } else {
    try { rmSync(SERVER_LOG, { force: true }) } catch { /* best effort */ }
  }
  await prisma.$disconnect().catch(() => {})
  // The clone is disposable and is dropped, so a failed run leaves nothing behind either.
  try {
    const admin = cloneUrl.replace(/\/[^/?]+(\?|$)/, '/postgres$1')
    execFileSync('bash', ['-c', `"/c/Program Files/PostgreSQL/17/bin/psql.exe" -q "${admin}" -c 'DROP DATABASE IF EXISTS "${CLONE}";'`], { stdio: 'ignore' })
    console.log(`\n  dropped ${CLONE}`)
  } catch { /* leave it; it is disposable either way */ }
}

process.exit(r.finish() ? 1 : 0)
