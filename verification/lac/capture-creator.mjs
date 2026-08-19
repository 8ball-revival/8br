/**
 * Authenticated screenshots of the Creator completed-management workflow.
 *
 * Signs in as a THROWAWAY fixture account through the real login form, so what is captured is what
 * an authorised operator actually sees — a screenshot taken while signed out would just be the 404
 * page and would prove nothing about the pages under test.
 *
 * The reopen dialog is opened and CANCELLED. This capture never reopens a real record.
 *
 *   node verification/lac/capture-creator.mjs
 */
import { spawn } from 'node:child_process'
import { writeFile, mkdir } from 'node:fs/promises'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9361
const OUT = 'verification/lac/creator'
const BASE = 'http://localhost:3000'
const USERNAME = process.env.SHOT_USER || 'zzshotadmin'
const PASSWORD = process.env.SHOT_PASS || 'Fixture-Shot-9f2a!'
await mkdir(OUT, { recursive: true })

const WIDTHS = [1440, 390]

const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, 'about:blank'], { stdio: 'ignore' })
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
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })
  return r?.result?.result?.value ?? r?.result?.exceptionDetails?.exception?.description
}
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  if (s?.result?.data) await writeFile(`${OUT}/${name}.png`, Buffer.from(s.result.data, 'base64'))
}
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

// ── Sign in through the real form ────────────────────────────────────────────────────────────────
await send('Page.navigate', { url: `${BASE}/login` })
await sleep(3500)
const filled = await ev(`(() => {
  const set = (el, v) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const inputs = [...document.querySelectorAll('input')]
  // The form names it 'identifier' — it accepts a CueVerse ID or an email, so it is neither.
  const user = inputs.find(i => i.name === 'identifier')
  const pass = inputs.find(i => i.type === 'password')
  if (!user || !pass) return 'fields not found: ' + inputs.map(i => i.type + ':' + i.name).join(',')
  set(user, ${JSON.stringify(USERNAME)}); set(pass, ${JSON.stringify(PASSWORD)})
  const btn = [...document.querySelectorAll('button')].find(b => /sign in|log in/i.test(b.textContent))
  if (!btn) return 'submit not found'
  btn.click(); return 'submitted'
})()`)
console.log('login:', filled)
await sleep(5000)
const who = await ev(`document.body.innerText.includes('Sign In') ? 'ANONYMOUS' : 'signed in'`)
console.log('session:', who)
if (who !== 'signed in') { console.log('Could not sign in — aborting capture.'); ws.close(); proc.kill(); process.exit(1) }

const report = {}
const issues = []

async function capture(name, path, opts = {}) {
  for (const w of WIDTHS) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 1000, deviceScaleFactor: 1, mobile: w < 768 })
    await send('Page.navigate', { url: `${BASE}${path}` })
    await sleep(2600)
    if (opts.before) { await ev(opts.before); await sleep(1200) }
    const m = await ev(`(() => ({
      // Page-level horizontal overflow, measured as whether the DOCUMENT can actually be
      // scrolled sideways. documentElement.scrollWidth counts the content of scrollable
      // DESCENDANTS too, so a table that correctly scrolls inside its own pane reads as 531px of
      // page overflow that no reader can ever reach — a false alarm that hides real ones.
      overflow: (() => {
        const se = document.scrollingElement
        const before = se.scrollLeft
        se.scrollLeft = 99999
        const reached = se.scrollLeft
        se.scrollLeft = before
        return reached
      })(),
      tables: document.querySelectorAll('table').length,
      rows: document.querySelectorAll('table tbody tr').length,
      brokenImages: [...document.images].filter(i => i.complete && i.naturalWidth === 0).length,
      h1: (document.querySelector('h1')||{}).textContent || '',
      dialog: !!document.querySelector('[role="alertdialog"]'),
    }))()`)
    report[`${name}@${w}`] = m
    if (m.overflow > 0) issues.push(`${name}@${w}: page overflow ${m.overflow}px`)
    if (m.brokenImages > 0) issues.push(`${name}@${w}: ${m.brokenImages} broken image(s)`)
    await shot(`${name}-${w}`)
    if (opts.after) await ev(opts.after)
  }
}

await capture('creator-dashboard', '/creator')
await capture('completed-list', '/creator/completed')
await capture('completed-seasons', '/creator/completed?type=seasons')
await capture('completed-tournaments', '/creator/completed?type=tournaments')

// The first completed record, whichever it is.
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: `${BASE}/creator/completed` })
await sleep(2600)
const firstHref = await ev(`(() => {
  const a = document.querySelector('table tbody tr a[href^="/creator/"]')
  return a ? a.getAttribute('href') : null
})()`)
console.log('first completed record:', firstHref)

if (firstHref) {
  await capture('completed-detail', firstHref)
  // Open the reopen dialog and CANCEL it — this capture never reopens anything.
  await capture('reopen-dialog', firstHref, {
    before: `(() => { const b = [...document.querySelectorAll('button')].find(x => /Reopen for Corrections/.test(x.textContent)); if (b) b.click(); return !!b })()`,
    after: `(() => { const c = [...document.querySelectorAll('[role="alertdialog"] button')].find(x => /Cancel/.test(x.textContent)); if (c) c.click(); return !!c })()`,
  })
}

await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2))
console.log('\nchecks:', issues.length ? '\n  ' + issues.join('\n  ') : 'no overflow, no broken images at either width')
console.log('completed list rows @1440:', report['completed-list@1440']?.rows)
console.log('is a table (not tiles):', (report['completed-list@1440']?.tables ?? 0) > 0)
console.log('reopen dialog rendered:', report['reopen-dialog@1440']?.dialog)
console.log(`\nwritten to ${OUT}/`)
ws.close(); proc.kill()
