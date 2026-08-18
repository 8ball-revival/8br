// Drive real Chrome over CDP to measure layout — no zero-sized readings.
import { spawn } from 'node:child_process'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9333
const proc = spawn(CHROME, [
  '--headless', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${PORT}`,
  '--window-size=390,844', 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function cdpTargets() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); if (r.ok) return r.json() } catch {}
    await sleep(250)
  }
  throw new Error('Chrome did not expose a debugging port')
}

const targets = await cdpTargets()
const page = targets.find(t => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise(r => ws.addEventListener('open', r))

let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })

const URLS = process.argv.slice(2)
const WIDTHS = [1728, 1440, 1180, 768, 390]
console.log('')
for (const url of URLS) {
  for (const w of WIDTHS) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 768 })
    await send('Page.enable')
    await send('Page.navigate', { url })
    await sleep(2500)
    const r = await send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const de = document.documentElement;
        const over = [];
        for (const el of document.querySelectorAll('body *')) {
          const b = el.getBoundingClientRect();
          if (b.width > 0 && b.right > de.clientWidth + 1) {
            over.push((el.tagName.toLowerCase()) + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0,2).join('.') : '') + ' right=' + Math.round(b.right));
          }
        }
        return JSON.stringify({
          scrollW: de.scrollWidth, clientW: de.clientWidth,
          overflow: de.scrollWidth > de.clientWidth,
          worst: over.slice(0, 4),
        });
      })()`,
    })
    const v = JSON.parse(r.result?.result?.value ?? '{}')
    const tag = v.overflow ? 'OVERFLOW' : 'ok      '
    console.log(`  ${tag} ${String(w).padStart(4)}px  ${url.replace('http://localhost:3000','')||'/'}  scrollW=${v.scrollW} clientW=${v.clientW}`)
    if (v.overflow && v.worst?.length) for (const o of v.worst) console.log(`             ↳ ${o}`)
  }
}
ws.close(); proc.kill()
