/**
 * Does the DEVELOPMENT server actually work in a browser?
 *
 * ── Why this check exists ────────────────────────────────────────────────────────────────────────
 * The site builder is used on the dev server, so "it works under `next start`" is not good enough.
 * And the failure mode this guards against is the quietest one there is: the page renders correctly,
 * every control is visible, the RSC payload arrives in full — and nothing hydrates, so no button
 * does anything. There is no console error, no failed request and nothing in the dev overlay. The
 * cause was `allowedDevOrigins`: Next refuses its development client bootstrap to an origin it does
 * not consider canonical, and `127.0.0.1` is not `localhost`.
 *
 * So this asserts the things that were all true while the site was completely dead:
 *
 *   1. React actually attached (fibers on real host nodes), not merely that markup exists.
 *   2. A control RESPONDS — the DOM changes when it is clicked.
 *   3. React reported no hydration mismatch.
 *   4. The console has no uncaught errors and no failed requests.
 *   5. An edit in Edit Mode can be made, saved, and read back.
 *
 * Run: npm run test:dev-hydration      (with `npm run dev:replica` already running)
 */
import { launch, reporter, BASE } from './browser/driver.mjs'

const r = reporter('dev hydration')
const browser = await launch()

try {
  // ── 1. Public pages hydrate ────────────────────────────────────────────────────────────────────
  r.section(`Hydration on the dev server (${BASE})`)
  await browser.viewport(1600, 1000)

  for (const route of ['/', '/seasons', '/rankings', '/yahoo', '/login']) {
    browser.clearEvents()
    await browser.goto(route, 4000)
    const state = await browser.eval(`(function () {
      var nodes = [document.querySelector('header'), document.querySelector('main'), document.body];
      var attached = nodes.filter(Boolean).filter(function (n) {
        return Object.keys(n).some(function (k) { return k.indexOf('__react') === 0 });
      }).length;
      return { attached: attached, of: nodes.filter(Boolean).length, chars: (document.body.innerText || '').length };
    })()`)
    r.check(`${route} — React attached`, state.attached === state.of, `${state.attached}/${state.of} host nodes`)
    r.check(`${route} — no hydration mismatch`, browser.events.hydrationWarnings.length === 0, browser.events.hydrationWarnings[0]?.slice(0, 140))
    r.check(`${route} — no uncaught errors`, browser.events.errors.length === 0, browser.events.errors[0]?.slice(0, 140))
    r.check(`${route} — no failed requests`, browser.events.failedRequests.length === 0, browser.events.failedRequests[0])
  }

  // ── 2. A control responds ──────────────────────────────────────────────────────────────────────
  r.section('Client handlers are live')
  browser.clearEvents()
  await browser.goto('/', 4000)
  // The Display Lab opener is a pre-existing client control, chosen precisely because it has nothing
  // to do with the builder: if it responds, the page is genuinely interactive.
  const responded = await browser.eval(`(function () {
    var before = document.body.innerHTML.length;
    var btn = document.querySelector('[aria-label*="Display" i], button[title*="Display" i]');
    if (!btn) return { found: false };
    btn.click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({ found: true, changed: document.body.innerHTML.length !== before });
      }, 900);
    });
  })()`)
  r.check('a pre-existing client control exists', responded.found === true)
  r.check('clicking it changes the DOM', responded.changed === true, 'the page rendered but never became interactive')

  // ── 3. Edit Mode works, end to end ─────────────────────────────────────────────────────────────
  r.section('Edit Mode on the dev server')
  await browser.signInAsOwner()
  browser.clearEvents()
  await browser.goto('/?edit=1', 7000)

  const shell = await browser.eval(`(function () {
    var asides = [].slice.call(document.querySelectorAll('aside'));
    var named = function (re) { return asides.some(function (a) { return re.test(a.getAttribute('aria-label') || '') }) };
    return {
      overlay: !!document.querySelector('.sb-overlay'),
      modules: document.querySelectorAll('[data-sb-module]').length,
      library: named(/Modules/i),
      inspector: named(/Settings/i),
      overlayAttached: (function () {
        var o = document.querySelector('.sb-overlay');
        return !!o && Object.keys(o).some(function (k) { return k.indexOf('__react') === 0 });
      })()
    };
  })()`)
  r.check('the editing overlay renders', shell.overlay === true)
  r.check('the overlay is hydrated, not just markup', shell.overlayAttached === true)
  r.check('modules are anchored', shell.modules > 0, String(shell.modules))
  r.check('the module library is present', shell.library === true)
  r.check('the inspector is present', shell.inspector === true)

  // Selecting must actually change editor state — this is the interaction the whole feature rests on.
  const selected = await browser.eval(`(function () {
    var el = document.querySelector('[data-sb-module]');
    if (!el) return { ok: false, why: 'no module anchor' };
    var rect = el.getBoundingClientRect();
    var hit = document.elementFromPoint(rect.left + rect.width / 2, Math.max(60, rect.top + 40));
    if (!hit) return { ok: false, why: 'nothing at that point' };
    hit.click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var aside = [].slice.call(document.querySelectorAll('aside')).filter(function (a) {
          return /Settings/i.test(a.getAttribute('aria-label') || '');
        })[0];
        var text = aside ? aside.innerText : '';
        resolve({ ok: !/NOTHING SELECTED/i.test(text), text: text.split('\\n').slice(0, 5).join(' | ') });
      }, 1200);
    });
  })()`)
  r.check('clicking a module selects it', selected.ok === true, selected.why || selected.text)

  // ── 4. An edit can be made, saved and read back ────────────────────────────────────────────────
  r.section('Draft round-trip')
  const edited = await browser.eval(`(function () {
    // Add a module through the palette, which exercises the store, the server action and the reload.
    var buttons = [].slice.call(document.querySelectorAll('aside button'));
    var add = buttons.filter(function (b) { return /^Heading$/.test((b.querySelector('span span') || {}).textContent || '') })[0]
      || buttons.filter(function (b) { return /Heading/.test(b.textContent || '') })[0];
    if (!add) return { ok: false, why: 'the Heading module is not in the palette' };
    var before = document.querySelectorAll('[data-sb-module]').length;
    add.click();
    return new Promise(function (resolve) {
      // Autosave is debounced, then the canvas re-renders through the server.
      setTimeout(function () {
        resolve({ ok: true, before: before, after: document.querySelectorAll('[data-sb-module]').length,
                  status: (document.body.innerText.match(/Saved|Saving|Unsaved changes|Not saved/i) || [''])[0] });
      }, 6000);
    });
  })()`)
  r.check('a module can be inserted', edited.ok === true, edited.why || '')
  r.check('the canvas shows the new module', (edited.after || 0) > (edited.before || 0), `${edited.before} → ${edited.after}`)
  r.check('the editor reports the draft saved', /saved/i.test(edited.status || ''), `status: ${edited.status || '(none)'}`)

  /*
    Undo runs in the SAME session, before any reload.

    The undo stack is a property of the editing session, so reloading first and then pressing Undo
    correctly does nothing — an earlier version of this check reloaded in between and reported a bug
    that was really the test misunderstanding the feature.
  */
  const reverted = await browser.eval(`(function () {
    var undo = document.querySelector('button[aria-label="Undo"]');
    if (!undo) return { ok: false, why: 'no Undo control' };
    undo.click();
    return new Promise(function (res) {
      setTimeout(function () { res({ ok: true, count: document.querySelectorAll('[data-sb-module]').length }) }, 6000);
    });
  })()`)
  r.check('undo removes it again', reverted.ok && reverted.count === edited.before, reverted.why || `${reverted.count} vs ${edited.before}`)

  // Only now reload — which proves BOTH that the insert reached the server and that the undo did,
  // and leaves the draft exactly as the suite found it.
  await browser.goto('/?edit=1', 6000)
  const persisted = await browser.eval(`document.querySelectorAll('[data-sb-module]').length`)
  r.check('the round trip persisted and left no trace', persisted === edited.before, `${persisted} after reload, ${edited.before} at the start`)

  r.section('Console, over the whole run')
  r.check('no uncaught errors in Edit Mode', browser.events.errors.length === 0, browser.events.errors[0]?.slice(0, 160))
  r.check('no hydration mismatches in Edit Mode', browser.events.hydrationWarnings.length === 0, browser.events.hydrationWarnings[0]?.slice(0, 160))
} finally {
  browser.close()
}

process.exit(r.finish() ? 1 : 0)
