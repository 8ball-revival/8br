/**
 * The reconstruction surfaces, in real Chrome, at 1440px and 390px.
 *
 * ── Why a real browser ───────────────────────────────────────────────────────────────────────────
 * Everything here is a question the source cannot answer: whether the filter bar wraps or clips,
 * whether the dialog fits a phone, whether a table scrolls inside its box or drags the page sideways,
 * whether the background stays put behind a modal. Those are measurements, and they need a layout
 * engine.
 *
 * ── Authentication ───────────────────────────────────────────────────────────────────────────────
 * Creator is staff-only. This reuses the owner's existing local session cookie rather than weakening
 * any check: the cookie is read from the running browser profile if one is supplied, otherwise the
 * authenticated captures are SKIPPED and reported as skipped. Nothing here creates an account,
 * lowers a permission or bypasses a gate.
 *
 *   node verification/archive/visual.mjs
 *   BREAK_SESSION_COOKIE="payload-token=..." node verification/archive/visual.mjs
 */
import { spawn } from 'node:child_process'
import { writeFile, mkdir } from 'node:fs/promises'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9355
const BASE = process.env.BASE_URL || 'http://localhost:3000'
const COOKIE = process.env.BREAK_SESSION_COOKIE || ''
const OUT = 'verification/archive/shots'
await mkdir(OUT, { recursive: true })

let pass = 0, fail = 0, skip = 0
const check = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ok   ${n}`) }
  else { fail++; console.log(`  FAIL ${n}${d ? ` — ${d}` : ''}`) }
}
const skipped = (n, why) => { skip++; console.log(`  skip ${n} — ${why}`) }

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
const at = async (w, h, mobile) =>
  send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
const open = async (path) => { await send('Page.navigate', { url: BASE + path }); await sleep(2600) }

/** Page-level sideways scroll, and any element that is itself wider than the viewport. */
const OVERFLOW = `(() => {
  const doc = document.documentElement
  const pageOverflow = doc.scrollWidth > doc.clientWidth + 1
  const wide = [...document.querySelectorAll('body *')]
    .filter(el => {
      const r = el.getBoundingClientRect()
      // Ignore anything that manages its own horizontal scroll — that is the correct pattern.
      const cs = getComputedStyle(el)
      if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') return false
      return r.width > doc.clientWidth + 2 && r.height > 0
    })
    .slice(0, 5)
    .map(el => el.tagName.toLowerCase() + '.' + String(el.className || '').split(' ')[0])
  return { pageOverflow, wide, viewport: doc.clientWidth, scrollWidth: doc.scrollWidth }
})()`

/** Tap targets below the 24px floor, ignoring anything not actually visible. */
const TAP_TARGETS = `(() => {
  const small = [...document.querySelectorAll('button, a, select, input, summary')]
    .filter(el => el.offsetParent !== null)
    .map(el => ({ el, r: el.getBoundingClientRect() }))
    .filter(x => x.r.width > 0 && x.r.height > 0 && (x.r.height < 24 || x.r.width < 24))
    .slice(0, 6)
    .map(x => (x.el.textContent || x.el.getAttribute('aria-label') || x.el.tagName).trim().slice(0, 24)
      + ' ' + Math.round(x.r.width) + 'x' + Math.round(x.r.height))
  return small
})()`

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')

if (COOKIE) {
  // Reuse the existing session. Never mint one.
  const [name, ...rest] = COOKIE.split('=')
  await send('Network.setCookie', {
    name: name.trim(), value: rest.join('=').trim(),
    domain: 'localhost', path: '/', httpOnly: true,
  })
}

try {
  // ───────────────────────────────────────────────────── anonymous privacy, at both widths
  console.log('\nPrivate Seasons are private to an anonymous visitor')
  {
    const privateIds = JSON.parse(process.env.PRIVATE_SEASON_IDS || '[5443,5428,3732,4106]')
    const publicIds = JSON.parse(process.env.PUBLIC_SEASON_IDS || '[443,2187]')

    for (const sid of privateIds) {
      const r = await fetch(`${BASE}/seasons/${sid}`)
      const html = await r.text()
      const rendered = /SEASON AT A GLANCE|View Playoffs/i.test(html)
      check(`/seasons/${sid} shows no Season to an anonymous visitor`, !rendered)
      // The title is metadata, and metadata runs even when the body 404s.
      const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || ''
      check(`...and leaks no title (${JSON.stringify(title)})`,
        !/Season \d|Division/i.test(title), title)
    }
    for (const sid of publicIds) {
      const r = await fetch(`${BASE}/seasons/${sid}`)
      const html = await r.text()
      check(`/seasons/${sid} still renders for everyone`, /View Playoffs|SEASON AT A GLANCE/i.test(html))
    }
  }

  if (!COOKIE) {
    console.log('\nCreator captures')
    skipped('every authenticated capture', 'no BREAK_SESSION_COOKIE supplied; authentication was not weakened')
  } else {
    for (const [w, h, mobile, tag] of [[1440, 900, false, 'desktop'], [390, 844, true, 'mobile']]) {
      console.log(`\nCreator at ${w}px`)
      await at(w, h, mobile)
      await open('/creator')

      const shell = await evaluate(`(() => ({
        heading: !!document.querySelector('h2') && /Historical reconstructions/i.test(document.body.innerText),
        rows: document.querySelectorAll('ol li a[href^="/creator/seasons/"]').length,
        selects: document.querySelectorAll('select').length,
        progressText: /entrants added/i.test(document.body.innerText),
        sharedWarning: /Auto Assign unavailable/i.test(document.body.innerText),
      }))()`)
      check('the reconstruction list is present', shell.heading === true)
      check('...listing rows, not tiles', shell.rows > 0, String(shell.rows))
      check('...with four filter controls', shell.selects >= 4, String(shell.selects))
      check('...and compact progress on each row', shell.progressText === true)
      check('...flagging the shared 2006 stage', shell.sharedWarning === true)

      const of1 = await evaluate(OVERFLOW)
      check('no page-level horizontal overflow', of1.pageOverflow === false,
        `${of1.scrollWidth} > ${of1.viewport}${of1.wide?.length ? ' — ' + of1.wide.join(', ') : ''}`)
      if (mobile) {
        const taps = await evaluate(TAP_TARGETS)
        check('every control is at least 24px', taps.length === 0, taps.join('; '))
      }
      await shot(`${tag}-creator-list`)

      // Each filter, applied through the URL the control writes.
      for (const [q, name] of [
        ['?year=2011', 'year'], ['?division=B', 'division'],
        ['?progress=not-started', 'progress'], ['?archive=shared-source', 'archive-completeness'],
      ]) {
        await open('/creator' + q)
        const r = await evaluate(`(() => ({
          rows: document.querySelectorAll('ol li a[href^="/creator/seasons/"]').length,
          count: (document.body.innerText.match(/(\\d+) of (\\d+)/) || [])[0] || '',
        }))()`)
        check(`the ${name} filter narrows the list`, r.rows > 0 && !!r.count, `${r.rows} rows, "${r.count}"`)
        const of2 = await evaluate(OVERFLOW)
        check(`...without overflow at ${w}px`, of2.pageOverflow === false)
        await shot(`${tag}-filter-${name}`)
      }

      // An empty shell, its archive status, and the entrant Auto Assign button.
      const shellId = JSON.parse(process.env.SAMPLE_SHELL_ID || '5443')
      await open(`/creator/seasons/${shellId}`)
      const detail = await evaluate(`(() => ({
        status: /Archive template/i.test(document.body.innerText),
        participants: /Participants/i.test(document.body.innerText),
        autoAssign: [...document.querySelectorAll('button')].some(b => /Auto Assign/i.test(b.textContent || '')),
        unresolved: /could not settle|Unresolved/i.test(document.body.innerText),
      }))()`)
      check('the archive template status is shown', detail.status === true)
      check('...with its participant and group counts', detail.participants === true)
      check('the entrant Auto Assign button is present', detail.autoAssign === true)
      await shot(`${tag}-shell-detail`)

      // The preview dialog: height, scroll lock, focus, internal scrolling.
      if (detail.autoAssign) {
        await evaluate(`(() => {
          const b = [...document.querySelectorAll('button')].find(x => /Auto Assign/i.test(x.textContent || ''))
          b?.click(); return true
        })()`)
        await sleep(2200)
        const dlg = await evaluate(`(() => {
          const d = document.querySelector('[role="dialog"]')
          if (!d) return { open: false }
          const r = d.getBoundingClientRect()
          const scroller = d.querySelector('.overflow-y-auto')
          const tables = [...d.querySelectorAll('table')].map(t => {
            const box = t.closest('.overflow-x-auto')
            return { inBox: !!box, wider: box ? t.scrollWidth > box.clientWidth : false }
          })
          return {
            open: true,
            height: Math.round(r.height),
            viewport: window.innerHeight,
            fits: r.height <= window.innerHeight + 1,
            hasInternalScroll: !!scroller,
            focusInside: d.contains(document.activeElement),
            tablesBoxed: tables.every(t => t.inBox),
            bodyLocked: getComputedStyle(document.body).overflow === 'hidden'
              || document.body.scrollHeight <= window.innerHeight + 1,
            text: document.body.innerText.slice(0, 400),
          }
        })()`)
        check('the preview dialog opens', dlg.open === true)
        check('...and fits the viewport', dlg.fits === true, `${dlg.height} vs ${dlg.viewport}`)
        check('...scrolling its own body', dlg.hasInternalScroll === true)
        check('...with focus moved inside it', dlg.focusInside === true)
        check('...and any table boxed for horizontal scroll', dlg.tablesBoxed === true)
        const ofd = await evaluate(OVERFLOW)
        check('...no page overflow while it is open', ofd.pageOverflow === false)
        await shot(`${tag}-entrant-preview`)

        // The unresolved report — with no entrants added, everything is unresolved.
        check('the unresolved report is shown',
          /Could not be placed|unresolved|Player not among current entrants/i.test(dlg.text || ''),
          (dlg.text || '').slice(0, 120))

        await evaluate(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return true })()`)
        await sleep(700)
        const closed = await evaluate(`(() => ({ open: !!document.querySelector('[role="dialog"]') }))()`)
        check('Escape closes it', closed.open === false)
      }

      // The blocked 2006 shared-stage state.
      const sharedId = JSON.parse(process.env.SHARED_SHELL_ID || '5428')
      await open(`/creator/seasons/${sharedId}`)
      const blocked = await evaluate(`(() => ({
        message: /Auto Assign unavailable pending shared-stage support/i.test(document.body.innerText),
        explained: /counted twice|undivided/i.test(document.body.innerText),
        button: [...document.querySelectorAll('button')].some(b => /Auto Assign/i.test(b.textContent || '')),
      }))()`)
      check('the shared 2006 shell states the block', blocked.message === true)
      check('...and explains why', blocked.explained === true)
      check('...offering no working Auto Assign button', blocked.button === false)
      await shot(`${tag}-shared-blocked`)
    }
  }
} catch (e) {
  fail++
  console.log('\nFATAL ' + (e instanceof Error ? e.message : String(e)))
} finally {
  console.log(`\nRESULT: ${pass} passed, ${fail} failed, ${skip} skipped`)
  console.log(`Screenshots in ${OUT}`)
  try { ws.close() } catch { /* already gone */ }
  proc.kill()
  process.exit(fail === 0 ? 0 : 1)
}
