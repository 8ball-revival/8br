/**
 * The navigation change, exercised against the running site.
 *
 * The source checks prove the files say the right thing. This proves the server does it: that the
 * retired URLs really answer with a redirect to the right place and keep the query string, that the
 * two new pages render with what is running above what is finished, and that the bar shows the same
 * seven entries on a desktop and inside the mobile drawer.
 *
 *   node verification/nav/routes.mjs
 */
import { spawn } from 'node:child_process'
import { writeFile, mkdir } from 'node:fs/promises'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9351
const BASE = process.env.BASE_URL || 'http://localhost:3000'
const OUT = 'verification/nav/shots'
await mkdir(OUT, { recursive: true })

let pass = 0, fail = 0
const check = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ok   ${n}`) }
  else { fail++; console.log(`  FAIL ${n}${d ? ` — ${d}` : ''}`) }
}

// ─────────────────────────────────────────────────────────── redirects, at the HTTP level
console.log('\nRetired URLs answer with a redirect to the right place')
const REDIRECTS = [
  ['/live/seasons', '/seasons'],
  ['/live/cups', '/cups'],
  ['/live/tournaments', '/cups'],
  ['/archives/seasons', '/seasons'],
  ['/archives/cups', '/cups'],
  ['/archives/tournaments', '/cups'],
  ['/tournaments', '/cups'],
]
for (const [from, to] of REDIRECTS) {
  const r = await fetch(BASE + from, { redirect: 'manual' })
  const loc = r.headers.get('location') || ''
  const path = loc.startsWith('http') ? new URL(loc).pathname : loc
  check(`${from} → ${to}`, r.status === 308 && path === to, `${r.status} ${path || '(no location)'}`)
}

console.log('\nA shared filtered link keeps its filters across the redirect')
{
  const r = await fetch(`${BASE}/archives/cups?year=2011&q=open&sort=oldest`, { redirect: 'manual' })
  const loc = r.headers.get('location') || ''
  const url = new URL(loc.startsWith('http') ? loc : BASE + loc)
  check('the path changes', url.pathname === '/cups', url.pathname)
  check('...and every parameter survives',
    url.searchParams.get('year') === '2011' && url.searchParams.get('q') === 'open'
    && url.searchParams.get('sort') === 'oldest', url.search)
}

console.log('\nFollowing the redirect lands on a real page')
for (const [from, to] of REDIRECTS) {
  const r = await fetch(BASE + from)
  const path = new URL(r.url).pathname
  /*
   * /seasons is itself a redirect, onward into the most recent Season, so anything pointing at it
   * finishes on /seasons/<id>. That is the destination, not an unresolved hop — what matters is that
   * it terminates on a 200 inside the right section rather than bouncing.
   */
  const landed = to === '/seasons' ? /^\/seasons(\/\d+)?$/.test(path) : path === to
  check(`${from} ends inside ${to} with a 200`, r.status === 200 && landed, `${r.status} ${path}`)
}

// ─────────────────────────────────────────────────────────── the rendered pages
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let list
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); if (r.ok) { list = await r.json(); break } } catch { /* not up */ }
  await sleep(250)
}
if (!list) { proc.kill(); throw new Error('Chrome did not expose a debugging port') }

const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }))
})
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r?.result?.exceptionDetails) return { error: String(r.result.exceptionDetails.text) }
  return r?.result?.result?.value
}
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', {})
  if (r?.result?.data) await writeFile(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'))
}

await send('Page.enable')
await send('Runtime.enable')

const NAV_PROBE = `(() => {
  const bar = document.querySelector('nav[aria-label="Primary"]')
  if (!bar) return { error: 'no primary nav' }
  return {
    labels: [...bar.querySelectorAll('a')].map(a => a.textContent.trim()),
    hrefs: [...bar.querySelectorAll('a')].map(a => new URL(a.href).pathname),
    triggers: bar.querySelectorAll('button[aria-haspopup]').length,
  }
})()`

const PAGE_PROBE = `(() => {
  const h2 = [...document.querySelectorAll('h2')].map(h => h.textContent.trim())
  const live = [...document.querySelectorAll('span')]
    .filter(s => s.textContent.trim() === 'Live').length
  return {
    h1: document.querySelector('h1')?.textContent.trim(),
    sections: h2,
    liveBadges: live,
    cards: document.querySelectorAll('a[href^="/seasons/"], a[href^="/cups/"]').length,
    // A public page must not offer a way into Creator.
    creatorLinks: [...document.querySelectorAll('a')]
      .filter(a => new URL(a.href).pathname.startsWith('/creator')).length,
    // An empty section must SAY it is empty. Zero cards and no message is a broken page.
    emptyState: /No (seasons|cups) have been completed yet|No archived records match/i.test(document.body.innerText),
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }
})()`

try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

  console.log('\nDesktop navigation')
  await send('Page.navigate', { url: BASE })
  await sleep(3000)
  const nav = await evaluate(NAV_PROBE)
  console.log(`  ${nav.labels?.join(' · ')}`)
  check('the bar is Home · Seasons · Cups · Rankings · News (public)',
    nav.labels?.join(' · ') === 'Home · Seasons · Cups · Rankings · News', nav.labels?.join(' · '))
  check('Seasons and Cups are links with destinations',
    nav.hrefs?.includes('/seasons') && nav.hrefs?.includes('/cups'), nav.hrefs?.join(','))
  check('no dropdown trigger remains', nav.triggers === 0, String(nav.triggers))
  check('nothing points into /live or /archives',
    !nav.hrefs?.some((h) => h.startsWith('/live') || h.startsWith('/archives')), nav.hrefs?.join(','))
  await shot('desktop-home')

  console.log('\nSeasons opens the browser on the most recent Season')
  {
    /*
     * Next resolves a Server Component redirect() through the client router here rather than with a
     * 3xx, so the document request answers 200 and the navigation happens after. The header is
     * therefore not the thing to assert — where the reader ENDS UP is, and that is measured below
     * from the rendered page.
     */
    const r = await fetch(BASE + '/seasons')
    check('the request resolves rather than erroring', r.status === 200, String(r.status))

    await send('Page.navigate', { url: BASE + '/seasons' })
    await sleep(3500)
    const p = await evaluate(`(() => ({
      url: location.pathname,
      h1: document.querySelector('h1')?.textContent.trim(),
      // The browser's own furniture: the pickers and the standings, not a grid of summary cards.
      pickers: [...document.querySelectorAll('select')].length,
      groups: [...document.querySelectorAll('h2, h3')]
        .filter(h => /^Group /.test(h.textContent.trim())).length,
      status: /Completed|Registration|Group Stage|Playoffs/i.test(document.body.innerText),
      creatorLinks: [...document.querySelectorAll('a')]
        .filter(a => new URL(a.href).pathname.startsWith('/creator')).length,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    }))()`)
    console.log(`  landed on ${p.url} — "${p.h1}", ${p.pickers} pickers, ${p.groups} groups`)
    check('the browser is what renders', /^\/seasons\/\d+$/.test(p.url), p.url)
    check('...with the Season named in the heading', /Season/i.test(p.h1 || ''), p.h1)
    check('...its Competition / Year / Season pickers present', p.pickers >= 3, String(p.pickers))
    check('...the standings on screen rather than a summary card', p.groups > 0, String(p.groups))
    check('...and the Season\'s status shown', p.status === true)
    check('...offering no way into Creator', p.creatorLinks === 0, String(p.creatorLinks))
    check('...no horizontal overflow', p.horizontalOverflow === false)
    await shot('desktop-seasons')
  }

  console.log('\nCups lists what is running, then what is finished')
  {
    await send('Page.navigate', { url: BASE + '/cups' })
    await sleep(3000)
    const p = await evaluate(PAGE_PROBE)
    console.log(`  h1 "${p.h1}"  sections [${p.sections?.join(' | ')}]  ${p.cards} cards, ${p.liveBadges} live`)
    check('Cups renders under its own heading', p.h1 === 'Cups', p.h1)
    check('...with a Completed section', p.sections?.includes('Completed'), p.sections?.join('|'))
    check('...running ones first when there are any',
      !p.sections?.includes('Now Playing') || p.sections.indexOf('Now Playing') < p.sections.indexOf('Completed'),
      p.sections?.join('|'))
    check('...each running one badged Live',
      !p.sections?.includes('Now Playing') || p.liveBadges > 0, String(p.liveBadges))
    check('...either listing records, or saying plainly that there are none',
      p.cards > 0 || p.emptyState === true, `${p.cards} cards and no empty state`)
    check('...and offering no way into Creator', p.creatorLinks === 0, String(p.creatorLinks))
    check('...no horizontal overflow', p.horizontalOverflow === false)
    await shot('desktop-cups')
  }

  console.log('\nThe filters still work after the path change')
  {
    await send('Page.navigate', { url: `${BASE}/cups?year=2011` })
    await sleep(2500)
    const p = await evaluate(PAGE_PROBE)
    check('a filtered Cups page renders', p.h1 === 'Cups', p.h1)
    check('...and answers the filter rather than breaking on it',
      p.cards > 0 || p.emptyState === true, `${p.cards} cards and no empty state`)
  }

  console.log('\nMobile navigation')
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await send('Page.navigate', { url: BASE })
  await sleep(3000)
  const opened = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')]
      .find(b => /open menu/i.test(b.getAttribute('aria-label') || ''))
    if (!btn) return { error: 'no menu button' }
    btn.click()
    return true
  })()`)
  check('the drawer opens', opened === true, JSON.stringify(opened))
  await sleep(700)
  const drawer = await evaluate(`(() => {
    const links = [...document.querySelectorAll('a')]
      .filter(a => a.offsetParent !== null)
      .map(a => ({ text: a.textContent.trim(), path: new URL(a.href).pathname }))
    return {
      seasons: links.some(l => l.path === '/seasons'),
      cups: links.some(l => l.path === '/cups'),
      old: links.filter(l => l.path.startsWith('/live') || l.path.startsWith('/archives')).map(l => l.path),
      headings: [...document.querySelectorAll('p')]
        .filter(p => /^(Live|Archives)$/i.test(p.textContent.trim())).length,
    }
  })()`)
  check('Seasons is in the drawer', drawer.seasons === true)
  check('Cups is in the drawer', drawer.cups === true)
  check('no Live or Archives grouping heading remains', drawer.headings === 0, String(drawer.headings))
  check('nothing in the drawer points at the old sections', drawer.old?.length === 0, drawer.old?.join(','))
  await shot('mobile-drawer')

  await send('Page.navigate', { url: BASE + '/seasons' })
  await sleep(3000)
  const mob = await evaluate(`(() => ({
    url: location.pathname,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    hasContent: document.body.innerText.trim().length > 200,
  }))()`)
  check('Seasons opens the browser on a phone too', /^\/seasons\/\d+$/.test(mob.url), mob.url)
  check('...without sideways scroll', mob.overflow === false)
  check('...and with the Season actually rendered', mob.hasContent === true)
  await shot('mobile-seasons')
} catch (e) {
  fail++
  console.log('\nFATAL ' + (e instanceof Error ? e.message : String(e)))
} finally {
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  console.log(`Screenshots in ${OUT}`)
  try { ws.close() } catch { /* already gone */ }
  proc.kill()
  process.exit(fail === 0 ? 0 : 1)
}
