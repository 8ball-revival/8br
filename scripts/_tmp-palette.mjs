import { launch, sleep } from './browser/driver.mjs'

/*
  Does a palette override actually reach the whole site?

  Writes a token straight into the Display Lab storage key, reloads, and reads the COMPUTED colour of
  real elements on real pages. Storage rather than clicking, because the question here is whether the
  cascade reaches those elements, not whether a button works — the panel gets exercised separately.
*/
const b = await launch()
const KEY = '8br-display-v1'

const setTokens = (tokens) => `(function () {
  var raw = {};
  try { raw = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}) || '{}') } catch (e) {}
  raw.tokens = ${JSON.stringify(tokens)};
  raw.preset = 'custom';
  localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify(raw));
  return true;
})()`

const READ = `(function () {
  var cs = getComputedStyle(document.documentElement);
  var read = function (n) { return cs.getPropertyValue(n).trim() };
  // The canvas is painted on <html>; <body> is deliberately transparent over it.
  var bodyBg = getComputedStyle(document.documentElement).backgroundColor;
  var el = function (sel) {
    var e = document.querySelector(sel);
    if (!e) return null;
    var s = getComputedStyle(e);
    return { bg: s.backgroundColor, color: s.color };
  };
  return {
    vars: {
      void: read('--void'), graphite: read('--graphite'), cleanWhite: read('--clean-white'),
      signal: read('--hot-red'), navBg: read('--nav-bg'), footerBg: read('--footer-bg'),
      scrimTint: read('--scrim-tint'), plaque: read('--surface-plaque'),
    },
    body: bodyBg,
    header: el('header[data-site-header]'),
    footer: el('footer'),
    hero: el('[data-sb-module-type="home.championHero"]'),
    plaques: el('[data-sb-module-type="rankings.achievementPlaques"] li'),
    statsBar: el('[data-sb-module-type="rankings.statsBar"] section'),
    rail: el('[data-sb-module-type="rankings.rail"] section'),
    unresolved: (function () {
      // A variable that resolves to nothing is how text becomes the colour of its background.
      var bad = [];
      ['--void','--graphite','--clean-white','--hot-red','--nav-bg','--footer-bg','--scrim-tint',
       '--surface-plaque','--steel','--signal-fill','--signal-ink','--gold'].forEach(function (n) {
        if (!read(n)) bad.push(n);
      });
      return bad;
    })()
  };
})()`

let pass = 0, fail = 0
const check = (ok, label, detail) => {
  if (ok) { pass++; console.log('  ok   ' + label) }
  else { fail++; console.log('  FAIL ' + label + (detail ? ' -- ' + detail : '')) }
}

try {
  await b.viewport(1440, 1000, false)

  // ── Baseline: nothing overridden ──────────────────────────────────────────────────────────────
  await b.goto('/', 12000)
  await b.eval(setTokens({}))
  await b.goto('/', 12000); await sleep(1500)
  const base = await b.eval(READ)
  console.log('\n── Built-in values')
  check(base.unresolved.length === 0, 'every governed variable resolves', JSON.stringify(base.unresolved))
  check(base.vars.void === '#050607', 'page canvas is the approved near-black', base.vars.void)
  check(base.vars.signal === '#ff2a2a', 'the accent is signal red', base.vars.signal)

  // ── A palette that moves the primitives ───────────────────────────────────────────────────────
  const OVERRIDE = {
    void: '#101014',
    graphite: '#1a1a20',
    cleanWhite: '#fff8e7',
    signal: '#22c55e',
    plaque: '#242430',
    footerBg: '#1a1a20',
    scrim: '#101014',
  }
  await b.eval(setTokens(OVERRIDE))
  await b.goto('/', 12000); await sleep(1800)
  const after = await b.eval(READ)

  console.log('\n── With a palette applied')
  check(after.vars.void === '#101014', 'the page canvas token took the override', after.vars.void)
  check(after.vars.cleanWhite === '#fff8e7', 'the primary text token took it', after.vars.cleanWhite)
  check(after.vars.signal === '#22c55e', 'the accent token took it', after.vars.signal)

  const rgb = (hex) => {
    const n = parseInt(hex.slice(1), 16)
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
  }

  check(after.body === rgb('#101014'), 'the page ground followed', `${after.body} vs ${rgb('#101014')}`)
  check(after.header && after.header.bg === rgb('#101014'), 'the header followed', JSON.stringify(after.header))
  check(after.footer && after.footer.bg === rgb('#1a1a20'), 'the footer followed', JSON.stringify(after.footer))
  check(after.plaques && after.plaques.bg === rgb('#242430'), 'achievement plaques followed', JSON.stringify(after.plaques))
  check(after.header && after.header.color === rgb('#fff8e7'), 'header text followed the text token', JSON.stringify(after.header))
  check(after.unresolved.length === 0, 'nothing became unresolved', JSON.stringify(after.unresolved))

  // ── The cascade reaches other pages, not just the homepage ────────────────────────────────────
  for (const route of ['/rankings', '/yahoo', '/seasons', '/the-break', '/achievements']) {
    await b.goto(route, 12000); await sleep(1200)
    const r = await b.eval(READ)
    check(r.body === rgb('#101014'), `${route}: the page ground followed`, r.body)
    check(r.unresolved.length === 0, `${route}: every governed variable resolves`, JSON.stringify(r.unresolved))
  }

  // ── And a reset really resets ─────────────────────────────────────────────────────────────────
  await b.eval(setTokens({}))
  await b.goto('/', 12000); await sleep(1500)
  const reset = await b.eval(READ)
  check(reset.vars.void === '#050607', 'reset returns the page canvas to the built-in', reset.vars.void)
  check(reset.body === 'rgb(5, 6, 7)', 'and the page with it', reset.body)

  const errors = typeof b.consoleErrors === 'function' ? b.consoleErrors() : []
  check(errors.length === 0, 'no console errors', JSON.stringify(errors).slice(0, 300))
} finally { await b.close() }

console.log(`\n${pass}/${pass + fail} checks pass${fail ? ` -- ${fail} FAILED` : ''}`)
process.exit(fail ? 1 : 0)
