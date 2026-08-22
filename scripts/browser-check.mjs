/**
 * Drive a real Chrome over CDP: hydration, layout and screenshots for pages that need a session.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────────
 * The in-app browser pane can run scripts against a page but cannot lay it out or composite it, so
 * geometry reads as zero, the accessibility tree is empty, and nothing can be screenshotted. That is
 * enough to check served markup and not nearly enough to check whether a form works. This launches
 * Chrome properly, installs the session cookie through CDP (so no credential is typed into a page or
 * written to disk), and reports what only a real browser can answer: did the client components
 * hydrate, does the page overflow, and what does it look like.
 *
 * Usage:
 *   node scripts/browser-check.mjs --token <payload-token> [--out <dir>]
 *
 * The token is passed as an argument and never persisted. Every page is loaded read-only; the script
 * clicks nothing and submits nothing.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : fallback
}

const TOKEN = arg('token', '')
const OUT = arg('out', join(process.cwd(), 'tmp-shots'))
const ORIGIN = 'http://localhost:3000'
const PORT = 9333

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PROFILE = join(tmpdir(), `8br-cdp-${process.pid}`)

const PAGES = [
  { name: 'members', path: '/staff/members' },
  { name: 'members-search', path: '/staff/members?q=aa' },
  { name: 'creator', path: '/creator' },
  { name: 'creator-season-new', path: '/creator/seasons/new' },
  { name: 'creator-tournament-new', path: '/creator/tournaments/new' },
  { name: 'creator-seasons-open', path: '/creator/seasons' },
  { name: 'creator-seasons-done', path: '/creator/seasons/completed' },
  { name: 'creator-setup', path: '/creator/seasons/443/setup' },
  { name: 'creator-entrants', path: '/creator/seasons/443/entrants' },
  { name: 'creator-groups', path: '/creator/seasons/443/groups' },
  { name: 'creator-playoffs', path: '/creator/seasons/443/playoffs' },
  { name: 'creator-record', path: '/creator/seasons/443' },
  { name: 'creator-tournament', path: '/creator/tournaments/11570/setup' },
]
const VIEWPORTS = [
  { name: '1440', width: 1440, height: 1024 },
  { name: '1024', width: 1024, height: 900 },
  { name: '390', width: 390, height: 844 },
]
const THEMES = ['dark', 'light']

mkdirSync(OUT, { recursive: true })

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=Translate,MediaRouter',
  '--hide-scrollbars',
  'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function targetWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch { /* not up yet */ }
    await sleep(250)
  }
  throw new Error('Chrome did not expose a debugging target')
}

const ws = new WebSocket(await targetWs())
await new Promise((r) => ws.once('open', r))

let seq = 0
const waiting = new Map()
const events = []
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString())
  if (msg.id && waiting.has(msg.id)) {
    const { resolve, reject } = waiting.get(msg.id)
    waiting.delete(msg.id)
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
  } else if (msg.method) events.push(msg)
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq
    waiting.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
await send('Log.enable')

if (TOKEN) {
  await send('Network.setCookie', {
    name: 'payload-token', value: TOKEN, domain: 'localhost', path: '/', httpOnly: true,
  })
}

const evaluate = async (expression) => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  })
  if (exceptionDetails) throw new Error(exceptionDetails.text + ' ' + (exceptionDetails.exception?.description ?? ''))
  return result.value
}

const goto = async (url) => {
  await send('Page.navigate', { url })
  for (let i = 0; i < 80; i++) {
    await sleep(250)
    const ready = await evaluate('document.readyState')
    if (ready === 'complete') break
  }
  await sleep(1200) // let hydration settle
}

/** What only a real browser can answer. */
const PROBE = `(() => {
  const fk = (el) => Object.keys(el || {}).filter(k => k.startsWith('__react')).length > 0;
  const de = document.documentElement, vw = de.clientWidth;
  const all = [...document.querySelectorAll('input,button,select,textarea')];
  const bleed = [...document.querySelectorAll('body *')].filter(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && (r.right > vw + 1 || r.left < -1) && !el.closest('.overflow-x-auto,.overflow-auto,.overflow-x-scroll');
  });
  const txt = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim();
  const cue = [...document.querySelectorAll('input')].find(i => txt(i.closest('label')).startsWith('CueVerse ID'));
  const focusables = document.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])');
  return {
    vw,
    interactive: all.length,
    hydrated: all.filter(fk).length,
    fullyHydrated: all.length > 0 && all.every(fk),
    pageScrollsSideways: de.scrollWidth > vw + 1,
    bleedCount: bleed.length,
    bleedSample: bleed.slice(0, 3).map(e => e.tagName.toLowerCase() + '.' + String(e.className).slice(0, 40)),
    focusables: focusables.length,
    hasCreateNewMemberButton: [...document.querySelectorAll('button')].some(b => txt(b) === 'Create New Member'),
    cueFieldPresent: !!cue,
    cueFieldHydrated: cue ? fk(cue) : null,
    clearButton: [...document.querySelectorAll('button')].filter(b => ['Clear','Cancel','Done'].includes(txt(b))).map(txt),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    themeApplied: document.documentElement.classList.contains('light') ? 'light' : 'dark',
  };
})()`

const report = []
for (const theme of THEMES) {
  /*
   * The theme is a stored choice, not a media query.
   *
   * Emulating prefers-color-scheme produced identical dark screenshots for both passes, because the
   * site defaults to dark and reads its own key at load. Setting that key is what a person choosing
   * light actually does, so that is what gets set — and it has to be in place BEFORE the document
   * script runs, or the first paint is the wrong theme.
   */
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] })
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('8br-theme', '${theme}') } catch {}`,
  })
  for (const vp of VIEWPORTS) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.width < 768,
    })
    for (const page of PAGES) {
      await goto(`${ORIGIN}${page.path}`)
      const probe = await evaluate(PROBE)
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      const file = join(OUT, `${page.name}-${vp.name}-${theme}.png`)
      writeFileSync(file, Buffer.from(shot.data, 'base64'))
      report.push({ page: page.name, viewport: vp.name, theme, file, ...probe })
      if (probe.themeApplied !== theme) console.log(`  ! ${page.name} ${vp.name} rendered ${probe.themeApplied}, expected ${theme}`)
      console.log(`${page.name.padEnd(17)} ${vp.name.padEnd(5)} ${theme.padEnd(5)} hydrated ${String(probe.hydrated).padStart(4)}/${String(probe.interactive).padEnd(4)} bleed=${probe.bleedCount} sideways=${probe.pageScrollsSideways}`)
    }
  }
}

const errors = events
  .filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
  .map((e) => e.params.entry.text)
  .filter((t) => !/webpack-hmr|WebSocket/.test(t))
console.log(`\nconsole errors (excluding dev HMR): ${errors.length}`)
for (const e of errors.slice(0, 8)) console.log('  ' + e.slice(0, 160))

writeFileSync(join(OUT, 'report.json'), JSON.stringify({ report, errors }, null, 2))
console.log(`\nwrote ${report.length} screenshots to ${OUT}`)

ws.close()
chrome.kill()
await sleep(500)
try { rmSync(PROFILE, { recursive: true, force: true }) } catch { /* profile is disposable */ }
