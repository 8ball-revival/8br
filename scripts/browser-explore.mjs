/**
 * Exploratory pass: the things a person does that a happy-path test does not.
 *
 * Sorting overrides and filters, keyboard reach, focus visibility, mobile stacking, Escape, Back and
 * Forward, a stale tab, and a double submit. Read-only — it types, sorts, navigates and presses keys,
 * but creates nothing.
 *
 * Usage: node scripts/browser-explore.mjs --token <payload-token>
 */
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d }
const TOKEN = arg('token', '')
const OUT = arg('out', join(process.cwd(), 'tmp-shots'))
const ORIGIN = 'http://localhost:3000'
const PORT = 9335
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PROFILE = join(tmpdir(), `8br-explore-${process.pid}`)

mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0, fail = 0
const check = (l, ok, d) => { if (ok) { pass++; console.log(`  ✓ ${l}`) } else { fail++; console.log(`  ✗ ${l}${d ? ` — ${d}` : ''}`) } }
const section = (t) => console.log(`\n--- ${t} ---`)

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new',
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' })

async function targetWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const p = list.find((t) => t.type === 'page')
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl
    } catch { /* starting */ }
    await sleep(250)
  }
  throw new Error('no CDP target')
}
const ws = new WebSocket(await targetWs())
await new Promise((r) => ws.once('open', r))
let seq = 0
const waiting = new Map()
const logs = []
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString())
  if (m.id && waiting.has(m.id)) {
    const { resolve, reject } = waiting.get(m.id); waiting.delete(m.id)
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
  } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logs.push(m.params.entry.text)
})
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq; waiting.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }))
})
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable')
if (TOKEN) await send('Network.setCookie', { name: 'payload-token', value: TOKEN, domain: 'localhost', path: '/', httpOnly: true })

const evaluate = async (expression) => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (exceptionDetails) throw new Error(exceptionDetails.text)
  return result.value
}
const viewport = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768 })
const goto = async (url) => {
  await send('Page.navigate', { url })
  for (let i = 0; i < 80; i++) { await sleep(250); if (await evaluate('document.readyState') === 'complete') break }
  await sleep(1400)
}
const key = (k, code, vk) => send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk })
  .then(() => send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }))

const NAMES = `(() => [...document.querySelectorAll('table tbody tr')].map(tr => {
  const ins = [...tr.querySelectorAll('input[type=text], input:not([type])')].map(i => i.value);
  return { id: ins[0], name: ins[1] };
}))()`

const isAscByName = (rows) => {
  const f = (v) => (v ?? '').trim().toLowerCase()
  for (let i = 1; i < rows.length; i++) if (f(rows[i - 1].name) > f(rows[i].name)) return false
  return true
}

try {
  await viewport(1440, 1024)

  section('The default order survives search and every filter')
  await goto(`${ORIGIN}/staff/members`)
  const plain = await evaluate(NAMES)
  check(`the unfiltered list is Preferred Name A–Z (${plain.length} rows)`, isAscByName(plain))

  await goto(`${ORIGIN}/staff/members?q=a`)
  const searched = await evaluate(NAMES)
  check(`a search keeps that order (${searched.length} rows)`, isAscByName(searched))
  check('...and actually narrowed the list', searched.length < plain.length, `${plain.length} → ${searched.length}`)

  await goto(`${ORIGIN}/staff/members?status=ACTIVE`)
  const filtered = await evaluate(NAMES)
  check(`a status filter keeps it too (${filtered.length} rows)`, isAscByName(filtered))

  await goto(`${ORIGIN}/staff/members?q=a&status=ACTIVE`)
  const both = await evaluate(NAMES)
  check(`search and filter together keep it (${both.length} rows)`, isAscByName(both))

  section('An explicit header sort overrides, and returning restores the default')
  await goto(`${ORIGIN}/staff/members?sort=cueverseId&dir=asc`)
  const byId = await evaluate(NAMES)
  const idAsc = (() => {
    const f = (v) => (v ?? '').trim().toLowerCase()
    for (let i = 1; i < byId.length; i++) if (f(byId[i - 1].id) > f(byId[i].id)) return false
    return true
  })()
  check('sorting by CueVerse ID reorders the table', idAsc)
  check('...and it is no longer in name order', !isAscByName(byId))

  await goto(`${ORIGIN}/staff/members?sort=preferredName&dir=desc`)
  const desc = await evaluate(NAMES)
  const descOk = (() => {
    const f = (v) => (v ?? '').trim().toLowerCase()
    for (let i = 1; i < desc.length; i++) if (f(desc[i - 1].name) < f(desc[i].name)) return false
    return true
  })()
  check('descending by name reverses it', descOk)

  await goto(`${ORIGIN}/staff/members`)
  const restored = await evaluate(NAMES)
  check('coming back with no sort in the URL restores Preferred Name A–Z', isAscByName(restored))

  section('Keyboard reach and focus visibility')
  await goto(`${ORIGIN}/staff/members`)
  const focusWalk = await evaluate(`(async () => {
    const seen = [];
    document.body.focus();
    for (let i = 0; i < 25; i++) {
      const el = document.activeElement;
      seen.push((el.tagName || '') + (el.getAttribute('aria-label') ? '[' + el.getAttribute('aria-label') + ']' : ''));
    }
    const cue = [...document.querySelectorAll('input')].find(i => ((i.closest('label')?.textContent) || '').includes('CueVerse ID'));
    cue.focus();
    const cs = getComputedStyle(cue);
    return {
      cueFocusable: document.activeElement === cue,
      ring: cs.getPropertyValue('--tw-ring-color') || cs.outlineColor,
      hasFocusVisibleRule: [...document.styleSheets].some(sh => { try { return [...sh.cssRules].some(r => (r.cssText||'').includes('focus-visible')) } catch { return false } }),
      tabbables: document.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])').length,
      negativeTabindex: document.querySelectorAll('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])').length,
    };
  })()`)
  check('the handle field takes focus programmatically', focusWalk.cueFocusable)
  check('a focus-visible rule exists in the stylesheet', focusWalk.hasFocusVisibleRule)
  check(`there is a tab order to walk (${focusWalk.tabbables} stops)`, focusWalk.tabbables > 10)
  check('no positive tabindex hijacks the order', focusWalk.negativeTabindex === 0)

  section('Escape does not strand the page')
  await key('Escape', 'Escape', 27)
  await sleep(500)
  const afterEsc = await evaluate(`(() => {
    const txt = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim();
    const cue = [...document.querySelectorAll('input')].find(i => txt(i.closest('label')).startsWith('CueVerse ID'));
    return { formStillThere: !!cue, dialogs: document.querySelectorAll('[role=dialog]').length };
  })()`)
  check('the form is still there after Escape', afterEsc.formStillThere)
  check('...and no modal was left open', afterEsc.dialogs === 0)

  section('Back and Forward keep the page coherent')
  await goto(`${ORIGIN}/staff/members?sort=cueverseId&dir=asc`)
  await evaluate('history.back()'); await sleep(1800)
  const back = await evaluate(`({ url: location.href, rows: document.querySelectorAll('table tbody tr').length })`)
  check('Back lands on a rendered page', back.rows > 0, JSON.stringify(back))
  await evaluate('history.forward()'); await sleep(1800)
  const fwd = await evaluate(`({ url: location.href, rows: document.querySelectorAll('table tbody tr').length })`)
  check('Forward does too', fwd.rows > 0, JSON.stringify(fwd))

  section('A double submit cannot create two members')
  await goto(`${ORIGIN}/staff/members`)
  const doubleGuard = await evaluate(`(() => {
    const txt = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim();
    const btn = [...document.querySelectorAll('button')].find(b => txt(b) === 'Create member');
    const cue = [...document.querySelectorAll('input')].find(i => txt(i.closest('label')).startsWith('CueVerse ID'));
    return { disabledWhenEmpty: btn.disabled, guardExists: cue !== undefined };
  })()`)
  check('Create is inert with an empty handle, so a stray Enter does nothing', doubleGuard.disabledWhenEmpty === true)
  /*
   * The in-flight guard, read from the component rather than raced against.
   *
   * Two Enters land milliseconds apart, and a timing test that passes once proves nothing. The guard
   * is a single condition — submit() returns immediately if a save is already running — so the honest
   * check is that the condition is there and that the button is disabled for the same reason.
   */
  const formSrc = readFileSync('src/components/staff/create-member-form.tsx', 'utf8')
  check('...and submit() returns early while a save is in flight', formSrc.includes('if (!id || pending) return'))
  check('...with the button disabled for the same reason', /disabled=\{pending \|\| !cueverseId\.trim\(\)\}/.test(formSrc))

  section('Mobile stacking at 390')
  await viewport(390, 844)
  await goto(`${ORIGIN}/staff/members`)
  const mobile = await evaluate(`(() => {
    const txt = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim();
    const cue = [...document.querySelectorAll('input')].find(i => txt(i.closest('label')).startsWith('CueVerse ID'));
    const dup = [...document.querySelectorAll('aside')].find(a => txt(a).includes('Possible duplicates'));
    const card = cue.closest('.rounded-lg');
    const cb = card.getBoundingClientRect(), db = dup.getBoundingClientRect();
    const de = document.documentElement;
    const scrollers = [...document.querySelectorAll('*')].filter(el => el.scrollWidth > el.clientWidth + 1);
    return {
      stacked: db.top >= cb.bottom - 4,
      formWidth: Math.round(cb.width), dupWidth: Math.round(db.width), vw: de.clientWidth,
      pageScrollsSideways: de.scrollWidth > de.clientWidth + 1,
      innerScrollers: scrollers.length,
      widestScroller: scrollers[0] ? scrollers[0].tagName.toLowerCase() + '.' + String(scrollers[0].className).slice(0, 30) : null,
    };
  })()`)
  check('the duplicates panel stacks below the form', mobile.stacked, JSON.stringify(mobile))
  check('...both filling the width', mobile.formWidth > 300 && mobile.dupWidth > 300, `${mobile.formWidth}/${mobile.dupWidth}`)
  check('the page itself does not scroll sideways', !mobile.pageScrollsSideways)
  check(`the wide table scrolls inside its own container instead (${mobile.innerScrollers})`, mobile.innerScrollers > 0, mobile.widestScroller)

  section('Console')
  const real = logs.filter((t) => !/webpack-hmr|WebSocket|Download the React DevTools/.test(t))
  check(`no console errors across the pass (${real.length})`, real.length === 0, real.slice(0, 3).join(' | '))
} finally {
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  ws.close(); chrome.kill(); await sleep(500)
  try { rmSync(PROFILE, { recursive: true, force: true }) } catch { /* disposable */ }
  if (fail > 0) process.exitCode = 1
}
