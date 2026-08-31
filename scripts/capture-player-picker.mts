/**
 * Screenshots of the player field: linked, searching, and the id disclosure.
 *
 * Read-only against the document — it opens the search and types, but never chooses, so nothing is
 * saved and the module is left exactly as it was.
 *
 * Run: npx tsx --tsconfig tsconfig.scripts.json scripts/capture-player-picker.mts
 */

import { readFileSync } from 'node:fs'
import { launch, sleep } from './browser/driver.mjs'

const env: Record<string, string> = {}
for (const raw of readFileSync('.env.replica', 'utf8').split(String.fromCharCode(10))) {
  const line = raw.trim(); const eq = line.indexOf('=')
  if (eq < 1 || line.startsWith('#')) continue
  let v = line.slice(eq + 1).trim()
  if (v.length > 1 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0]) v = v.slice(1, -1)
  env[line.slice(0, eq).trim()] = v
}
process.env.DATABASE_URL ||= env.DATABASE_URL ?? ''
process.env.DIRECT_URL ||= env.DIRECT_URL ?? process.env.DATABASE_URL ?? ''
process.env.SITE_BUILDER_E2E_SECRET ||= env.SITE_BUILDER_E2E_SECRET ?? ''

const OUT = process.env.SHOT_DIR
  ?? 'C:/Users/Cerebro/AppData/Local/Temp/claude/C--Users-Cerebro/952b661e-7486-446a-90b1-a109d310f71e/scratchpad'

const ASIDE = `[].slice.call(document.querySelectorAll('aside')).filter(function (a) {
  return /Settings/i.test(a.getAttribute('aria-label') || '');
})[0]`

const b = await launch()
try {
  await b.viewport(1500, 1100, false)
  await b.signInAsOwner()
  await b.goto('/?edit=1', 16000)

  await b.eval(`(function () {
    var el = document.querySelector('[data-sb-module-type="competitions.recordFeature"]');
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    var r = el.getBoundingClientRect();
    var want = { top: Math.round(r.top + window.scrollY), left: Math.round(r.left + window.scrollX) };
    var overlay = document.querySelector('.sb-overlay');
    /*
      All four measurements, not two.

      The overlay boxes are absolutely positioned and many of them share a left edge, so matching on
      position alone selects whichever wrapper happens to start at the same point — which is how
      this ended up screenshotting a Columns module's inspector.
    */
    var box = [].slice.call(overlay.querySelectorAll('div[style]')).filter(function (d) {
      return Math.abs(parseFloat(d.style.top) - want.top) < 2
          && Math.abs(parseFloat(d.style.left) - want.left) < 2
          && Math.abs(parseFloat(d.style.width) - r.width) < 2
          && Math.abs(parseFloat(d.style.height) - r.height) < 2;
    })[0];
    if (box) box.click();
    return !!box;
  })()`)
  await sleep(2500)

  /*
    Crop around the CONTROL, not around the panel.

    The inspector is its own scroll container, so `captureBeyondViewport` over the whole aside
    photographs whatever happens to be scrolled to the top -- which is a picture of some other
    field. Measuring the picker and taking the region around it is what puts the control in frame.
  */
  const shot = async (name: string) => {
    // Scroll the control into view inside the inspector's own scroller, then photograph the
    // viewport. A computed clip kept missing, because the rect was measured before the scroll
    // settled and the panel scrolls independently of the page.
    await b.eval(`(function () {
      var a = ${ASIDE};
      if (!a) return false;
      var el = a.querySelector('button[aria-haspopup="listbox"]') || a.querySelector('input[role="combobox"]');
      if (el) el.scrollIntoView({ block: 'center' });
      return !!el;
    })()`)
    await sleep(700)
    const file = `${OUT}/picker-${name}.png`
    await b.screenshot(file)
    return file
  }

  // Scroll the inspector to the holder group so the crop contains it.
  await b.eval(`(function () {
    var a = ${ASIDE};
    var btn = a && a.querySelector('button[aria-haspopup="listbox"]');
    if (btn) btn.scrollIntoView({ block: 'center' });
    return !!btn;
  })()`)
  await sleep(500)
  console.log('linked   ->', await shot('1-linked'))

  await b.eval(`(function () {
    var a = ${ASIDE};
    var btn = a.querySelector('button[aria-haspopup="listbox"]');
    if (btn) btn.click();
    return !!btn;
  })()`)
  await sleep(500)
  await b.eval(`(function () {
    var a = ${ASIDE};
    var input = a.querySelector('input[role="combobox"]');
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'po0lin');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
  await sleep(2200)
  console.log('search   ->', await shot('2-searching-an-old-handle'))

  // Leave without choosing, then show the disclosure.
  await b.eval(`(function () {
    var a = ${ASIDE};
    var x = a.querySelector('button[aria-label="Stop searching"]');
    if (x) x.click();
    return !!x;
  })()`)
  await sleep(600)
  await b.eval(`(function () {
    var a = ${ASIDE};
    var el = [].slice.call(a.querySelectorAll('button')).filter(function (x) {
      return (x.textContent || '').trim().indexOf('Show stored id') === 0;
    })[0];
    if (el) el.click();
    return !!el;
  })()`)
  await sleep(600)
  console.log('debug    ->', await shot('3-stored-id-revealed'))
} finally {
  await b.close()
}
await new Promise((r) => { setTimeout(r, 250) })
process.exit(0)
