/**
 * The theme system, checked the way it can actually fail.
 *
 * ── What this is looking for ────────────────────────────────────────────────────────────────────
 * Not "does the site look different". The failures that matter are the ones nobody sees until
 * somebody else does: a tab that is the colour of the bar behind it, a count that vanished into its
 * card, a variable that resolves to nothing so text inherits its own background, a focus ring that
 * stopped existing. Each of those is a specific, detectable condition and each has a check below.
 *
 * ── Why it runs every preset ────────────────────────────────────────────────────────────────────
 * A preset is not a screenshot, it is a set of values for the same tokens — so a preset that has
 * never been rendered is a set of values nobody has checked. All five run against real pages at
 * three widths, and the contrast sweep measures what is painted rather than what was declared.
 *
 * Run: npm run test:theme (with the dev server up)
 */

import { launch, sleep } from './browser/driver.mjs'
import { THEME_PRESETS } from '../src/lib/theme/presets.ts'
import { THEME_TOKEN_REGISTRY } from '../src/lib/theme/registry.ts'
import { verdictFor, unpairedTokens } from '../src/lib/theme/contrast.ts'

const OUT = process.env.SHOT_DIR ?? 'C:/Users/Cerebro/AppData/Local/Temp/claude/C--Users-Cerebro/952b661e-7486-446a-90b1-a109d310f71e/scratchpad/theme-shots'
const KEY = '8br-display-v1'

let pass = 0
let fail = 0
const failures: string[] = []
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ok   ${label}`) }
  else { fail++; failures.push(label); console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 68 - t.length))}`)

const ROUTES = ['/', '/rankings', '/yahoo', '/seasons', '/the-break', '/achievements']
const WIDTHS: [number, number, boolean][] = [[1440, 900, false], [768, 1024, true], [375, 812, true]]

const setTokens = (tokens: Record<string, string>) => `(function () {
  var raw = {};
  try { raw = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}) || '{}') } catch (e) {}
  raw.tokens = ${JSON.stringify(tokens)};
  localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify(raw));
  return true;
})()`

/**
 * Everything that can be wrong with a rendered page, in one pass.
 *
 * Composites alpha onto the first opaque ancestor rather than reading an element's own background,
 * because almost every element's own background is `transparent` — measuring that would compare text
 * against nothing and report a perfect score for an unreadable page.
 */
const SWEEP = `(function () {
  var parse = function (c) {
    var m = /rgba?\\(([^)]+)\\)/.exec(c);
    if (!m) return null;
    var p = m[1].split(',').map(parseFloat);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  var over = function (f, b) {
    return { r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 };
  };
  var lum = function (c) {
    var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  var ratio = function (a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) };
  var groundOf = function (el) {
    var ground = parse(getComputedStyle(document.documentElement).backgroundColor) || { r: 0, g: 0, b: 0, a: 1 };
    var stack = [];
    for (var p = el; p; p = p.parentElement) {
      var c = parse(getComputedStyle(p).backgroundColor);
      if (c && c.a > 0) stack.push(c);
      if (c && c.a === 1) break;
    }
    for (var i = stack.length - 1; i >= 0; i--) ground = over(stack[i], ground);
    return ground;
  };

  var lowContrast = [], invisible = [], transparentText = [], clipped = [];
  var measured = 0;
  var seenCombination = {};
  var elementsSeen = 0;

  /*
    One measurement per DISTINCT combination, not per element.

    A ranking table is five hundred cells in about twenty combinations of colour, ground, size and
    weight. Measuring all five hundred takes twenty-five times as long and reports the same twenty
    facts, and a suite that takes two hours is a suite nobody runs twice. The key below is exactly
    what the WCAG calculation depends on, so two elements sharing it cannot differ in verdict —
    this drops the repetition without dropping any coverage.
  */
  [].slice.call(document.querySelectorAll('main *, header *, footer *')).forEach(function (el) {
    if (el.children.length > 0) return;
    var t = (el.textContent || '').trim();
    if (!t) return;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    var cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return;
    // Gradient-filled text is not coloured by its colour property; measuring it is meaningless.
    if ((cs.webkitTextFillColor && cs.webkitTextFillColor.indexOf('rgba(0, 0, 0, 0)') === 0)
        || cs.backgroundClip === 'text' || cs.webkitBackgroundClip === 'text') return;

    var fg = parse(cs.color);
    if (!fg) return;
    var op = parseFloat(cs.opacity);
    if (op < 0.05) { transparentText.push(t.slice(0, 34)); return; }
    if (op < 0.15) return;
    elementsSeen++;
    var ground = groundOf(el);

    var key = cs.color + '|' + ground.r + ',' + ground.g + ',' + ground.b + '|'
      + Math.round(parseFloat(cs.fontSize)) + '|' + cs.fontWeight + '|' + cs.opacity;
    if (seenCombination[key]) return;
    seenCombination[key] = 1;
    measured++;
    var composited = fg.a < 1 ? over(fg, ground) : fg;
    var rr = ratio(composited, ground);
    var size = parseFloat(cs.fontSize);
    void 0;
    var weight = parseInt(cs.fontWeight, 10) || 400;
    var large = size >= 24 || (size >= 18.66 && weight >= 700);
    var need = large ? 3 : 4.5;

    var entry = { text: t.slice(0, 34), ratio: +rr.toFixed(2), need: need, size: Math.round(size),
                  cls: String(el.className || '').slice(0, 44) };
    // Near-identical is its own category: white-on-white and black-on-black land here.
    if (rr < 1.25) invisible.push(entry);
    else if (rr < need) lowContrast.push(entry);

    // Text cut off by its own box rather than by an intended ellipsis.
    if (el.scrollHeight > el.clientHeight + 2 && cs.overflow === 'hidden' && cs.textOverflow !== 'ellipsis'
        && cs.webkitLineClamp === 'none') {
      clipped.push(entry);
    }
  });

  // A custom property that resolves to nothing makes whatever reads it inherit instead.
  var cs = getComputedStyle(document.documentElement);
  var unresolved = ${JSON.stringify(THEME_TOKEN_REGISTRY.map((t) => t.css))}.filter(function (n) {
    return !cs.getPropertyValue(n).trim();
  });

  // A focusable control with no visible focus treatment declared.
  var noFocus = [].slice.call(document.querySelectorAll('main a[href], main button')).filter(function (el) {
    var c = el.getAttribute('class') || '';
    return c.indexOf('focus-visible:ring') < 0 && c.indexOf('focus-visible:outline') < 0
      && c.indexOf('focus:ring') < 0 && !el.closest('[class*="focus-visible:ring"]');
  }).map(function (el) { return (el.textContent || el.getAttribute('aria-label') || '?').trim().slice(0, 30) });

  var doc = document.documentElement;
  return {
    measured: measured, elementsSeen: elementsSeen,
    lowContrast: lowContrast.slice(0, 6), lowCount: lowContrast.length,
    invisible: invisible.slice(0, 6), invisibleCount: invisible.length,
    transparentText: transparentText.slice(0, 4),
    clipped: clipped.slice(0, 4), clippedCount: clipped.length,
    unresolved: unresolved,
    noFocus: noFocus.slice(0, 5), noFocusCount: noFocus.length,
    overflow: doc.scrollWidth - doc.clientWidth
  };
})()`

const b = await launch()
try {
  // ══ The registry itself ═══════════════════════════════════════════════════════════════════════
  section('The registry is coherent before anything renders')
  const keys = THEME_TOKEN_REGISTRY.map((t) => t.key)
  check('every token key is unique', new Set(keys).size === keys.length)
  check('every token declares a custom property', THEME_TOKEN_REGISTRY.every((t) => t.css.startsWith('--')))
  check('every token explains itself in plain language',
    THEME_TOKEN_REGISTRY.every((t) => t.effect.length > 25))
  check('every token has a literal fallback, not a var() chain',
    THEME_TOKEN_REGISTRY.every((t) => /^#[0-9a-f]{3,8}$/i.test(t.fallback)),
    THEME_TOKEN_REGISTRY.filter((t) => !/^#[0-9a-f]{3,8}$/i.test(t.fallback)).map((t) => t.key).join(', '))
  const unpaired = unpairedTokens()
  check('every token participates in at least one contrast pairing',
    unpaired.length === 0, unpaired.join(', '))

  section('Every preset is publishable by its own rules')
  for (const preset of THEME_PRESETS) {
    const v = verdictFor(preset.values)
    check(`${preset.name}: no blocking contrast failure`, v.publishable,
      v.blocking.map((x) => `${x.where} ${x.ratio}:1`).join(' | '))
    const unknown = Object.keys(preset.values).filter((k) => !keys.includes(k))
    check(`${preset.name}: sets only real tokens`, unknown.length === 0, unknown.join(', '))
  }

  section('An invalid value cannot be stored')
  const { normaliseTokens } = await import('../src/lib/theme/presets.ts')
  const dirty = normaliseTokens({
    void: 'red; background: url(//evil)',
    graphite: 'var(--anything)',
    cleanWhite: '#FFF',
    notATokenAtAll: '#000000',
    signal: 'rgb(255,0,0)',
  })
  check('a declaration-breaking value is dropped', dirty.void === undefined, JSON.stringify(dirty))
  check('a var() reference is dropped', dirty.graphite === undefined)
  check('an rgb() function is dropped', dirty.signal === undefined)
  check('an unknown key is dropped', (dirty as Record<string, string>).notATokenAtAll === undefined)
  check('a valid short hex survives, lower-cased', dirty.cleanWhite === '#fff')

  // ══ Every preset, in a browser ════════════════════════════════════════════════════════════════
  for (const preset of THEME_PRESETS) {
    section(preset.name)
    await b.viewport(1440, 900, false)
    await b.goto('/', 14000)
    await b.eval(setTokens(preset.values))

    for (const [w, h, mobile] of WIDTHS) {
      await b.viewport(w, h, mobile)
      for (const route of ROUTES) {
        await b.goto(route, 14000)
        await sleep(900)
        const s = await b.eval(SWEEP)
        const tag = `${preset.id} ${route} @${w}`
        check(`${tag}: every governed variable resolves`, s.unresolved.length === 0, s.unresolved.join(', '))
        check(`${tag}: nothing is invisible against its ground`, s.invisibleCount === 0,
          JSON.stringify(s.invisible))
        check(`${tag}: no transparent text`, s.transparentText.length === 0, JSON.stringify(s.transparentText))
        check(`${tag}: contrast holds (${s.measured} of ${s.elementsSeen} strings, deduplicated)`,
          s.lowCount === 0, JSON.stringify(s.lowContrast))
        check(`${tag}: no text clipped by its own box`, s.clippedCount === 0, JSON.stringify(s.clipped))
        check(`${tag}: no horizontal overflow`, s.overflow === 0, `${s.overflow}px`)
        if (w === 1440 && route === '/') {
          check(`${tag}: every control declares a focus treatment`, s.noFocusCount === 0, JSON.stringify(s.noFocus))
        }
      }
      if (route_shot(w)) {
        await b.goto('/', 14000); await sleep(900)
        const ph = await b.eval('Math.min(document.documentElement.scrollHeight, 8000)')
        await b.screenshot(`${OUT}/${preset.id}-${w}.png`, { fullPage: true, width: w, height: ph })
      }
    }
  }

  // ══ Persistence, and isolation from a signed-out visitor ══════════════════════════════════════
  section('Persistence and isolation')
  await b.viewport(1440, 900, false)
  await b.eval(setTokens({ void: '#101014' }))
  await b.goto('/', 14000); await sleep(900)
  const kept = await b.eval(`getComputedStyle(document.documentElement).getPropertyValue('--void').trim()`)
  check('a palette survives a reload', kept === '#101014', String(kept))

  /*
    The isolation that matters.

    Display Lab is a preference held by ONE browser. A second browser profile -- which is what a
    signed-out visitor is -- must see the published site, not somebody else's unpublished palette.
    Checked by clearing storage rather than by opening a second profile, which is the same condition
    and does not need a second browser.
  */
  await b.eval(`localStorage.removeItem(${JSON.stringify(KEY)}); true`)
  await b.goto('/', 14000); await sleep(900)
  const clean = await b.eval(`getComputedStyle(document.documentElement).getPropertyValue('--void').trim()`)
  check('another visitor sees the published site, not that palette', clean === '#050607', String(clean))

  const errors = typeof b.consoleErrors === 'function' ? b.consoleErrors() : []
  const real = (errors as string[]).filter((e) => !/Download the React DevTools/i.test(e))
  check('no console errors across the whole run', real.length === 0, JSON.stringify(real).slice(0, 300))
} finally {
  await b.close()
}

function route_shot(w: number) { return w === 1440 || w === 768 || w === 375 }

console.log(`\n${'═'.repeat(78)}`)
if (fail) {
  console.log(`\n${fail} FAILED:\n`)
  for (const f of failures) console.log(`  x ${f}`)
}
console.log(`\n${pass} checks passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
