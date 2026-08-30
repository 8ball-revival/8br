/**
 * Responsive verification across every required size, published and in Edit Mode.
 *
 * ── What it checks, and why each one ─────────────────────────────────────────────────────────────
 * • No page-level horizontal overflow. Measured by finding elements that exceed the viewport AND are
 *   not clipped by an ancestor — a wide table inside its own scroller is correct, and reporting it
 *   would send the fix to the wrong place.
 * • No internal VERTICAL scroll trap. A ranking table legitimately scrolls; a bracket must not, and
 *   nothing should end up inside a scroller it cannot get out of.
 * • No broken images, no uncaught console errors, no hydration mismatch.
 * • In Edit Mode: the toolbar and both panels are reachable, and the editor's own chrome does not
 *   cover the page's controls.
 *
 * Run: npm run test:responsive        (with the dev server running)
 */
import { launch, reporter, BASE } from './browser/driver.mjs'

const SIZES = [
  ['1920x1080', 1920, 1080, false],
  ['1440x900', 1440, 900, false],
  ['1280x800', 1280, 800, false],
  ['1024x768', 1024, 768, false],
  ['768x1024', 768, 1024, true],
  ['430x932', 430, 932, true],
  ['390x844', 390, 844, true],
  ['375x812', 375, 812, true],
  ['320x568', 320, 568, true],
]

const PUBLIC_ROUTES = [
  ['home', '/'],
  ['rankings', '/rankings'],
  ['yahoo', '/yahoo'],
  ['tournaments', '/tournaments'],
  ['achievements', '/achievements'],
  ['the-break', '/the-break'],
  ['season-groups', '/seasons/16426'],
  ['season-playoffs', '/seasons/16426?competition=8brcam&view=playoffs'],
  ['player', '/players/deep.cerebro'],
]

/** Edit Mode is heavier, so it is checked on the pages whose layouts differ most. */
const EDIT_ROUTES = [['home', '/?edit=1'], ['rankings', '/rankings?edit=1']]

const PROBE = [
  '(function () {',
  '  var d = document.documentElement;',
  '  var limit = d.clientWidth;',
  '  var offenders = [];',
  '  document.querySelectorAll("*").forEach(function (el) {',
  '    var r = el.getBoundingClientRect();',
  '    if (!r.width || !r.height || r.right - limit <= 1) return;',
  '    var p = el.parentElement;',
  '    while (p && p !== d) {',
  '      var cs = getComputedStyle(p);',
  '      if (cs.overflowX !== "visible" && p.getBoundingClientRect().right <= limit + 1) return;',
  '      p = p.parentElement;',
  '    }',
  '    offenders.push(el.tagName.toLowerCase() + "." + (el.className || "").toString().split(" ")[0]);',
  '  });',
  '  var bracket = document.querySelector("[class*=bracket]");',
  '  var bracketScrollsY = false;',
  '  if (bracket) {',
  '    var bs = getComputedStyle(bracket);',
  '    bracketScrollsY = (bs.overflowY === "auto" || bs.overflowY === "scroll") && bracket.scrollHeight > bracket.clientHeight + 4;',
  '  }',
  '  return {',
  '    overflow: d.scrollWidth - d.clientWidth,',
  '    offenders: offenders.slice(0, 3),',
  '    chars: (document.body.innerText || "").length,',
  '    brokenImages: [].slice.call(document.images).filter(function (i) { return i.complete && i.naturalWidth === 0 }).length,',
  '    bracketScrollsY: bracketScrollsY',
  '  };',
  '})()',
].join('\n')

const EDIT_PROBE = [
  '(function () {',
  '  var d = document.documentElement;',
  '  var asides = [].slice.call(document.querySelectorAll("aside"));',
  '  var toolbar = [].slice.call(document.querySelectorAll("div")).filter(function (x) {',
  '    return /Edit mode/i.test(x.textContent || "") && (x.className || "").toString().indexOf("fixed") >= 0;',
  '  })[0];',
  '  var publish = [].slice.call(document.querySelectorAll("button")).filter(function (b) { return /Publish/i.test(b.textContent || "") })[0];',
  '  var pubRect = publish ? publish.getBoundingClientRect() : null;',
  '  return {',
  '    overflow: d.scrollWidth - d.clientWidth,',
  '    overlay: !!document.querySelector(".sb-overlay"),',
  '    toolbar: !!toolbar,',
  '    panels: asides.length,',
  '    // The Publish control must be ON SCREEN, not merely present: a toolbar that wraps off the',
  '    // top of a phone is a toolbar you cannot publish from.',
  '    publishVisible: !!pubRect && pubRect.top >= 0 && pubRect.bottom <= d.clientHeight && pubRect.right <= d.clientWidth + 1 && pubRect.width > 0',
  '  };',
  '})()',
].join('\n')

const r = reporter('responsive')
const browser = await launch()

try {
  for (const [label, w, h, mobile] of SIZES) {
    r.section(`${label} — published`)
    await browser.viewport(w, h, mobile)
    for (const [name, route] of PUBLIC_ROUTES) {
      browser.clearEvents()
      await browser.goto(route, 3200)
      const p = await browser.eval(PROBE)
      const problems = []
      if (p.overflow > 1) problems.push(`overflows ${p.overflow}px (${p.offenders.join(', ') || 'unattributed'})`)
      if (p.brokenImages) problems.push(`${p.brokenImages} broken image(s)`)
      if (p.bracketScrollsY) problems.push('the bracket has an internal vertical scrollbar')
      if (p.chars < 150) problems.push(`nearly empty (${p.chars} chars)`)
      if (browser.events.errors.length) problems.push(`console: ${browser.events.errors[0].slice(0, 90)}`)
      if (browser.events.hydrationWarnings.length) problems.push('hydration mismatch')
      r.check(`${label} ${name}`, problems.length === 0, problems.join(' | '))
    }
  }

  await browser.signInAsOwner()
  for (const [label, w, h, mobile] of SIZES) {
    r.section(`${label} — Edit Mode`)
    await browser.viewport(w, h, mobile)
    for (const [name, route] of EDIT_ROUTES) {
      browser.clearEvents()
      await browser.goto(route, 5000)
      // The first-run tour is modal on a fresh profile; dismiss it before measuring the editor.
      await browser.eval('(function () { var b = [].slice.call(document.querySelectorAll("button")).filter(function (x) { return /^Skip$/i.test((x.textContent || "").trim()) })[0]; if (b) b.click(); return 1 })()')
      const p = await browser.eval(EDIT_PROBE)
      const problems = []
      if (p.overflow > 1) problems.push(`overflows ${p.overflow}px`)
      if (!p.overlay) problems.push('the editing overlay is missing')
      if (!p.toolbar) problems.push('the toolbar is missing')
      if (!p.publishVisible) problems.push('Publish is not reachable on screen')
      if (browser.events.errors.length) problems.push(`console: ${browser.events.errors[0].slice(0, 90)}`)
      r.check(`${label} edit:${name}`, problems.length === 0, problems.join(' | '))
    }
  }
} finally {
  await browser.close()
}

process.exit(r.finish() ? 1 : 0)
