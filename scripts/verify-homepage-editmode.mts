/**
 * Edit Mode, exercised against the graphite homepage.
 *
 * ── What this is for ────────────────────────────────────────────────────────────────────────────
 * The homepage was rebuilt out of five new modules. Each of them declares fields, and a field that
 * an Owner cannot actually reach — because the module is nested two containers deep, because the
 * inspector cannot group it, because the value does not survive a save — is a field that does not
 * exist. Nothing about that is visible from the published page, which is why it is checked by
 * driving the editor rather than by reading the layout.
 *
 * ── It leaves nothing behind ────────────────────────────────────────────────────────────────────
 * Every change made here is undone, and the draft is discarded at the end, so a run does not turn
 * into an edit somebody has to notice and revert. The published revision is never touched.
 *
 * Run: npm run test:homepage:edit (with the dev server up)
 */

import { launch, sleep } from './browser/driver.mjs'

let pass = 0
let fail = 0
const failures: string[] = []
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ok   ${label}`) }
  else { fail++; failures.push(label); console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ''}`) }
}
const eq = (label: string, actual: unknown, expected: unknown) =>
  check(label, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
const section = (t: string) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 70 - t.length))}`)

/**
 * Select a module by clicking its OVERLAY box rather than the panel underneath it.
 *
 * Edit Mode covers the canvas with one absolutely-positioned box per module, in document
 * coordinates. They overlap, and the last one painted wins a hit test — so `elementFromPoint` over a
 * panel can hand the click to a neighbour's box. Matching the box by the geometry it was given is
 * the same selection an Owner makes with the mouse, without depending on paint order.
 */
const selectModule = (type: string) => `(function () {
  var el = document.querySelector('[data-sb-module-type="${type}"]');
  if (!el) return { ok: false, why: 'no such module on the page' };
  el.scrollIntoView({ block: 'center' });
  var r = el.getBoundingClientRect();
  var want = { top: Math.round(r.top + window.scrollY), left: Math.round(r.left + window.scrollX) };
  var overlay = document.querySelector('.sb-overlay');
  if (!overlay) return { ok: false, why: 'no overlay' };
  var box = [].slice.call(overlay.querySelectorAll('div[style]')).filter(function (d) {
    return Math.abs(parseFloat(d.style.top) - want.top) < 2
        && Math.abs(parseFloat(d.style.left) - want.left) < 2
        && Math.abs(parseFloat(d.style.width) - r.width) < 2
        && Math.abs(parseFloat(d.style.height) - r.height) < 2;
  })[0];
  if (!box) return { ok: false, why: 'no overlay box matching the module' };
  box.click();
  return { ok: true };
})()`

const inspector = `(function () {
  var aside = [].slice.call(document.querySelectorAll('aside')).filter(function (a) {
    return /Settings/i.test(a.getAttribute('aria-label') || '');
  })[0];
  if (!aside) return null;
  var t = aside.innerText || '';
  return {
    text: t.toLowerCase(),
    fields: [].slice.call(aside.querySelectorAll('input, textarea, select')).length,
    groups: [].slice.call(aside.querySelectorAll('summary, h3, h4')).map(function (h) {
      return (h.textContent || '').trim();
    }).filter(Boolean)
  };
})()`

const setTextField = (currentValue: string, next: string) => `(function () {
  var aside = [].slice.call(document.querySelectorAll('aside')).filter(function (a) {
    return /Settings/i.test(a.getAttribute('aria-label') || '');
  })[0];
  if (!aside) return { ok: false, why: 'no inspector' };
  var input = [].slice.call(aside.querySelectorAll('input, textarea')).filter(function (i) {
    return i.value === ${JSON.stringify(currentValue)};
  })[0];
  if (!input) return { ok: false, why: 'no field holding that value' };
  var proto = input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement;
  var setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
  setter.call(input, ${JSON.stringify(next)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true };
})()`

const b = await launch()
try {
  await b.viewport(1600, 1100, false)
  await b.signInAsOwner()
  await b.goto('/?edit=1', 14000)
  await sleep(2500)

  // The first-run tour is modal on a fresh profile and would block every canvas interaction.
  await b.eval(`(function () {
    var s = [].slice.call(document.querySelectorAll('button')).filter(function (x) {
      return /^Skip$/i.test((x.textContent || '').trim());
    })[0];
    if (s) s.click();
    return !!s;
  })()`)
  await sleep(900)

  section('The editor opens on the rebuilt page')
  const shell = await b.eval(`(function () {
    var named = function (re) {
      return [].slice.call(document.querySelectorAll('aside')).some(function (a) {
        return re.test(a.getAttribute('aria-label') || '');
      });
    };
    return {
      overlay: !!document.querySelector('.sb-overlay'),
      library: named(/Modules/i),
      inspector: named(/Settings/i),
      anchors: {}
    };
  })()`)
  check('the editing overlay renders', shell.overlay === true)
  check('the module library is present', shell.library === true)
  check('the inspector is present', shell.inspector === true)

  section('Every new module is an editable anchor')
  const anchors = await b.eval(`(function () {
    var out = {};
    ['home.championHero', 'rankings.rail', 'competitions.marquee', 'competitions.recordFeature',
     'editorial.breakFeature', 'editorial.newsPlaques', 'rankings.achievementPlaques',
     'rankings.statsBar', 'layout.stack', 'layout.columns'].forEach(function (t) {
      out[t] = document.querySelectorAll('[data-sb-module-type="' + t + '"]').length;
    });
    return out;
  })()`)
  for (const t of ['home.championHero', 'rankings.rail', 'competitions.recordFeature',
    'editorial.breakFeature', 'editorial.newsPlaques', 'rankings.achievementPlaques', 'rankings.statsBar']) {
    check(`${t} is selectable`, anchors[t] === 1, `found ${anchors[t]}`)
  }
  check('and the nested containers are anchored too',
    anchors['layout.stack'] >= 2 && anchors['layout.columns'] >= 1, JSON.stringify(anchors))

  section('The hero offers every field it declares')
  const heroSel = await b.eval(selectModule('home.championHero'))
  check('the hero can be selected on the canvas', heroSel.ok === true, heroSel.why)
  await sleep(1200)
  const heroInspector = await b.eval(inspector)
  check('its settings open', heroInspector != null)
  for (const group of ['the registry', 'headlines', 'the champion', 'the photograph']) {
    check(`grouped under "${group}"`, heroInspector.text.includes(group), heroInspector.groups.join(' | '))
  }
  for (const label of ['heading', 'photograph is of', 'focal point (desktop)', 'darkening']) {
    check(`offers "${label}"`, heroInspector.text.includes(label))
  }
  check('with a control for each', heroInspector.fields >= 12, String(heroInspector.fields))

  section('An edit reaches the canvas, and undo takes it back')
  const edited = await b.eval(setTextField('Competition History', 'Archive Of Record'))
  check('the heading can be typed into', edited.ok === true, edited.why)
  await sleep(3500)
  const onCanvas = await b.eval(`(function () {
    var el = document.querySelector('[data-sb-module-type="home.championHero"]');
    return { has: (el.innerText || '').indexOf('ARCHIVE OF RECORD') >= 0,
             shows: (el.innerText || '').slice(0, 60) };
  })()`)
  check('and the canvas follows', onCanvas.has === true, onCanvas.shows)

  await b.key('z', { ctrl: true })
  await sleep(3500)
  const undone = await b.eval(`(function () {
    var el = document.querySelector('[data-sb-module-type="home.championHero"]');
    var t = el.innerText || '';
    return { back: t.indexOf('COMPETITION HISTORY') >= 0, stale: t.indexOf('ARCHIVE OF RECORD') >= 0 };
  })()`)
  check('undo restores the published heading', undone.back === true)
  check('and leaves nothing of the edit behind', undone.stale === false)

  section('The achievement slots choose an award, never a person')
  const achSel = await b.eval(selectModule('rankings.achievementPlaques'))
  check('the plaques can be selected', achSel.ok === true, achSel.why)
  await sleep(1200)
  const achInspector = await b.eval(inspector)
  check('its settings open', achInspector != null)
  check('offering three slots', achInspector.text.includes('first achievement')
    && achInspector.text.includes('second achievement')
    && achInspector.text.includes('third achievement'), achInspector.text.slice(0, 200))
  /*
    The important negative: there is no field here that could freeze a live figure.

    An Owner picks WHICH award to show. The holder, the number and the supporting line are computed
    at render time. A "winner" or "value" field would be the thing that lets a homepage quietly stop
    agreeing with the Achievements page.
  */
  check('and no field that could copy a live figure into stored text',
    !/winner|holder name|value|percentage/i.test(achInspector.text), achInspector.text.slice(0, 200))

  const swapped = await b.eval(setTextField('best-win-rate', 'most-wins'))
  check('a slot can be pointed at a different award', swapped.ok === true, swapped.why)
  await sleep(3500)
  const recomputed = await b.eval(`(function () {
    var el = document.querySelector('[data-sb-module-type="rankings.achievementPlaques"]');
    var t = (el.innerText || '');
    return { absoluteUnit: /ABSOLUTE UNIT/i.test(t), oldOne: /BEST WIN PERCENTAGE/i.test(t),
             wins: /221/.test(t) };
  })()`)
  check('the card recomputes from the achievement engine', recomputed.absoluteUnit === true, JSON.stringify(recomputed))
  check('...including the holder and the figure', recomputed.wins === true, JSON.stringify(recomputed))
  check('...and the previous award is gone', recomputed.oldOne === false, JSON.stringify(recomputed))

  await b.key('z', { ctrl: true })
  await sleep(3500)
  const restored = await b.eval(`(function () {
    var el = document.querySelector('[data-sb-module-type="rankings.achievementPlaques"]');
    return /BEST WIN PERCENTAGE/i.test(el.innerText || '');
  })()`)
  check('undo restores the published choice', restored === true)

  section('The article thumbnails are reachable')
  const newsSel = await b.eval(selectModule('editorial.newsPlaques'))
  check('the news panel can be selected', newsSel.ok === true, newsSel.why)
  await sleep(1200)
  const newsInspector = await b.eval(inspector)
  check('its settings open', newsInspector != null)
  check('and the thumbnails are editable as a list',
    newsInspector.text.includes('article thumbnails'), newsInspector.text.slice(0, 200))

  section('Nothing was left behind')
  const state = await b.eval(`(function () {
    var el = document.querySelector('[data-sb-module-type="home.championHero"]');
    var ach = document.querySelector('[data-sb-module-type="rankings.achievementPlaques"]');
    return {
      heading: (el.innerText || '').indexOf('COMPETITION HISTORY') >= 0,
      award: /BEST WIN PERCENTAGE/i.test(ach.innerText || ''),
    };
  })()`)
  check('the page is back to what is published', state.heading && state.award, JSON.stringify(state))

  const errors = typeof b.consoleErrors === 'function' ? b.consoleErrors() : []
  const real = (errors as string[]).filter((e) => !/hydrat/i.test(e))
  check('no console errors through the whole session', real.length === 0, JSON.stringify(real).slice(0, 400))
} finally {
  await b.close()
}

console.log(`\n${'═'.repeat(80)}`)
if (fail) {
  console.log(`\n${fail} FAILED:\n`)
  for (const f of failures) console.log(`  x ${f}`)
}
console.log(`\n${pass} checks passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
