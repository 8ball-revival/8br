// Screenshots AND layout checks from the same CDP session, so an image always matches its measurement.
import { spawn } from 'node:child_process'
import { writeFile, mkdir } from 'node:fs/promises'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9334
const OUT = 'verification/screenshots'
await mkdir(OUT, { recursive: true })

const proc = spawn(CHROME, ['--headless','--disable-gpu','--no-sandbox',`--remote-debugging-port=${PORT}`,'about:blank'], { stdio: 'ignore' })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let list
for (let i = 0; i < 40; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); if (r.ok) { list = await r.json(); break } } catch {} await sleep(250) }
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl)
await new Promise(r => ws.addEventListener('open', r))
let id = 0; const pending = new Map()
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })

const PAGES = [
  ['home', '/'], ['news', '/news'],
  ['article', '/news/a-tribute-to-major-league-pool'],
  ['ladder', '/rankings'], ['register', '/register'],
  ['admin-settings', '/staff/settings'],
]
const WIDTHS = [1728, 1440, 1180, 768, 390]
await send('Page.enable')
const problems = []
console.log('')
for (const [name, path] of PAGES) {
  for (const w of WIDTHS) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 768 })
    await send('Page.navigate', { url: `http://localhost:3000${path}` })
    await sleep(2600)
    const r = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
      const de = document.documentElement
      const clipped = []
      for (const el of document.querySelectorAll('h1,h2,h3,p,td,th,a,button')) {
        if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow === 'visible') {
          clipped.push(el.tagName.toLowerCase() + ':' + (el.textContent||'').trim().slice(0,28))
        }
      }
      return JSON.stringify({ sw: de.scrollWidth, cw: de.clientWidth, title: document.title.slice(0,40), clipped: clipped.slice(0,3) })
    })()` })
    const v = JSON.parse(r.result?.result?.value ?? '{}')
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    if (shot.result?.data) await writeFile(`${OUT}/${name}-${w}.png`, Buffer.from(shot.result.data, 'base64'))
    const over = v.sw > v.cw
    if (over) problems.push(`${name}@${w}: horizontal overflow (${v.sw} > ${v.cw})`)
    if (v.clipped?.length) problems.push(`${name}@${w}: clipped text — ${v.clipped.join(' | ')}`)
    console.log(`  ${over ? 'OVERFLOW' : 'ok      '} ${String(w).padStart(4)}  ${name.padEnd(15)} ${v.sw}/${v.cw}`)
  }
}
console.log(problems.length ? `\n  PROBLEMS:\n${problems.map(p => '    ✗ ' + p).join('\n')}` : '\n  No overflow or clipped text at any width.')
ws.close(); proc.kill()
