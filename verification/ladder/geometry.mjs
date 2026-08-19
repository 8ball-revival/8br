/**
 * Rankings geometry and screenshots, from real Chrome over CDP.
 *
 * The measurement that matters is container alignment: the Rankings frame must share the header's
 * exact left and right edges. That cannot be eyeballed and it cannot be asserted from CSS classes —
 * a shared token is only shared if it renders the same, so this reads `getBoundingClientRect()` on
 * both and compares.
 *
 * Also captured, because each has failed here before or is required to stay fixed:
 *   - the Player column's rendered width (it used to consume the table);
 *   - documentElement.scrollWidth vs clientWidth (page-level horizontal overflow);
 *   - whether Rank and Player actually stay put when the table is scrolled sideways;
 *   - where the sticky column header lands relative to the bottom of the fixed navigation.
 *
 *   node verification/ladder/geometry.mjs before
 *   node verification/ladder/geometry.mjs after
 */
import { spawn } from 'node:child_process'
import { writeFile, mkdir } from 'node:fs/promises'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9336
const LABEL = process.argv[2] || 'run'
const BASE = process.env.BASE_URL || 'http://localhost:3000'
const OUT = `verification/ladder/${LABEL}`
await mkdir(OUT, { recursive: true })

const WIDTHS = [1728, 1440, 1180, 768, 390]

/** Named views to capture. Query strings are the point: the page is a function of the URL. */
const VIEWS = [
  ['standard', '/rankings'],
  ['compact', '/rankings?density=compact'],
  ['full', '/rankings?density=full'],
  ['custom-columns', '/rankings?cols=rank,player,record,rating,titles,peakRating'],
  ['expanded-row', '/rankings?expand=FIRST_PLAYER'],
  ['mode-sc', '/rankings?mode=SC'],
  ['mode-tc', '/rankings?mode=TC'],
  ['sorted-by-rating', '/rankings?sort=rating:desc'],
  ['filters-active', '/rankings?min=5&champs=1&scope=all-time'],
  ['division', '/rankings?division=A'],
  ['compare', '/rankings?compare=FIRST_TWO'],
  ['pinned', '/rankings'],
  ['empty-state', '/rankings?q=zzzzzznobodyzzzzzz'],
]

const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let list
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); if (r.ok) { list = await r.json(); break } } catch { /* not up yet */ }
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
  const i = ++id
  pending.set(i, res)
  ws.send(JSON.stringify({ id: i, method, params }))
})
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return r?.result?.result?.value
}

await send('Page.enable')
await send('Runtime.enable')

/**
 * Read the geometry in the page.
 *
 * Selectors are data attributes rather than class names so a styling change cannot silently break
 * the measurement into reading `null` and passing.
 */
const MEASURE = `(() => {
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: +r.left.toFixed(2), right: +r.right.toFixed(2), width: +r.width.toFixed(2), top: +r.top.toFixed(2), bottom: +r.bottom.toFixed(2) } }
  const nav    = document.querySelector('header')
  // Fallbacks let the BEFORE run measure the same things on markup that predates the data
  // attributes. Without them a baseline would read null everywhere and compare against nothing.
  const header = document.querySelector('[data-site-container="header"]') || (nav && nav.firstElementChild)
  const table  = document.querySelector('[data-rankings-table]') || document.querySelector('main table, table')
  const frame  = document.querySelector('[data-site-container="rankings"]')
              || (() => { let el = table; while (el && el !== document.body) { const cs = getComputedStyle(el); if (cs.maxWidth && cs.maxWidth !== 'none') return el; el = el.parentElement } return null })()
  const headRow = table && table.querySelector('thead tr')
  const cells   = headRow ? [...headRow.children] : []
  const byCol = (k, idx) => document.querySelector('th[data-col="' + k + '"]') || cells[idx] || null
  const playerTh = byCol('player', 2)
  const rankTh   = byCol('rank', 1)
  const scroller = document.querySelector('[data-rankings-scroller]')
              || (table && table.closest('.overflow-x-auto'))
  const thead    = headRow
  return {
    header: rect(header),
    frame: rect(frame),
    nav: rect(nav),
    navHeight: nav ? +nav.getBoundingClientRect().height.toFixed(2) : null,
    playerCol: rect(playerTh),
    rankCol: rect(rankTh),
    stickyHeaderTop: thead ? +thead.getBoundingClientRect().top.toFixed(2) : null,
    page: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    },
    scroller: scroller ? {
      scrollWidth: scroller.scrollWidth,
      clientWidth: scroller.clientWidth,
      scrollable: scroller.scrollWidth > scroller.clientWidth,
    } : null,
    rowCount: (table ? table.querySelectorAll('tbody tr').length : 0),
  }
})()`

/** Scroll the table sideways and confirm Rank and Player did not move with it. */
const STICKY_PROBE = `(async () => {
  const table = document.querySelector('[data-rankings-table]') || document.querySelector('main table, table')
  const scroller = document.querySelector('[data-rankings-scroller]') || (table && table.closest('.overflow-x-auto'))
  if (!scroller) return { tested: false, reason: 'no scroller' }
  const headRow = table && table.querySelector('thead tr')
  const cells = headRow ? [...headRow.children] : []
  const rankTh = document.querySelector('th[data-col="rank"]') || cells[1]
  const playerTh = document.querySelector('th[data-col="player"]') || cells[2]
  if (!rankTh || !playerTh) return { tested: false, reason: 'no rank/player header' }
  if (scroller.scrollWidth <= scroller.clientWidth) return { tested: false, reason: 'table fits, nothing to scroll' }
  const before = { rank: rankTh.getBoundingClientRect().left, player: playerTh.getBoundingClientRect().left }
  scroller.scrollLeft = Math.min(400, scroller.scrollWidth - scroller.clientWidth)
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  const after = { rank: rankTh.getBoundingClientRect().left, player: playerTh.getBoundingClientRect().left }
  const scrolled = scroller.scrollLeft
  scroller.scrollLeft = 0
  return {
    tested: true, scrolled,
    rankMoved: +Math.abs(after.rank - before.rank).toFixed(2),
    playerMoved: +Math.abs(after.player - before.player).toFixed(2),
    rankSticky: Math.abs(after.rank - before.rank) < 1,
    playerSticky: Math.abs(after.player - before.player) < 1,
  }
})()`

/** Scroll the page down and confirm the column header parks under the navigation, not behind it. */
const STICKY_HEADER_PROBE = `(async () => {
  const nav = document.querySelector('header')
  const table = document.querySelector('[data-rankings-table]') || document.querySelector('main table, table')
  const thead = table && table.querySelector('thead tr')
  if (!nav || !thead) return { tested: false }
  window.scrollTo(0, 600)
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  const navBottom = nav.getBoundingClientRect().bottom
  const headTop = thead.getBoundingClientRect().top
  window.scrollTo(0, 0)
  return { tested: true, navBottom: +navBottom.toFixed(2), headTop: +headTop.toFixed(2), gap: +(headTop - navBottom).toFixed(2) }
})()`

const report = { label: LABEL, base: BASE, capturedAt: new Date().toISOString(), views: {} }

// A couple of views need real ids from the page, so resolve them once at the default width.
await send('Emulation.setDeviceMetricsOverride', { width: 1728, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: `${BASE}/rankings` })
await sleep(4000)
const ids = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('[data-rankings-table] tbody tr[data-player-row]')]
  return rows.slice(0, 2).map(r => r.getAttribute('data-player-row')).filter(Boolean)
})()`) || []
const first = ids[0] || ''
const firstTwo = ids.slice(0, 2).join(',')

for (const [name, rawPath] of VIEWS) {
  const path = rawPath.replace('FIRST_PLAYER', encodeURIComponent(first)).replace('FIRST_TWO', encodeURIComponent(firstTwo))
  report.views[name] = { path, widths: {} }
  for (const w of WIDTHS) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: w, height: 1000, deviceScaleFactor: 1, mobile: w < 768,
    })
    await send('Page.navigate', { url: `${BASE}${path}` })
    await sleep(w === WIDTHS[0] ? 3500 : 2200)

    // The pinned view needs a pin in local storage before it means anything.
    if (name === 'pinned' && first) {
      await evaluate(`localStorage.setItem('8br.rankings.pins', JSON.stringify([${JSON.stringify(first)}]))`)
      await send('Page.navigate', { url: `${BASE}${path}` })
      await sleep(2000)
    }

    const geom = await evaluate(MEASURE)
    const sticky = await evaluate(STICKY_PROBE)
    const stickyHead = await evaluate(STICKY_HEADER_PROBE)
    report.views[name].widths[w] = { ...geom, sticky, stickyHead }

    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    if (shot?.result?.data) {
      await writeFile(`${OUT}/${name}-${w}.png`, Buffer.from(shot.result.data, 'base64'))
    }
  }
}

await writeFile(`${OUT}/geometry.json`, JSON.stringify(report, null, 2))

// ── Console summary: only what a reader needs to judge the result.
console.log(`\n${LABEL} — ${BASE}\n`)
const d = report.views.standard?.widths ?? {}
console.log('view: standard')
console.log('  width   header edges          frame edges           Δleft  Δright  player col  page overflow')
for (const w of WIDTHS) {
  const m = d[w]
  if (!m) continue
  const h = m.header, f = m.frame
  const dl = h && f ? (f.left - h.left).toFixed(2) : 'n/a'
  const dr = h && f ? (f.right - h.right).toFixed(2) : 'n/a'
  console.log(
    `  ${String(w).padEnd(6)}  ${(h ? `${h.left} → ${h.right}` : 'MISSING').padEnd(20)}  ${(f ? `${f.left} → ${f.right}` : 'MISSING').padEnd(20)}  ${String(dl).padStart(5)}  ${String(dr).padStart(6)}  ${String(m.playerCol?.width ?? 'n/a').padStart(10)}  ${String(m.page.overflow).padStart(13)}`,
  )
}
const s = d[1728]?.sticky
if (s) console.log(`\n  sticky columns @1728: ${s.tested ? `rank ${s.rankSticky ? 'held' : `MOVED ${s.rankMoved}px`}, player ${s.playerSticky ? 'held' : `MOVED ${s.playerMoved}px`} (scrolled ${s.scrolled}px)` : `not tested — ${s.reason}`}`)
const sh = d[1728]?.stickyHead
if (sh?.tested) console.log(`  sticky header @1728:  nav bottom ${sh.navBottom}, header top ${sh.headTop}, gap ${sh.gap}`)

console.log(`\nwritten to ${OUT}/`)
ws.close()
proc.kill()
