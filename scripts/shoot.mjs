/**
 * Deterministic screenshots and layout measurements, with no new dependencies.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────────────────────
 * `chrome --headless --screenshot --window-size=W,H` does not reliably set the LAYOUT viewport, so
 * a "mobile" capture came back rendered wider than the image and every check for horizontal overflow
 * was answering a question about the screenshot rather than about the page.
 *
 * Chrome's own DevTools protocol does set it — `Emulation.setDeviceMetricsOverride` is what the
 * device toolbar uses — and Node has had a global WebSocket since 22, so speaking it directly costs
 * one file and no packages. Playwright would do the same thing and add a browser download to a
 * repository that has managed without one.
 *
 * Usage:
 *   node scripts/shoot.mjs <url> <outfile.png> [width] [height] [--measure]
 *
 * With --measure it prints, as JSON, whether the page scrolls sideways and which elements stick out
 * past the viewport — the thing a screenshot can only hint at.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const [url, out, widthArg, heightArg] = process.argv.slice(2)
const measure = process.argv.includes('--measure')
/** Optionally press a control before shooting, so an expanded window can be captured. */
const clickArg = process.argv.find((a) => a.startsWith('--click='))?.slice('--click='.length) ?? null
/** Emulate `prefers-reduced-motion: reduce`, to check the page really does drop the animation. */
const reducedMotion = process.argv.includes('--reduced-motion')
/**
 * Run one expression in the page and print what it returns.
 *
 * The profile's behaviour — animations running, listeners not accumulating, custom properties being
 * written — is invisible to a screenshot, and the in-app browser panes cannot be relied on to report
 * this app's layout. This gives the same CDP session a way to ask the page a direct question.
 */
const evalArg = process.argv.find((a) => a.startsWith('--eval='))?.slice('--eval='.length) ?? null
/*
 * Capture one region at a magnification, for inspecting a surface rather than a layout.
 *
 * A repeating 1px-every-3px texture is invisible in a downscaled full-page shot — the very
 * downscaling that makes the page fit averages the lines away, which is how a brushed finish
 * survived a screenshot review. `--clip=x,y,w,h` with `--scale=N` renders those CSS pixels at N
 * device pixels each, so a hairline that is really there is unmistakable and one that is gone
 * cannot be imagined back.
 */
const clipArg = process.argv.find((a) => a.startsWith('--clip='))?.slice('--clip='.length) ?? null
const scaleArg = Number(process.argv.find((a) => a.startsWith('--scale='))?.slice('--scale='.length) ?? '0')
if (!url || !out) {
  console.error('usage: node scripts/shoot.mjs <url> <out.png> [width] [height] [--measure]')
  process.exit(2)
}
const width = Number(widthArg ?? 1440)
const height = Number(heightArg ?? 900)
const mobile = width < 768

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!chromePath) { console.error('Chrome not found'); process.exit(2) }

const PORT = 9500 + Math.floor(Number(process.env.SHOOT_PORT_OFFSET ?? '0'))

const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`,
  // A throwaway profile, so this never touches the real browser's session or history.
  `--user-data-dir=${process.env.TEMP ?? '/tmp'}\\shoot-profile-${PORT}`,
  'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Wait for the debugging endpoint to come up, rather than guessing at a delay. */
async function endpoint() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (res.ok) return (await res.json()).webSocketDebuggerUrl
    } catch { /* not listening yet */ }
    await sleep(250)
  }
  throw new Error('Chrome never opened its debugging port')
}

const ws = new WebSocket(await endpoint())
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })

let nextId = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id != null && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
  }
}
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++nextId
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
})

// One tab, driven through its own session.
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
const call = (method, params) => send(method, params, sessionId)

await call('Page.enable')
await call('Runtime.enable')
/*
  The layout viewport, set the way the device toolbar sets it.

  `mobile: true` also switches the page to the mobile user-agent metrics, which is what makes a
  `max-width` media query resolve the way it does on a phone rather than on a narrow desktop window.
*/
await call('Emulation.setDeviceMetricsOverride', {
  width, height, deviceScaleFactor: scaleArg || (mobile ? 2 : 1), mobile,
})

if (reducedMotion) {
  await call('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
}

/*
  The session, if one was supplied.

  The site is private, so an anonymous capture photographs the private-access page rather than the
  page that was asked for — silently, and it looks like a layout regression. `scripts/with-dev-session.mjs`
  mints a real session and passes it in this variable; without it this stays an anonymous visitor,
  which is exactly what a suite checking the wall itself wants.
*/
if (process.env.PRIVACY_COOKIE) {
  const [name, ...rest] = process.env.PRIVACY_COOKIE.split('=')
  await call('Network.enable')
  await call('Network.setCookie', {
    name: name.trim(),
    value: rest.join('=').trim(),
    domain: new URL(url).hostname,
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
  })
}

await call('Page.navigate', { url })
// Settle: the profile streams, and the CueVerse panel arrives a moment after the record does.
await sleep(4500)

if (clickArg) {
  /*
    Matched by visible text rather than by a selector.

    The controls worth capturing are named things a reader would press — "View All", "Watch" — and a
    class-based selector would break the first time the styling changed, which is exactly when a
    screenshot is most wanted.
  */
  const expr = `(() => {
    const wanted = ${JSON.stringify(clickArg)};
    // Substring, not equality: a label may carry an arrow or an icon's text beside it.
    const el = [...document.querySelectorAll('button, a')].find((b) => b.textContent.trim().includes(wanted));
    if (!el) return 'not-found';
    el.click();
    return 'clicked';
  })()`
  const { result } = await call('Runtime.evaluate', { expression: expr, returnByValue: true })
  if (result.value !== 'clicked') console.error(`warning: could not find a control labelled "${clickArg}"`)
  await sleep(2500)
}

if (measure) {
  const expr = `(() => {
    const de = document.documentElement;
    const vw = de.clientWidth;
    const out = [];
    /*
      An element wider than the viewport only matters if something can actually SEE it stick out.

      A span inside a truncating list item is clipped by its parent and causes no overflow at all;
      reporting it as one made this tool cry wolf about a layout that was fine. So an element whose
      ancestor clips it is skipped, and what is left is the set that genuinely widens the page.
    */
    const clipped = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p);
        if (o.overflowX === 'hidden' || o.overflowX === 'clip' || o.overflowX === 'auto' || o.overflowX === 'scroll') return true;
      }
      return false;
    };
    for (const el of document.querySelectorAll('main *')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 1 && !clipped(el)) {
        out.push({ tag: el.tagName, cls: String(el.className).slice(0, 70), right: Math.round(r.right), w: Math.round(r.width) });
      }
    }
    const aside = document.querySelector('aside');
    const panel = document.querySelector('[role=region]');
    return JSON.stringify({
      reducedMotionMatches: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      windowOpen: !!panel,
      /* Under reduced motion the panel must carry no transform and no transition at all — the
         animation is dropped, not shortened. */
      panelTransform: panel ? (panel.style.transform || 'none') : null,
      panelTransition: panel ? (panel.style.transition || 'none') : null,
      panelHeight: panel ? Math.round(panel.getBoundingClientRect().height) : null,
      viewport: vw,
      scrollWidth: de.scrollWidth,
      scrollsSideways: de.scrollWidth > vw + 1,
      asideWidth: aside ? Math.round(aside.getBoundingClientRect().width) : null,
      tabs: [...document.querySelectorAll('[role=tab]')].map((t) => t.textContent.trim()),
      overflowing: out.slice(0, 10),
      overflowCount: out.length,
    });
  })()`
  const { result } = await call('Runtime.evaluate', { expression: expr, returnByValue: true })
  console.log(result.value)
}

if (evalArg) {
  const { result, exceptionDetails } = await call('Runtime.evaluate', {
    expression: evalArg, returnByValue: true, awaitPromise: true,
  })
  if (exceptionDetails) console.error('eval threw:', exceptionDetails.text)
  console.log(typeof result.value === 'string' ? result.value : JSON.stringify(result.value))
}

// A screenshot is skipped when the caller only wanted an answer.
if (out === '-') { ws.close(); chrome.kill(); process.exitCode = 0 }
else {
const clipRect = clipArg
  ? (([x, y, w, h]) => ({ x, y, width: w, height: h, scale: scaleArg || 1 }))(clipArg.split(',').map(Number))
  : undefined
const shot = await call('Page.captureScreenshot', {
  format: 'png', captureBeyondViewport: true, ...(clipRect ? { clip: clipRect } : {}),
})
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, Buffer.from(shot.data, 'base64'))
console.log(`wrote ${out}`)

ws.close()
chrome.kill()
process.exitCode = 0
}
