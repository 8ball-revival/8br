/**
 * Screenshots and layout checks for the Live / Archives / navigation work.
 *
 * Same CDP approach as the Rankings harness: a real browser, so what is captured is what renders.
 * Each page is checked for page-level horizontal overflow at every width, because that is the
 * failure a screenshot alone hides at the bottom of a long page.
 */
import { spawn } from 'node:child_process'
import { writeFile, mkdir } from 'node:fs/promises'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9351
const OUT = 'verification/lac/after'
await mkdir(OUT, { recursive: true })
const WIDTHS = [1728, 1440, 1180, 768, 390]
const PAGES = [
  ['home', '/'],
  ['live-seasons', '/live/seasons'],
  ['live-tournaments', '/live/tournaments'],
  ['archives-seasons', '/archives/seasons'],
  ['archives-tournaments', '/archives/tournaments'],
  ['archives-filtered', '/archives/seasons?year=2005&sort=oldest'],
  ['rankings', '/rankings'],
]

const proc = spawn(CHROME, ['--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars',`--remote-debugging-port=${PORT}`,'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let list
for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); if (r.ok) { list = await r.json(); break } } catch {} await sleep(250) }
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0; const pending = new Map()
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r?.result?.result?.value }
await send('Page.enable'); await send('Runtime.enable')

const report = {}
const issues = []
for (const [name, path] of PAGES) {
  report[name] = {}
  for (const w of WIDTHS) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 1000, deviceScaleFactor: 1, mobile: w < 768 })
    await send('Page.navigate', { url: `http://localhost:3000${path}` })
    await sleep(w === WIDTHS[0] ? 3200 : 2000)
    const m = await ev(`(() => {
      const nav = [...document.querySelectorAll('nav[aria-label="Primary"] a, nav[aria-label="Primary"] button')].map(e => e.textContent.trim()).filter(Boolean)
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        navItems: nav,
        title: (document.querySelector('h1')||{}).textContent || '',
        brokenImages: [...document.images].filter(i => i.complete && i.naturalWidth === 0).length,
      }
    })()`)
    report[name][w] = m
    if (m.overflow > 0) issues.push(`${name}@${w}: page overflow ${m.overflow}px`)
    if (m.brokenImages > 0) issues.push(`${name}@${w}: ${m.brokenImages} broken image(s)`)
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    if (shot?.result?.data) await writeFile(`${OUT}/${name}-${w}.png`, Buffer.from(shot.result.data, 'base64'))
  }
}
await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2))
console.log('\nnav at 1728:', JSON.stringify(report.home[1728].navItems))
console.log('overflow / broken images:', issues.length ? '\n  ' + issues.join('\n  ') : 'none at any width')
console.log(`\nwritten to ${OUT}/`)
ws.close(); proc.kill()
