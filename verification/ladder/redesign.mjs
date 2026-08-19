/**
 * The Rankings redesign, measured in real Chrome.
 *
 * Screenshots show it looks right; only geometry shows it IS right. Every claim the redesign makes
 * that a screenshot could hide is measured here: that the pin gutter is gone rather than merely
 * empty, that Rank really is the first column, that the legend is on screen without interaction,
 * that the drawer traps the page behind it, and that nothing overflows at any of the four widths.
 *
 *   node verification/ladder/redesign.mjs
 */
import { spawn } from 'node:child_process'
import { writeFile, mkdir } from 'node:fs/promises'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9351
const BASE = process.env.BASE_URL || 'http://localhost:3000'
const OUT = 'verification/ladder/redesign'
await mkdir(OUT, { recursive: true })

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
  const i = ++id
  pending.set(i, res)
  ws.send(JSON.stringify({ id: i, method, params }))
})
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return r?.result?.result?.value
}
await send('Page.enable')
await send('Runtime.enable')

let fails = 0
const check = (n, ok, d = '') => { if (!ok) { fails++; console.log('  FAIL ' + n + (d ? ` — ${d}` : '')) } }

const EMOJI = String.raw`[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]`

const MEASURE = `(() => {
  const se = document.scrollingElement, was = se.scrollLeft
  se.scrollLeft = 99999
  const overflow = se.scrollLeft
  se.scrollLeft = was

  const table = document.querySelector('[data-rankings-table]')
  const heads = [...(table?.querySelectorAll('thead th') ?? [])].map((t) => t.textContent.trim())
  const firstCells = [...(table?.querySelectorAll('tbody tr:first-child td') ?? [])].map((t) => t.textContent.trim())
  const legend = document.querySelector('[aria-label="What the rating colours mean"]')
  const text = document.body.innerText

  return {
    overflow,
    heads,
    headerCount: heads.length,
    firstHeader: heads[0] ?? null,
    rankIsFirstCell: /^[0-9]+$/.test(firstCells[0] ?? ''),
    legendVisible: !!legend && legend.getBoundingClientRect().width > 0,
    legendLines: legend ? legend.querySelectorAll('li').length : 0,
    legendText: legend ? legend.innerText.replace(/\\s+/g, ' ').trim() : null,
    removed: {
      allTime: /\\bAll Time\\b/.test(text),
      groupPlay: /Group Play/.test(text),
      presets: /SAVED VIEWS|Presets/i.test(text),
      density: /\\bCompact\\b/.test(text),
      pinIcon: !!document.querySelector('[aria-label*="Pin "], [aria-label*="Unpin"]'),
      pinnedBody: !!document.querySelector('[data-rankings-pinned]'),
    },
    moreFilters: text.includes('More Filters'),
    exportCsv: text.includes('Export CSV'),
    rowHeights: [...new Set([...(table?.querySelectorAll('tbody tr') ?? [])]
      .map((r) => +r.getBoundingClientRect().height.toFixed(1)))].filter((h) => h > 0),
    clipped: [...document.querySelectorAll('th, td, button, label, li')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible').length,
  }
})()`

const results = {}

for (const [label, width, height] of [['1440', 1440, 900], ['1180', 1180, 820], ['768', 768, 900], ['390', 390, 844]]) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 })
  await send('Page.navigate', { url: `${BASE}/rankings` })
  await sleep(3200)

  const m = await ev(MEASURE)
  results[label] = m
  console.log(`\n── ${label}px`)
  console.log(`  ${m.headerCount} columns, first = "${m.firstHeader}"`)
  console.log(`  legend ${m.legendVisible ? 'visible' : 'MISSING'} (${m.legendLines} lines)`)
  console.log(`  overflow ${m.overflow} · clipped ${m.clipped} · row heights ${m.rowHeights.join('/')}`)

  check(`${label}: no page-level horizontal overflow`, m.overflow === 0, String(m.overflow))
  // Each header renders a short visible label plus a screen-reader-only full one, so textContent
  // reads "RankRank". The assertion is about which column comes first, not about that duplication.
  check(`${label}: Rank is the first column`, m.firstHeader.startsWith('Rank'), String(m.firstHeader))
  check(`${label}: the first cell is a rank number, not a gutter`, m.rankIsFirstCell)
  check(`${label}: the legend is visible without interaction`, m.legendVisible)
  check(`${label}: the legend states all seven bands`, m.legendLines === 7, String(m.legendLines))
  check(`${label}: More Filters is offered`, m.moreFilters)
  check(`${label}: Export CSV is offered`, m.exportCsv)
  check(`${label}: no All Time switch`, !m.removed.allTime)
  check(`${label}: no Group Play switch`, !m.removed.groupPlay)
  check(`${label}: no presets`, !m.removed.presets)
  check(`${label}: no density control`, !m.removed.density)
  check(`${label}: no pin icons`, !m.removed.pinIcon)
  check(`${label}: no pinned section`, !m.removed.pinnedBody)
  check(`${label}: nothing is clipped`, m.clipped === 0, String(m.clipped))
  check(`${label}: the championship headers carry no icon`,
    !m.heads.some((h) => new RegExp(EMOJI, 'u').test(h)), m.heads.join(' | '))

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile(`${OUT}/closed-${label}.png`, Buffer.from(shot.result.data, 'base64'))
}

// ── The drawer, open.
for (const [label, width, height] of [['1440', 1440, 900], ['390', 390, 844]]) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 })
  await send('Page.navigate', { url: `${BASE}/rankings` })
  await sleep(3000)
  await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('More Filters'))?.click()`)
  await sleep(700)

  const d = await ev(`(() => {
    const dlg = document.querySelector('[role="dialog"]')
    if (!dlg) return { open: false }
    const r = dlg.getBoundingClientRect()
    const se = document.scrollingElement, was = se.scrollLeft
    se.scrollLeft = 99999
    const overflow = se.scrollLeft
    se.scrollLeft = was
    const scroller = dlg.querySelector('.overflow-y-auto')
    return {
      open: true,
      width: +r.width.toFixed(0),
      fullHeight: Math.abs(r.height - window.innerHeight) < 2,
      modal: dlg.getAttribute('aria-modal') === 'true',
      labelled: !!dlg.getAttribute('aria-labelledby'),
      bodyLocked: getComputedStyle(document.body).overflow === 'hidden',
      drawerOverflowX: scroller ? scroller.scrollWidth - scroller.clientWidth : 0,
      pageOverflow: overflow,
      sections: dlg.querySelectorAll('section').length,
      hasApply: dlg.innerText.includes('Apply Filters'),
      hasDefaults: dlg.innerText.includes('Defaults'),
      focusInside: dlg.contains(document.activeElement),
    }
  })()`)

  console.log(`\n── drawer @ ${label}px`)
  console.log(`  width ${d.width} · sections ${d.sections} · body locked ${d.bodyLocked} · focus inside ${d.focusInside}`)
  check(`${label}: the drawer opens`, d.open === true)
  check(`${label}: it is a labelled modal dialog`, d.modal && d.labelled)
  check(`${label}: it is full height`, d.fullHeight)
  check(`${label}: the page behind cannot scroll`, d.bodyLocked)
  check(`${label}: the drawer has no horizontal overflow`, d.drawerOverflowX === 0, String(d.drawerOverflowX))
  check(`${label}: opening it causes no page overflow`, d.pageOverflow === 0, String(d.pageOverflow))
  check(`${label}: Apply and Defaults are both present`, d.hasApply && d.hasDefaults)
  check(`${label}: focus moved into the drawer`, d.focusInside)
  if (label === '1440') check('desktop width is 420–480px', d.width >= 420 && d.width <= 480, String(d.width))
  if (label === '390') check('mobile is full-screen', d.width >= 380, String(d.width))

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile(`${OUT}/drawer-${label}.png`, Buffer.from(shot.result.data, 'base64'))

  // Escape must close it AND discard the draft — the URL is the proof.
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(500)
  const closed = await ev(`({ dialog: !!document.querySelector('[role="dialog"]'), url: location.search })`)
  check(`${label}: Escape closes the drawer`, !closed.dialog)
  check(`${label}: closing without Apply changes nothing`, closed.url === '', closed.url)
}

// ── A filtered view, with chips.
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: `${BASE}/rankings?from=2005&to=2005&min=3&cols=record,matchWinPct` })
await sleep(3200)
const f = await ev(`(() => {
  const se = document.scrollingElement, was = se.scrollLeft
  se.scrollLeft = 99999
  const o = se.scrollLeft
  se.scrollLeft = was
  const chips = [...document.querySelectorAll('button')]
    .filter((b) => /^(Years|Year|Minimum Matches|Columns):/.test(b.textContent.trim()))
  return {
    overflow: o,
    chipLabels: chips.map((c) => c.textContent.replace(/\\s+/g, ' ').trim()),
    badge: [...document.querySelectorAll('[aria-label*="filter"]')].map((e) => e.textContent.trim()),
    clearAll: document.body.innerText.includes('Clear All'),
    headers: [...document.querySelectorAll('[data-rankings-table] thead th')].map((t) => t.textContent.trim()),
  }
})()`)
console.log('\n── filtered view (2005 only, minimum 3 matches, two optional columns)')
console.log(`  chips: ${f.chipLabels.join(' · ')}`)
console.log(`  headers: ${f.headers.join(' | ')}`)
check('applied chips are shown', f.chipLabels.length >= 3, f.chipLabels.join(','))
check('Clear All is offered', f.clearAll)
check('the More Filters badge counts groups', f.badge.length > 0, f.badge.join(','))
check('hidden columns really are hidden', !f.headers.includes('Streak'), f.headers.join('|'))
check('a filtered view has no horizontal overflow', f.overflow === 0, String(f.overflow))
let shot = await send('Page.captureScreenshot', { format: 'png' })
await writeFile(`${OUT}/filtered-1440.png`, Buffer.from(shot.result.data, 'base64'))

// ── Light theme.
await ev(`document.documentElement.classList.add('light')`)
await sleep(500)
shot = await send('Page.captureScreenshot', { format: 'png' })
await writeFile(`${OUT}/light-1440.png`, Buffer.from(shot.result.data, 'base64'))

await writeFile(`${OUT}/measurements.json`, JSON.stringify(results, null, 2))
console.log(`\n${fails === 0 ? 'OK' : fails + ' FAILED'} — screenshots and measurements in ${OUT}`)

ws.close()
proc.kill()
process.exit(fails === 0 ? 0 : 1)
