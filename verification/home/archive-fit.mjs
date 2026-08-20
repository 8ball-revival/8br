/**
 * The archive card's text fills its box, measured in real Chrome.
 *
 * The card cannot shrink to its content — its height is set by the statistic tiles beside it — so the
 * type has to grow into the space instead. A screenshot shows it looks better; only measurement shows
 * it is actually fitted, so this asserts the things a fitted-text routine gets wrong:
 *
 *   - the text genuinely FILLS the box rather than sitting small in it;
 *   - it never overflows, in either dimension, at any size;
 *   - a short line is capped, so two words do not render as a headline;
 *   - a long line shrinks to fit instead of being clipped, and stops at the floor rather than
 *     shrinking into something unreadable;
 *   - re-fitting follows the box: the text is re-measured when the viewport changes, which is the
 *     path a browser zoom and a column change both take;
 *   - the card is still exactly as tall as the tiles beside it — the fitting must not have bought
 *     legibility by making the row jump.
 *
 *   node verification/home/archive-fit.mjs
 */
import { spawn } from 'node:child_process'
import { writeFile, mkdir } from 'node:fs/promises'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9347
const BASE = process.env.BASE_URL || 'http://localhost:3000'
const OUT = 'verification/home/archive-fit'
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
  if (r?.result?.exceptionDetails) return { error: String(r.result.exceptionDetails.text) }
  return r?.result?.result?.value
}

await send('Page.enable')
await send('Runtime.enable')

let pass = 0, fail = 0
const check = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ok   ${n}`) }
  else { fail++; console.log(`  FAIL ${n}${d ? ` — ${d}` : ''}`) }
}

/** The card, its measuring box, the fitted span, and how full the box is. */
const PROBE = `(() => {
  const heading = [...document.querySelectorAll('h3')]
    .find(h => /from the archive|on this day/i.test(h.textContent || ''))
  if (!heading) return { error: 'card heading not found' }
  const card = heading.closest('section')
  const box = card.querySelector('[data-fit-box]')
  if (!box) return { error: 'no fit box in the card' }
  const span = box.firstElementChild
  const cs = getComputedStyle(span)
  return {
    text: (span.textContent || '').trim(),
    fontSize: parseFloat(cs.fontSize),
    boxH: box.clientHeight,
    boxW: box.clientWidth,
    textH: span.scrollHeight,
    textW: span.scrollWidth,
    overflowY: getComputedStyle(box).overflowY,
    cardH: +card.getBoundingClientRect().height.toFixed(2),
    siblingH: (() => {
      const sibs = [...(card.parentElement?.children || [])].filter(el => el !== card)
      return sibs.length ? +sibs[0].getBoundingClientRect().height.toFixed(2) : null
    })(),
  }
})()`

/** Replace the text, then force a re-fit through the observer by nudging the box's width. */
const RETEXT = (text) => `(() => {
  const heading = [...document.querySelectorAll('h3')]
    .find(h => /from the archive|on this day/i.test(h.textContent || ''))
  const box = heading.closest('section').querySelector('[data-fit-box]')
  const span = box.firstElementChild
  const target = span.querySelector('a') || span
  target.textContent = ${JSON.stringify(text)}
  return true
})()`

async function refit() {
  /*
   * A width change the observer cannot miss, then back to where we started.
   *
   * This began as a 1px nudge and then a 1280-to-1000 swing, and neither worked: the statistics row
   * keeps the card the same width across desktop widths, so the box never resized, the observer never
   * fired, and the probe measured the PREVIOUS size — a failure that was the test's fault rather than
   * the component's. Only crossing to the mobile layout actually changes the box.
   */
  await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 1, mobile: true })
  await sleep(350)
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(400)
}

try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: BASE })
  await sleep(3500)

  console.log('\nThe real entry, as shipped')
  const real = await evaluate(PROBE)
  if (!real || real.error) throw new Error(real?.error || 'probe returned nothing')
  const fill = real.textH / real.boxH
  console.log(`  "${real.text.slice(0, 70)}${real.text.length > 70 ? '…' : ''}"`)
  console.log(`  ${real.fontSize}px  text ${real.textH}px in a ${real.boxH}px box  (${Math.round(fill * 100)}% full)`)

  check('the text fills most of the box', fill >= 0.6, `${Math.round(fill * 100)}%`)
  check('...and does not overflow it vertically', real.textH <= real.boxH + 1, `${real.textH} > ${real.boxH}`)
  check('...or horizontally', real.textW <= real.boxW + 1, `${real.textW} > ${real.boxW}`)
  check('it is larger than the 12px it used to be', real.fontSize > 12, `${real.fontSize}px`)
  check('...and no larger than the cap', real.fontSize <= 22, `${real.fontSize}px`)
  check('the card still matches the tiles beside it',
    real.siblingH === null || Math.abs(real.cardH - real.siblingH) <= 1,
    `card ${real.cardH} vs sibling ${real.siblingH}`)

  await send('Page.captureScreenshot', {}).then(async (r) => {
    if (r?.result?.data) await writeFile(`${OUT}/card-real.png`, Buffer.from(r.result.data, 'base64'))
  })

  console.log('\nA very short line is capped, not blown up')
  await evaluate(RETEXT('In 2005, X won.'))
  await refit()
  const short = await evaluate(PROBE)
  console.log(`  ${short.fontSize}px`)
  check('a short line stops at the cap', short.fontSize <= 22, `${short.fontSize}px`)
  check('...and is at least as large as the real one', short.fontSize >= real.fontSize,
    `${short.fontSize} vs ${real.fontSize}`)
  check('...still inside the box', short.textH <= short.boxH + 1, `${short.textH} > ${short.boxH}`)

  console.log('\nA longer entry shrinks to fit')
  const LONG = 'In 2011, a hard-fought final went the full distance with several lead changes and a '
    + 'safety battle in the deciding rack, finishing 9-8.'
  await evaluate(RETEXT(LONG))
  await refit()
  const long = await evaluate(PROBE)
  console.log(`  ${long.fontSize}px  text ${long.textH}px in a ${long.boxH}px box`)
  check('a longer entry is smaller than a short one', long.fontSize < short.fontSize,
    `${long.fontSize} vs ${short.fontSize}`)
  check('...still fits vertically', long.textH <= long.boxH + 1, `${long.textH} > ${long.boxH}`)
  check('...still fits horizontally', long.textW <= long.boxW + 1, `${long.textW} > ${long.boxW}`)
  check('...and did not shrink below the floor', long.fontSize >= 12, `${long.fontSize}px`)
  check('the card STILL matches the tiles beside it',
    long.siblingH === null || Math.abs(long.cardH - long.siblingH) <= 1,
    `card ${long.cardH} vs sibling ${long.siblingH}`)

  /*
   * Past the floor, clipping is the DESIGNED behaviour.
   *
   * Text that cannot fit at 12px is not made to fit — shrinking further would trade legibility for a
   * fit nobody can read. What must hold is that the floor is respected and the overflow stays inside
   * the box, so the card's height is unaffected and the row beside it cannot be pushed about.
   */
  console.log('\nPast the floor it clips, and the card holds its shape')
  const HUGE = 'In 2011, ' + 'an extraordinarily long-winded account of a final that nobody could '
    + 'reasonably fit into a small card, '.repeat(6) + 'ending 9-8.'
  await evaluate(RETEXT(HUGE))
  await refit()
  const huge = await evaluate(PROBE)
  console.log(`  ${huge.fontSize}px  text ${huge.textH}px in a ${huge.boxH}px box (clipped)`)
  check('it sits exactly at the floor', huge.fontSize === 12, `${huge.fontSize}px`)
  check('...the overflow is hidden, not spilled', huge.overflowY === 'hidden', huge.overflowY)
  check('...and the card is still the height of the tiles',
    huge.siblingH === null || Math.abs(huge.cardH - huge.siblingH) <= 1,
    `card ${huge.cardH} vs sibling ${huge.siblingH}`)

  await send('Page.captureScreenshot', {}).then(async (r) => {
    if (r?.result?.data) await writeFile(`${OUT}/card-long.png`, Buffer.from(r.result.data, 'base64'))
  })

  console.log('\nNarrow viewport: the fit follows the box')
  await evaluate(RETEXT(real.text))
  await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 1, mobile: true })
  await sleep(600)
  const narrow = await evaluate(PROBE)
  console.log(`  ${narrow.fontSize}px  text ${narrow.textH}px in a ${narrow.boxH}px box (${narrow.boxW}px wide)`)
  check('no overflow at 420px', narrow.textH <= narrow.boxH + 1 && narrow.textW <= narrow.boxW + 1,
    `${narrow.textH}/${narrow.boxH}, ${narrow.textW}/${narrow.boxW}`)
  check('...and it still uses the space', narrow.textH / narrow.boxH >= 0.5,
    `${Math.round((narrow.textH / narrow.boxH) * 100)}%`)

  await send('Page.captureScreenshot', {}).then(async (r) => {
    if (r?.result?.data) await writeFile(`${OUT}/card-narrow.png`, Buffer.from(r.result.data, 'base64'))
  })
} catch (e) {
  fail++
  console.log('\nFATAL ' + (e instanceof Error ? e.message : String(e)))
} finally {
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  console.log(`Screenshots in ${OUT}`)
  try { ws.close() } catch { /* already gone */ }
  proc.kill()
  process.exit(fail === 0 ? 0 : 1)
}
