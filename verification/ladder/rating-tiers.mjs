/**
 * The primary Rating treatment, measured in real Chrome.
 *
 * Screenshots prove it looks right; only geometry proves it changed nothing. So this asserts the
 * things a subtle visual treatment quietly breaks:
 *
 *   - the row is no taller with the treatment than without it (measured by stripping the class from
 *     a live row and re-measuring, not by trusting the CSS);
 *   - the rendered size stays close to the surrounding figures rather than dominating them;
 *   - the number is tabular, so sorting cannot make digits jump sideways;
 *   - every tier resolves to a distinct colour in BOTH themes, including the two tiers the live data
 *     happens not to contain;
 *   - reduced motion leaves a static glow rather than no glow;
 *   - the page still has no horizontal overflow, measured by trying to scroll it.
 *
 *   node verification/ladder/rating-tiers.mjs
 */
import { spawn } from 'node:child_process'
import { writeFile, mkdir } from 'node:fs/promises'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9341
const BASE = process.env.BASE_URL || 'http://localhost:3000'
const OUT = 'verification/ladder/rating-tiers'
await mkdir(OUT, { recursive: true })

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

const TIERS = ['gold', 'purple', 'blue', 'green', 'red', 'grey']

const MEASURE = `(() => {
  const cells = [...document.querySelectorAll('.rating-primary')]
  if (!cells.length) return { error: 'no treated rating cells found' }

  const cell = cells[0]
  const td = cell.closest('td')
  const cs = getComputedStyle(cell)

  // Layout-shift probe. Strip the treatment from a real row, force a reflow, re-measure, restore.
  // The CSS says it changes no layout; this is the row saying so.
  const saved = cell.className
  const treated = +td.getBoundingClientRect().height.toFixed(2)
  cell.className = ''
  void td.offsetHeight
  const bare = +td.getBoundingClientRect().height.toFixed(2)
  cell.className = saved
  void td.offsetHeight
  const restored = +td.getBoundingClientRect().height.toFixed(2)

  // Every tier's colour, including the ones the live data does not reach.
  const colours = {}
  for (const t of ${JSON.stringify(TIERS)}) {
    const s = document.createElement('span')
    s.className = 'rating-primary rating-primary--' + t
    s.textContent = '1250'
    td.appendChild(s)
    const c = getComputedStyle(s)
    colours[t] = { color: c.color, shadow: c.textShadow }
    s.remove()
  }

  // A neighbouring numeric cell, to check the emphasis is a nudge rather than a jump.
  const neighbour = [...td.parentElement.querySelectorAll('td')].find((x) => x !== td && /^[0-9]/.test(x.textContent.trim()))

  const se = document.scrollingElement
  const wasLeft = se.scrollLeft
  se.scrollLeft = 99999
  const overflow = se.scrollLeft
  se.scrollLeft = wasLeft

  const rowHeights = [...new Set([...document.querySelectorAll('td')]
    .filter((x) => x.querySelector('.rating-primary'))
    .map((x) => +x.getBoundingClientRect().height.toFixed(1)))]

  return {
    count: cells.length,
    tiersInLiveData: [...new Set(cells.map((c) => [...c.classList].find((x) => x.startsWith('rating-primary--'))))].sort(),
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    numeric: cs.fontVariantNumeric,
    animation: cs.animationName + ' ' + cs.animationDuration,
    restingShadow: cs.textShadow,
    neighbourFontSize: neighbour ? getComputedStyle(neighbour).fontSize : null,
    ariaSample: cells.slice(0, 3).map((c) => c.getAttribute('aria-label')),
    untreatedAria: [...document.querySelectorAll('td')]
      .filter((x) => x.textContent.trim() === '—' && !x.querySelector('.rating-primary')).length,
    layout: { treated, bare, restored, delta: +(treated - bare).toFixed(2) },
    distinctRatingCellHeights: rowHeights,
    pageHorizontalOverflow: overflow,
    colours,
  }
})()`

const results = {}
let failures = 0
const check = (n, ok, d = '') => {
  if (!ok) { failures++; console.log('  FAIL ' + n + (d ? ` — ${d}` : '')) }
}

for (const width of [1440, 390]) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height: 900, deviceScaleFactor: 1, mobile: width < 768,
  })
  await send('Page.navigate', { url: `${BASE}/rankings` })
  await sleep(3500)
  await evaluate(`document.querySelector('.rating-primary')?.scrollIntoView({ block: 'center', behavior: 'instant' })`)
  await sleep(300)

  const m = await evaluate(MEASURE)
  results[width] = m
  console.log(`\n── ${width}px`)
  if (!m || m.error) { console.log('  ' + (m?.error ?? 'no result')); failures++; continue }

  console.log(`  ${m.count} treated cells, tiers present: ${m.tiersInLiveData.join(', ')}`)
  console.log(`  size ${m.fontSize} (neighbour ${m.neighbourFontSize}), weight ${m.fontWeight}, ${m.numeric}`)
  console.log(`  animation: ${m.animation}`)
  console.log(`  row height treated ${m.layout.treated} vs untreated ${m.layout.bare} (delta ${m.layout.delta})`)
  console.log(`  horizontal page overflow: ${m.pageHorizontalOverflow}`)
  console.log(`  aria: ${m.ariaSample.join(' | ')}`)

  check(`${width}: the treatment adds no row height`, m.layout.delta === 0, String(m.layout.delta))
  check(`${width}: the row returns to its measured height`, m.layout.treated === m.layout.restored)
  check(`${width}: no page-level horizontal overflow`, m.pageHorizontalOverflow === 0,
    String(m.pageHorizontalOverflow))
  check(`${width}: bold`, m.fontWeight === '700')
  check(`${width}: tabular`, m.numeric.includes('tabular-nums'))
  check(`${width}: the glow breathes slowly`, /rating-breathe (2\.5|3|3\.5)s/.test(m.animation), m.animation)
  check(`${width}: a resting glow exists, so reduced motion keeps the tier`,
    m.restingShadow !== 'none' && m.restingShadow.length > 0, m.restingShadow)

  const neighbour = parseFloat(m.neighbourFontSize ?? '0')
  const own = parseFloat(m.fontSize)
  const ratio = neighbour ? +(own / neighbour).toFixed(3) : null
  console.log(`  emphasis ratio vs neighbouring figure: ${ratio}`)
  check(`${width}: emphasised but not oversized`, ratio !== null && ratio > 1 && ratio <= 1.12, String(ratio))

  const colours = Object.values(m.colours).map((c) => c.color)
  check(`${width}: all six tiers resolve to distinct colours`, new Set(colours).size === 6,
    JSON.stringify(m.colours))
  check(`${width}: every tier carries a glow`,
    Object.values(m.colours).every((c) => c.shadow && c.shadow !== 'none'))

  /*
   * The decisive layout test: every row measured, the whole treatment then neutralised, every row
   * measured again.
   *
   * Rankings rows are legitimately not all one height — a long player name wraps the Player column —
   * so "all rows are equal" would be asserting something that was never true. What must hold is that
   * THIS change moves nothing: each row is the height it would have been without the treatment.
   */
  const shift = await evaluate(`(() => {
    const rows = () => [...document.querySelectorAll('tr')]
      .filter((r) => r.querySelector('.rating-primary'))
      .map((r) => +r.getBoundingClientRect().height.toFixed(2))
    const before = rows()
    const kill = document.createElement('style')
    kill.textContent = '.rating-primary{font-weight:inherit!important;font-size:inherit!important;line-height:inherit!important;text-shadow:none!important;animation:none!important;color:inherit!important}'
    document.head.appendChild(kill)
    void document.body.offsetHeight
    const after = rows()
    kill.remove()
    void document.body.offsetHeight
    return {
      rows: before.length,
      maxDelta: Math.max(0, ...before.map((h, i) => Math.abs(h - after[i]))),
      distinct: [...new Set(before)].sort((a, b) => a - b),
    }
  })()`)
  console.log(`  ${shift.rows} rows measured with and without the treatment — max height delta ${shift.maxDelta}`)
  console.log(`  (rows are ${shift.distinct.join('/')}px tall; long names wrap the Player column, which predates this change)`)
  check(`${width}: not one row changes height`, shift.maxDelta === 0, String(shift.maxDelta))
  check(`${width}: every row was measured`, shift.rows === m.count, `${shift.rows} vs ${m.count}`)

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile(`${OUT}/rankings-${width}.png`, Buffer.from(shot.result.data, 'base64'))

  /*
   * Every tier, on screen at once.
   *
   * The live data only reaches four bands, so two would otherwise never be seen. This injects a
   * read-only swatch strip built from the same classes the table uses — no real rating is edited,
   * nothing is written, and the strip is removed straight after the capture.
   */
  await evaluate(`(() => {
    document.getElementById('tier-strip')?.remove()
    const strip = document.createElement('div')
    strip.id = 'tier-strip'
    strip.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;display:flex;flex-wrap:wrap;gap:0.75rem 1.25rem;justify-content:center;padding:0.9rem;background:var(--card);border-top:1px solid var(--border)'
    const rows = [['gold', 1667], ['purple', 1540], ['blue', 1450], ['green', 1350], ['red', 1250], ['grey', 1150], [null, null]]
    for (const [tier, rating] of rows) {
      const wrap = document.createElement('span')
      wrap.style.cssText = 'display:inline-flex;align-items:baseline;gap:0.4rem;font-size:0.75rem;color:var(--muted-foreground)'
      const n = document.createElement('span')
      if (tier) { n.className = 'rating-primary rating-primary--' + tier; n.textContent = String(rating) }
      else { n.style.color = 'var(--muted-foreground)'; n.textContent = '—' }
      wrap.appendChild(n)
      const l = document.createElement('span')
      l.textContent = tier ? tier : 'no rating'
      wrap.appendChild(l)
      strip.appendChild(wrap)
    }
    document.body.appendChild(strip)
  })()`)
  await sleep(500)
  const stripShot = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile(`${OUT}/tiers-${width}.png`, Buffer.from(stripShot.result.data, 'base64'))
  await evaluate(`document.getElementById('tier-strip')?.remove()`)
}

// Reduced motion: the animation stops, the glow does not.
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: `${BASE}/rankings` })
await sleep(3500)
const reduced = await evaluate(`(() => {
  const el = document.querySelector('.rating-primary')
  if (!el) return { error: 'no treated cell' }
  const cs = getComputedStyle(el)
  return { duration: cs.animationDuration, shadow: cs.textShadow, color: cs.color }
})()`)
results.reducedMotion = reduced
console.log('\n── prefers-reduced-motion: reduce')
console.log(`  animation-duration ${reduced.duration}`)
console.log(`  shadow ${reduced.shadow}`)
check('reduced motion stops the animation', parseFloat(reduced.duration) < 0.01, reduced.duration)
check('reduced motion keeps a static glow', reduced.shadow && reduced.shadow !== 'none', reduced.shadow)
const shot = await send('Page.captureScreenshot', { format: 'png' })
await writeFile(`${OUT}/rankings-reduced-motion.png`, Buffer.from(shot.result.data, 'base64'))

// The light theme, where the darkened tier tokens have to carry contrast on a near-white ground.
await send('Emulation.setEmulatedMedia', { features: [] })
await send('Page.navigate', { url: `${BASE}/rankings` })
await sleep(3000)
await evaluate(`document.documentElement.classList.add('light')`)
await sleep(400)
const light = await evaluate(`(() => {
  const out = {}
  const host = document.querySelector('.rating-primary')?.closest('td') ?? document.body
  for (const t of ${JSON.stringify(TIERS)}) {
    const s = document.createElement('span')
    s.className = 'rating-primary rating-primary--' + t
    s.textContent = '1250'
    host.appendChild(s)
    out[t] = getComputedStyle(s).color
    s.remove()
  }
  return out
})()`)
results.lightTheme = light
console.log('\n── light theme')
check('all six tiers resolve distinctly in the light theme',
  new Set(Object.values(light)).size === 6, JSON.stringify(light))
await evaluate(`(() => {
  const strip = document.createElement('div')
  strip.id = 'tier-strip'
  strip.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;display:flex;flex-wrap:wrap;gap:0.75rem 1.25rem;justify-content:center;padding:0.9rem;background:var(--card);border-top:1px solid var(--border)'
  for (const [tier, rating] of [['gold', 1667], ['purple', 1540], ['blue', 1450], ['green', 1350], ['red', 1250], ['grey', 1150]]) {
    const n = document.createElement('span')
    n.className = 'rating-primary rating-primary--' + tier
    n.textContent = String(rating)
    strip.appendChild(n)
  }
  document.body.appendChild(strip)
})()`)
await sleep(500)
const lightShot = await send('Page.captureScreenshot', { format: 'png' })
await writeFile(`${OUT}/rankings-light.png`, Buffer.from(lightShot.result.data, 'base64'))

await writeFile(`${OUT}/measurements.json`, JSON.stringify(results, null, 2))
console.log(`\n${failures === 0 ? 'OK' : failures + ' FAILED'} — screenshots and measurements in ${OUT}`)

ws.close()
proc.kill()
process.exit(failures === 0 ? 0 : 1)
