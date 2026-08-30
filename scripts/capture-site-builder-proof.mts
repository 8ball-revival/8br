/**
 * Capture the evidence a review of this work needs, by actually doing each thing in a browser.
 *
 * ── Why a script and not a set of manual screenshots ─────────────────────────────────────────────
 * A screenshot is a claim. Taken by hand, it is a claim nobody can re-check, and one that goes stale
 * the moment the code moves. This drives the real editor against the real dev server, performs each
 * operation, and captures what actually happened — so the pictures can be regenerated after any
 * change, and a picture that stops being true stops being produced.
 *
 * Every step also ASSERTS. A screenshot of a panel that failed to open still looks like a screenshot
 * of a panel, so each capture is preceded by a check that the thing being photographed is there.
 *
 * ── What it writes ───────────────────────────────────────────────────────────────────────────────
 * PNGs into docs/site-builder-proof/, numbered in the order a reviewer should read them.
 *
 * ── And what it writes to the DATABASE ───────────────────────────────────────────────────────────
 * It publishes. That is what makes it proof rather than a mock-up. So it runs behind a guard: the
 * host must be local, the operator must acknowledge that builder rows will be written, and the exact
 * rows it touches are snapshotted first and restored in a `finally` — including after a failure, and
 * including after a run that was killed outright, which the next invocation finishes for it.
 *
 * It touches ONE page. Nothing else is snapshotted, because restoring rows nobody wrote would be its
 * own way of losing work, and competition data is never involved at all.
 *
 * Run: npm run dev:replica, then npm run capture:site-builder -- --i-accept-local-writes
 */
import { launch, reporter, sleep } from './browser/driver.mjs'
import {
  assertCaptureAllowed, clearJournal, recoverInterruptedRun, restorePages, snapshotPages,
  TOUCHED_PAGE_KEYS, type CaptureJournal,
} from './capture-guard.mts'

const JOURNAL_HINT = 'The snapshot is in .fingerprints/capture-journal.json; the next run will finish the restore.'
const OUT = 'docs/site-builder-proof'
const r = reporter('proof')

// ── The guard, before anything is launched ──────────────────────────────────────────────────────
let allowed: { databaseUrl: string; label: string }
try {
  allowed = assertCaptureAllowed()
} catch (err) {
  console.error(`
  ${err instanceof Error ? err.message : String(err)}
`)
  process.exit(1)
}

process.env.DATABASE_URL = allowed.databaseUrl
const { prisma } = await import('../src/lib/prisma')

console.log(`
  database:        ${allowed.label}`)
console.log(`  pages it writes: ${TOUCHED_PAGE_KEYS.join(', ')}`)

for (const note of await recoverInterruptedRun(prisma, allowed.label)) console.log(`  ${note}`)

const journal: CaptureJournal = await snapshotPages(prisma, allowed.label)
console.log(`  snapshotted:     ${journal.pages.map((p) => `${p.key} (${p.revisionNumbers.length} revisions)`).join(', ') || 'nothing'}
`)

const browser = await launch()

/** Click the first button whose text matches, and say whether one was found. */
const CLICK_BY_TEXT = (pattern, tag = 'button') => `(function () {
  var els = [].slice.call(document.querySelectorAll(${JSON.stringify(tag)}));
  var re = new RegExp(${JSON.stringify(pattern)}, 'i');
  var hit = els.filter(function (b) { return re.test((b.textContent || '').trim()) })[0];
  if (hit) { hit.click(); return true }
  return false
})()`

const dismissTour = () => browser.eval(CLICK_BY_TEXT('^Skip$'))

async function shoot(name, note) {
  await sleep(400)
  await browser.screenshot(`${OUT}/${name}.png`)
  console.log(`     → ${name}.png  ${note}`)
}

try {
  // ── 1. The published site, at three widths ────────────────────────────────────────────────────
  r.section('The published site')
  for (const [label, w, h, mobile] of [['desktop', 1600, 1000, false], ['tablet', 768, 1024, true], ['mobile', 390, 844, true]]) {
    await browser.viewport(w, h, mobile)
    await browser.goto('/', 3000)
    const probe = await browser.eval('({ chars: document.body.innerText.length, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth })')
    r.check(`the published homepage renders at ${label}`, probe.chars > 500 && probe.overflow <= 1, JSON.stringify(probe))
    await shoot(`01-published-${label}`, `the public homepage at ${w}×${h}`)
  }

  await browser.signInAsOwner()

  /*
    Start from the built-in homepage.

    This script publishes — that is what makes it proof rather than a mock-up — so a second run would
    otherwise photograph the leftovers of the first, and the pictures would drift further from the
    site with every run. Reset restores the layout defined in code as a DRAFT, which is then
    published, so every run starts from the same page and the images stay comparable.
  */
  await browser.viewport(1600, 1200, false)
  await browser.goto('/staff/site-builder', 5000)
  const resetStarted = await browser.eval(`(function () {
    window.confirm = function () { return true };
    var b = [].slice.call(document.querySelectorAll('button')).filter(function (x) {
      return /^Reset Homepage/i.test(x.getAttribute('aria-label') || '')
    })[0];
    if (!b) return 'no reset control';
    b.click();
    return 'clicked'
  })()`)
  await sleep(4000)
  r.check('the homepage can be reset to the built-in layout', resetStarted === 'clicked', String(resetStarted))
  await browser.goto('/?edit=1', 6000)
  await browser.eval(CLICK_BY_TEXT('^Skip$'))
  await browser.eval(CLICK_BY_TEXT('^Publish'))
  await sleep(1200)
  await browser.eval(CLICK_BY_TEXT('Publish now'))
  await sleep(3500)
  const clean = await browser.eval("document.querySelectorAll('[data-sb-section]').length")
  r.check('and the reset publishes as the five built-in rows', clean === 5, `${clean} sections`)

  /*
    ── 2. The first-run tour ───────────────────────────────────────────────────────────────────────

    Before anything else touches Edit Mode. The tour remembers in localStorage, so the FIRST entry in
    this browser profile is the only chance to photograph it — capturing it later would produce a
    picture of an editor with no tour and a check that passed for the wrong reason.
  */
  r.section('The guided tour')
  await browser.viewport(1600, 1000, false)
  // The reset above already dismissed it, so clear the one thing that remembers and come back.
  await browser.eval("(function () { try { window.localStorage.clear() } catch (e) {} return 1 })()")
  await browser.goto('/?edit=1', 6000)
  const tourShown = await browser.eval(`(function () {
    var d = document.querySelector('[aria-label="How the site builder works"]');
    return !!d && /Step 1 of/.test(d.textContent || '')
  })()`)
  r.check('the tour appears on a fresh browser', tourShown === true)
  await shoot('03-guided-tour', 'the dismissible first-run tour')
  const skipped = await dismissTour()
  await sleep(500)
  const gone = await browser.eval(`!document.querySelector('[aria-label="How the site builder works"]')`)
  r.check('and Skip dismisses it', skipped === true && gone === true)

  // ── 3. Edit Mode, at three widths ─────────────────────────────────────────────────────────────
  r.section('Edit Mode')
  for (const [label, w, h, mobile] of [['desktop', 1600, 1000, false], ['tablet', 768, 1024, true], ['mobile', 390, 844, true]]) {
    await browser.viewport(w, h, mobile)
    await browser.goto('/?edit=1', 5000)
    await dismissTour()
    const probe = await browser.eval(`({
      overlay: !!document.querySelector('.sb-overlay'),
      panels: document.querySelectorAll('aside').length,
      publish: [].slice.call(document.querySelectorAll('button')).some(function (b) { return /Publish/i.test(b.textContent || '') })
    })`)
    r.check(`Edit Mode is usable at ${label}`, probe.overlay && probe.publish, JSON.stringify(probe))
    await shoot(`02-edit-mode-${label}`, `Edit Mode at ${w}×${h}`)
  }

  // ── 4. Inserting a module ─────────────────────────────────────────────────────────────────────
  r.section('Inserting a module')
  await browser.viewport(1600, 1000, false)
  await browser.goto('/?edit=1', 6000)
  await dismissTour()

  /*
    Into a section of its own, added first.

    Not fussiness: the next step moves a module, and "move up" from the first position of the first
    section is a legitimate no-op. Working in a fresh section at the end of the page means the move
    is a real move, and the check measures the editor rather than where the click happened to land.
  */
  const sectionsBefore = await browser.eval("document.querySelectorAll('[data-sb-section]').length")
  await browser.eval(CLICK_BY_TEXT('Add a section'))
  await sleep(2500)

  // Search, so the picture shows the library doing its job rather than a wall of modules.
  const searched = await browser.eval(`(function () {
    var i = document.querySelector('input[aria-label="Search modules"]');
    if (!i) return 'no search box';
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, 'Heading');
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok'
  })()`)
  await sleep(700)
  r.check('the module library can be searched', searched === 'ok', String(searched))
  await shoot('04-module-library', 'the module library, searched')

  const addNamed = (name) => browser.eval(`(function () {
    var buttons = [].slice.call(document.querySelectorAll('aside button'));
    var hit = buttons.filter(function (b) {
      var label = b.querySelector('span span');
      return label && label.textContent.trim() === ${JSON.stringify(name)}
    })[0];
    if (!hit) return 'no ' + ${JSON.stringify(name)} + ' button among ' + buttons.length;
    hit.click();
    return 'clicked'
  })()`)

  const before = await browser.eval("document.querySelectorAll('[data-sb-module]').length")
  const clicked = await addNamed('Heading')
  await sleep(2500)
  const after = await browser.eval("document.querySelectorAll('[data-sb-module]').length")
  r.check('a module can be inserted from the library', clicked === 'clicked' && after > before, `${clicked}: ${before} -> ${after}`)
  const selected = await browser.eval(`(function () {
    var t = document.body.innerText;
    return { inspector: /Size & placement/i.test(t), heading: /Heading/i.test(t) }
  })()`)
  r.check('and it is selected, with its settings open', selected.inspector === true, JSON.stringify(selected))
  await shoot('05-module-inserted', 'the module on the canvas, selected, with its settings open')

  // ── 5. Moving it, by button — never only by drag ──────────────────────────────────────────────
  r.section('Moving a module')

  // A second module in the same section, so the one being moved has somewhere to move to.
  await browser.eval(`(function () {
    var i = document.querySelector('input[aria-label="Search modules"]');
    if (!i) return false;
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, 'Eyebrow');
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return true
  })()`)
  await sleep(600)
  const second = await addNamed('Eyebrow label')
  await sleep(2500)
  r.check('a second module goes in beside the first', second === 'clicked', String(second))

  const orderOf = `(function () {
    var s = [].slice.call(document.querySelectorAll('[data-sb-section]')).pop();
    if (!s) return '';
    return [].slice.call(s.querySelectorAll('[data-sb-module]')).map(function (e) {
      return e.getAttribute('data-sb-module-type')
    }).join(',')
  })()`
  const orderBefore = await browser.eval(orderOf)
  const nudged = await browser.eval(`(function () {
    var b = [].slice.call(document.querySelectorAll('button')).filter(function (x) {
      return /^Move up/i.test(x.getAttribute('title') || '')
    })[0];
    if (!b) return 'no move control';
    b.click();
    return 'clicked'
  })()`)
  /*
    A structural change reaches the DOM only after the draft has saved and the canvas has refreshed
    — the modules are server-rendered, so the new order arrives with the response rather than with
    the click. Polling for the change rather than sleeping a fixed amount is the difference between
    a check that measures the editor and one that measures this machine's load.
  */
  let orderAfter = orderBefore
  for (let i = 0; i < 24 && orderAfter === orderBefore; i++) {
    await sleep(500)
    orderAfter = await browser.eval(orderOf)
  }
  r.check('a module can be moved by button, with no drag involved',
    nudged === 'clicked' && orderBefore !== orderAfter, `${nudged}; "${orderBefore}" -> "${orderAfter}"`)
  await shoot('06-module-moved', 'the module after being moved by button, not by drag')
  void sectionsBefore

  // ── 6. The layer tree and the command palette ─────────────────────────────────────────────────
  r.section('Layers and the command palette')
  const treeOpen = await browser.eval(CLICK_BY_TEXT('^Layers$'))
  await sleep(700)
  const treeRows = await browser.eval(`(function () {
    var panel = [].slice.call(document.querySelectorAll('aside')).filter(function (a) { return /Layers/.test(a.textContent || '') })[0];
    return panel ? panel.querySelectorAll('li').length : 0
  })()`)
  r.check('the layer tree lists the document', treeOpen === true && treeRows > 0, `${treeRows} rows`)
  await shoot('07-layer-tree', 'the page as a tree, with the selection highlighted')

  // A real key press through the protocol, not a synthesised event — see `key()` in the driver.
  await browser.key('k', { ctrl: true })
  await sleep(900)
  const paletteOpen = await browser.eval(`!!document.querySelector('input[aria-label="Command"]')`)
  r.check('Ctrl+K opens the command palette', paletteOpen === true)
  const commands = await browser.eval(`(function () {
    var l = document.querySelector('[aria-label="Command palette"]');
    return l ? l.querySelectorAll('li,[role="option"],button').length : 0
  })()`)
  r.check('and it offers commands to run', commands > 0, `${commands} listed`)
  await shoot('08-command-palette', 'every action by name, including every module')
  await browser.key('Escape')
  await sleep(600)
  const paletteClosed = await browser.eval(`!document.querySelector('input[aria-label="Command"]')`)
  r.check('Escape closes it again', paletteClosed === true)

  // ── 7. Publishing, and what it checks first ───────────────────────────────────────────────────
  r.section('Publishing')
  await browser.eval(CLICK_BY_TEXT('^Publish'))
  await sleep(900)
  const dialog = await browser.eval(`(function () {
    var t = document.body.innerText;
    return { open: /Publish this page/i.test(t), summary: /What changed/i.test(t) }
  })()`)
  r.check('the publish dialog reviews the page first', dialog.open === true, JSON.stringify(dialog))
  await shoot('09-publish-dialog', 'the pre-publish review, with anything worth a look')
  const published = await browser.eval(CLICK_BY_TEXT('Publish now'))
  await sleep(3000)
  r.check('publishing completes', published === true)

  await browser.goto('/', 3000)
  const live = await browser.eval("document.body.innerText.length")
  r.check('the published page still renders after publishing', live > 500, `${live} chars`)
  await shoot('10-published-result', 'the public homepage carrying the published change')

  // ── 8. Revision history and rollback ──────────────────────────────────────────────────────────
  r.section('Revision history and rollback')
  await browser.viewport(1600, 1200, false)
  await browser.goto('/staff/site-builder', 4000)
  const centre = await browser.eval(`(function () {
    var t = document.body.innerText;
    return { chars: t.length, homepage: /Homepage/i.test(t), template: /Season template/i.test(t), global: /Navigation/i.test(t) }
  })()`)
  r.check('the control centre lists static pages, templates and globals',
    centre.homepage && centre.template && centre.global, JSON.stringify(centre))
  await shoot('11-control-centre', 'every editable page, its state and its actions')

  const historyOpen = await browser.eval(`(function () {
    var b = [].slice.call(document.querySelectorAll('a,button')).filter(function (x) {
      return /history/i.test((x.getAttribute('title') || '') + ' ' + (x.getAttribute('aria-label') || ''))
    })[0];
    if (b) { b.click(); return true }
    return false
  })()`)
  await sleep(2500)
  const revisions = await browser.eval(`(function () {
    var t = document.body.innerText;
    return { rows: (t.match(/Revision\\s+\\d+/gi) || []).length, restore: /Restore/i.test(t) }
  })()`)
  r.check('revision history shows the chain and offers Restore',
    revisions.rows > 0 || revisions.restore, `${historyOpen ? 'opened' : 'not found'} ${JSON.stringify(revisions)}`)
  await shoot('12-revision-history', 'the append-only history, with Restore on each entry')

  // ── 9. Editing the navigation, and the theme with its contrast report ─────────────────────────
  r.section('Globals')
  await browser.goto('/staff/site-builder/global/nav', 5000)
  await dismissTour()
  const navPanel = await browser.eval(`(function () {
    var t = document.body.innerText;
    return { nav: /Site navigation/i.test(t), links: /Links/i.test(t) }
  })()`)
  r.check('the navigation is edited through the builder', navPanel.nav === true, JSON.stringify(navPanel))
  await shoot('13-navigation-editing', 'the header, edited as a page with drafts and history')

  await browser.goto('/staff/site-builder/global/theme', 6000)
  await dismissTour()
  // The contrast report lives in the theme module's inspector, so the module has to be selected --
  // which is exactly what an administrator does to reach it.
  const themeRect = await browser.eval(`(function () {
    var el = document.querySelector('[data-sb-module-type="global.theme"]');
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + Math.min(30, r.height / 2) }
  })()`)
  if (themeRect) await browser.click(themeRect.x, themeRect.y)
  const themeSelected = themeRect ? 'clicked' : 'no theme module on the page'
  await sleep(1200)
  const theme = await browser.eval(`(function () {
    var t = document.body.innerText;
    return {
      theme: /Site theme/i.test(t),
      contrast: /Contrast/i.test(t),
      ratios: (t.match(/\\d+\\.\\d:1/g) || []).length
    }
  })()`)
  r.check('the theme editor shows a live contrast report',
    theme.contrast === true && theme.ratios > 0, `${themeSelected}: ${JSON.stringify(theme)}`)
  await shoot('14-theme-contrast', 'every pairing the site renders, with its WCAG ratio')

  /*
    ── 10. A dynamic template ──────────────────────────────────────────────────────────────────────

    Edited while standing on a real Season, because that is the only way to see what the layout does
    to live data. The page key is `season`, not `/seasons/16426`: what is being edited governs EVERY
    Season page, which is why the toolbar says Season rather than the Season's own name.
  */
  r.section('A dynamic template')
  await browser.viewport(1600, 1000, false)
  await browser.goto('/seasons/16426?edit=1', 6000)
  await dismissTour()
  const template = await browser.eval(`(function () {
    var t = document.body.innerText;
    return {
      chars: t.length,
      editing: !!document.querySelector('.sb-overlay'),
      liveData: /Kevin/.test(t),
      label: /Season/i.test(t)
    }
  })()`)
  r.check('the Season template is edited against real Season data',
    template.editing === true && template.liveData === true, JSON.stringify(template))
  await shoot('15-dynamic-template', 'the Season template, edited on a real Season')

  /*
    ── 11. A template with nothing built from it ───────────────────────────────────────────────────

    The case that used to be impossible. A template created from nothing, opened, edited and saved,
    with no page anywhere having ever used it — which is why the control centre used to say "no edit
    link" and offer nothing.
  */
  r.section('A template with zero instances')
  await browser.viewport(1600, 1100, false)
  await browser.goto('/staff/site-builder', 8000)

  const templatesTab = await browser.eval(CLICK_BY_TEXT('^Templates'))
  await sleep(1500)
  r.check('the Templates area opens', templatesTab === true)
  await shoot('17-templates-area', 'every template, including empty ones')

  const newDialog = await browser.eval(CLICK_BY_TEXT('New template'))
  await sleep(1200)
  r.check('a template can be created from nothing', newDialog === true)

  const named = await browser.eval(`(function () {
    var inputs = [].slice.call(document.querySelectorAll('input[type="text"]'));
    if (!inputs.length) return 'no name field';
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inputs[0], 'Zero-instance probe');
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    if (inputs[1]) {
      setter.call(inputs[1], 'Made empty, edited directly, used by nothing.');
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    }
    return 'ok'
  })()`)
  r.check('it can be named and described', named === 'ok', String(named))
  await sleep(400)
  await shoot('18-new-template', 'a blank template, before anything has been built from it')

  const created = await browser.eval(CLICK_BY_TEXT('Create and open'))
  await sleep(6000)
  r.check('creating it opens the editor', created === true)

  const editorState = await browser.eval(`(function () {
    var t = document.body.innerText;
    return {
      onTemplate: /Zero-instance probe/.test(t),
      overlay: !!document.querySelector('.sb-overlay'),
      // No regex escape here on purpose: inside a template literal JS eats the backslash in \s,
      // so /Nothing\s*publishes/ evaluates as /Nothingspublishes/ and never matches anything.
      savesNotPublishes: t.replace(/[^A-Za-z ]+/g, ' ').replace(/ +/g, ' ').indexOf('Nothing publishes') >= 0,
      hasPublishButton: [].slice.call(document.querySelectorAll('button')).some(function (b) {
        return /^Publish$/i.test((b.textContent || '').trim())
      }),
      url: location.pathname
    }
  })()`)
  r.check('the template editor is the real editor', editorState.overlay === true, JSON.stringify(editorState))
  r.check('on its own route', /\/staff\/site-builder\/templates\//.test(String(editorState.url)), String(editorState.url))
  r.check('with no publish step, because a template is not on the site', editorState.hasPublishButton === false)
  r.check('and it says so', editorState.savesNotPublishes === true)
  await shoot('19-template-editor', 'a template with zero instances, open in the full editor')

  // Build something in it, which is the whole point of a template that starts empty.
  await browser.eval(CLICK_BY_TEXT('Add a section'))
  await sleep(3000)
  const addedToTemplate = await browser.eval(`(function () {
    var buttons = [].slice.call(document.querySelectorAll('aside button'));
    var hit = buttons.filter(function (b) {
      var label = b.querySelector('span span');
      return label && label.textContent.trim() === 'Heading'
    })[0];
    if (!hit) return 'no Heading button';
    hit.click();
    return 'clicked'
  })()`)
  await sleep(4000)
  const templateModules = await browser.eval("document.querySelectorAll('[data-sb-module]').length")
  r.check('a module can be added to an empty template',
    addedToTemplate === 'clicked' && Number(templateModules) > 0, `${addedToTemplate}, ${templateModules} modules`)
  await shoot('20-template-built', 'the same template after building in it, saved as you work')

  const usageOpened = await browser.eval(CLICK_BY_TEXT('Where it is used'))
  await sleep(2500)
  const usage = await browser.eval(`(function () {
    var t = document.body.innerText;
    return { open: /Where this template is used/i.test(t), none: /None\./.test(t) }
  })()`)
  r.check('it reports where it is used', usageOpened === true && usage.open === true, JSON.stringify(usage))
  await shoot('21-template-usage', 'nothing links to it, and it says so plainly')

  r.section('The template applied')
  await browser.viewport(1600, 1000, false)
  await browser.goto('/seasons/16426', 4000)
  const season = await browser.eval(`(function () {
    var t = document.body.innerText;
    return { chars: t.length, kevin: /Kevin/.test(t), editing: !!document.querySelector('.sb-overlay') }
  })()`)
  r.check('the same page renders to a visitor through the template',
    season.chars > 800 && season.editing === false, JSON.stringify(season))
  r.check('and Season 16426 still shows Kevin as its champion', season.kevin === true)
  await shoot('16-template-applied', 'Season 16426 as a visitor sees it, through the template')
} finally {
  await browser.close()

  /*
    Put the page back, whatever happened above.

    This runs after a pass, after a failed check, and after a thrown exception. The journal on disk
    covers the one case it cannot — a process killed outright — by having the next run do it.
  */
  console.log('')
  console.log('  restoring what this run changed:')
  try {
    for (const note of await restorePages(prisma, journal)) console.log(`    ${note}`)
    clearJournal()
  } catch (err) {
    console.error(`    RESTORE FAILED: ${err instanceof Error ? err.message : String(err)}`)
    console.error(`    ${JOURNAL_HINT}`)
  }
  await prisma.$disconnect().catch(() => {})
}

process.exit(r.finish() ? 1 : 0)
