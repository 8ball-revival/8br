/**
 * The three states, driven through the controls a person actually presses.
 *
 * ── Why this exists alongside test:theme:publish ────────────────────────────────────────────────
 * That suite proves the LIFECYCLE: a draft is private, a publish is public, a rollback undoes it.
 * It reaches the service directly, which is the right way to test a service and the wrong way to
 * test a panel. The failures this one is for live entirely in the gap between the two — a preset
 * that quietly publishes, a Save button wired to the publish action, a status banner that says
 * "published" over an unsaved preview, a confirmation that confirms nothing.
 *
 * So every assertion here starts with a click and ends at either the database or the HTML a
 * signed-out visitor is served. Nothing is asserted about React state.
 *
 * Run: npm run test:theme:lifecycle (with the dev server up)
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

const BASE = process.env.SB_BASE ?? 'http://localhost:3000'

let pass = 0
let fail = 0
const failures: string[] = []
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ok   ${label}`) }
  else { fail++; failures.push(label); console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`)

const { prisma } = await import('../src/lib/prisma')
await import('../src/components/site-builder/modules')
const { getDraft, saveDraft, publish } = await import('../src/lib/site-builder/service')
const { THEME_PAGE_KEY } = await import('../src/lib/site-builder/globals')
const { normaliseTokens, THEME_PRESETS } = await import('../src/lib/theme/presets')
const { THEME_TOKEN_REGISTRY } = await import('../src/lib/theme/registry')

const ACTOR = { userId: 0, username: 'theme-lifecycle-verification' }
type Mod = { type: string; config: Record<string, unknown>; children?: unknown[] }
type Doc = { sections: { modules: Mod[] }[] }

const themeModule = (doc: Doc) => {
  const walk = (m: Mod[]): Mod[] => m.flatMap((x) => [x, ...walk((x.children ?? []) as Mod[])])
  return walk(doc.sections.flatMap((s) => s.modules)).find((m) => m.type === 'global.theme')
}

/** The palette a signed-out visitor is currently served, straight from the published revision. */
const publishedPalette = async () => {
  const page = await prisma.sitePage.findUnique({
    where: { key: THEME_PAGE_KEY }, include: { publishedRevision: true },
  })
  const doc = page?.publishedRevision?.document as unknown as Doc | undefined
  return {
    palette: doc ? normaliseTokens(themeModule(doc)?.config ?? {}) : {},
    revision: page?.publishedRevision?.number ?? null,
  }
}
const draftPalette = async () => {
  const d = await getDraft(THEME_PAGE_KEY)
  return d ? normaliseTokens(themeModule(d.document as unknown as Doc)?.config ?? {}) : {}
}
/*
  Key ORDER is not part of a palette.

  A document that has been through the database comes back with its keys in a different order than
  the one that went in, so a raw JSON.stringify comparison reports two identical palettes as
  different. Sorted entries is the comparison that means what it says.
*/
const samePalette = (a: Record<string, string>, b: Record<string, string>) =>
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort())

/** The palette actually served in the published <style> block, rather than anywhere on the page. */
const publishedBlock = (html: string) =>
  /<style data-published-theme[^>]*>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? ''

const publicHtml = async () =>
  (await fetch(`${BASE}/?cb=${Math.random().toString(36).slice(2)}`, {
    headers: { 'Cache-Control': 'no-cache' },
  })).text()

// ── Driving the panel ──────────────────────────────────────────────────────────────────────────
type Browser = Awaited<ReturnType<typeof launch>>

/**
 * Click a button by the text it shows.
 *
 * Reports `disabled` distinctly from `not-found`, because those are opposite bugs: one is a control
 * that vanished, the other a control that is correctly refusing. A helper returning false for both
 * would make a working guard look like a missing button.
 */
const clickText = async (b: Browser, text: string): Promise<string> => String(await b.eval(`(function () {
  var t = ${JSON.stringify(text)};
  var el = Array.from(document.querySelectorAll('button')).filter(function (e) {
    return (e.textContent || '').trim().indexOf(t) === 0;
  })[0];
  if (!el) return 'not-found';
  if (el.disabled) return 'disabled';
  el.click();
  return 'ok';
})()`))

/*
  Case-insensitive on purpose.

  Section headings are upper-cased in CSS, so `innerText` returns "STARTING POINT" for a heading
  written as "Starting point" -- an exact match tests the stylesheet, not the content.
*/
/**
 * Click a button by its text, but only inside `scope`.
 *
 * The confirmation dialog's confirming button says "Publish site-wide" -- deliberately, so the last
 * thing read before the click is the thing that happens. That makes it a duplicate of the panel
 * control by text, and an unscoped search finds the panel one first and merely reopens the dialog.
 * Which looks, from the outside, exactly like a confirmation that publishes nothing.
 */
const clickIn = async (b: Browser, scope: string, text: string): Promise<string> => String(await b.eval(`(function () {
  var root = document.querySelector(${JSON.stringify(scope)});
  if (!root) return 'no-scope';
  var t = ${JSON.stringify(text)};
  var el = Array.from(root.querySelectorAll('button')).filter(function (e) {
    return (e.textContent || '').trim().indexOf(t) === 0;
  })[0];
  if (!el) return 'not-found';
  if (el.disabled) return 'disabled';
  el.click();
  return 'ok';
})()`))

const hasText = async (b: Browser, text: string): Promise<boolean> => Boolean(await b.eval(
  `document.body.innerText.toLowerCase().indexOf(${JSON.stringify(text.toLowerCase())}) !== -1`,
))

/** Whichever of the three state labels the banner is showing. */
const bannerState = async (b: Browser): Promise<string> => String(await b.eval(`(function () {
  var labels = ['Personal preview', 'Draft saved', 'Published site-wide', 'Checking'];
  var found = null;
  Array.from(document.querySelectorAll('[role="status"]')).forEach(function (el) {
    var text = (el.innerText || '').trim();
    labels.forEach(function (l) { if (!found && text.indexOf(l) === 0) found = l; });
  });
  return found || 'none';
})()`))

const liveToken = async (b: Browser, css: string): Promise<string> => String(await b.eval(
  `getComputedStyle(document.documentElement).getPropertyValue('${css}').trim()`,
))

/** Open the site, sign in as Owner, and get to the palette tab with the panel on screen. */
const openPalette = async (b: Browser) => {
  await b.viewport(1440, 1000, false)
  await b.signInAsOwner()
  await b.goto('/', 14000)
  await b.eval(`(function () {
    var el = document.querySelector('[aria-label="Customize Display"]');
    if (el) el.click();
    return !!el;
  })()`)
  await sleep(900)
  await b.eval(`(function () {
    var el = Array.from(document.querySelectorAll('[role="tab"]')).filter(function (e) {
      return (e.textContent || '').trim().indexOf('Palette') === 0;
    })[0];
    if (el) el.click();
    return !!el;
  })()`)
  await sleep(900)
}

const start = await publishedPalette()

const b = await launch()
let b2: Browser | null = null
try {
  section('An Owner is offered the publishing controls')
  await openPalette(b)
  check('the Display Lab palette opens', await hasText(b, 'Starting point'))
  check('the publishing panel is on it', await hasText(b, 'Save draft'))
  check('...with the publish control beside it', await hasText(b, 'Publish site-wide'))
  /*
    Nothing has been touched yet, so every write control should be refusing. A Save button that is
    live before anything changed is how an accidental publish starts.
  */
  check('Save draft is disabled until something changes',
    (await clickText(b, 'Save draft')) === 'disabled')
  check('...and so is Publish site-wide',
    (await clickText(b, 'Publish site-wide')) === 'disabled')
  check('and the browser-local note is NOT shown to an Owner',
    !(await hasText(b, 'These colours are yours alone')))

  // ══ 1. A preset is a preview, never a publish ═════════════════════════════════════════════════
  section('Choosing a preset changes nothing for anybody else')
  /*
    The single most damaging failure this panel could have.

    A preset applies 40-odd tokens at once, so if selection were wired anywhere near the publish
    path the whole site would change colour because somebody was browsing options. It is checked
    against the database and against a visitor's HTML, not against the banner, because the banner is
    the thing that would be lying.
  */
  const beforePreset = await publishedPalette()
  /*
    Captured BEFORE anything is previewed.

    A preset colour can legitimately coincide with something already in the document -- the static
    `theme-color` meta tag is #000000, which is also a preset's ground. Comparing against the
    untouched page first means the assertion is about values that ARRIVED, not values that match.
  */
  const baselineHtml = await publicHtml()
  /*
    Matched by preset NAME, not by "the first unpressed toggle on the page".

    The header's own Edit control is also an `aria-pressed` button and comes first in document
    order, so the obvious selector clicks site-builder edit mode and reports success having changed
    no colour at all.
  */
  const presetNames = THEME_PRESETS.map((x) => x.name)
  const picked = String(await b.eval(`(function () {
    var names = ${JSON.stringify(presetNames)};
    var el = Array.from(document.querySelectorAll('button[aria-pressed="false"]')).filter(function (e) {
      var text = (e.textContent || '').trim();
      return names.some(function (n) { return text.indexOf(n) === 0; });
    })[0];
    if (!el) return 'none';
    el.click();
    return (el.textContent || 'clicked').trim().slice(0, 40);
  })()`))
  check('a preset was available to pick', picked !== 'none', picked)
  await sleep(1500)

  check('the banner says it is a personal preview',
    (await bannerState(b)) === 'Personal preview', await bannerState(b))
  const afterPreset = await publishedPalette()
  check('no revision was published by picking it',
    afterPreset.revision === beforePreset.revision,
    `${beforePreset.revision} -> ${afterPreset.revision}`)
  check('the published palette is byte-identical',
    samePalette(afterPreset.palette, beforePreset.palette))
  check('and no draft was written either',
    samePalette(await draftPalette(), beforePreset.palette))

  const previewed = await b.eval(`(function () {
    var cs = getComputedStyle(document.documentElement);
    return ['--void', '--graphite', '--clean-white', '--signal', '--gold'].map(function (v) {
      return cs.getPropertyValue(v).trim();
    }).filter(function (v) { return /^#[0-9a-f]{3,8}$/i.test(v); });
  })()`) as string[]
  const arrived = [...new Set(previewed)].filter((v) => !baselineHtml.toLowerCase().includes(v.toLowerCase()))
  const strangerHtml = await publicHtml()
  check('the preview actually changed this browser', previewed.length > 0, JSON.stringify(previewed))
  check('a visitor is served none of the previewed palette',
    arrived.length > 0 && !arrived.some((v) => strangerHtml.toLowerCase().includes(v.toLowerCase())),
    `previewed ${JSON.stringify(previewed)}, new ${JSON.stringify(arrived)}`)

  // ══ 2. Save draft ═════════════════════════════════════════════════════════════════════════════
  section('Save draft stores it and still publishes nothing')
  check('the Save draft button is offered', (await clickText(b, 'Save draft')) === 'ok')
  await sleep(2500)
  check('the banner moves to the draft state',
    (await bannerState(b)) === 'Draft saved', await bannerState(b))

  const savedDraft = await draftPalette()
  check('the palette reached the draft', Object.keys(savedDraft).length > 0,
    `${Object.keys(savedDraft).length} tokens`)
  const afterSave = await publishedPalette()
  check('publishing still has not happened', afterSave.revision === beforePreset.revision,
    `${beforePreset.revision} -> ${afterSave.revision}`)
  check('and a visitor is still served the old palette',
    samePalette(afterSave.palette, beforePreset.palette))

  // ══ 3. The draft outlives the browser it was made in ══════════════════════════════════════════
  section('A saved draft survives a new browser and a new sign-in')
  /*
    This is the difference between a draft and a preview, so it is tested with a genuinely separate
    Chrome profile — new localStorage, new cookie jar, new session — rather than a reload, which
    would prove only that localStorage works.
  */
  b2 = await launch()
  await openPalette(b2)
  check('the second browser reaches the panel', await hasText(b2, 'Save draft'))
  check('Back to draft is offered there', (await clickText(b2, 'Back to draft')) === 'ok')
  await sleep(1800)
  const recovered = await liveToken(b2, '--void')
  check('the saved draft comes back in a browser that never saw it',
    savedDraft.void ? recovered === savedDraft.void : recovered.length > 0,
    `--void ${recovered}, expected ${savedDraft.void}`)
  check('...and that browser reports the draft state',
    (await bannerState(b2)) === 'Draft saved', await bannerState(b2))

  /*
    ── Sign the first browser back in ────────────────────────────────────────────────────────────
    The development sign-in route issues ONE marked session and sweeps the others, so signing the
    second browser in has just signed the first one out. Nothing in the panel did that, but every
    action from here on would refuse, and the suite would report a broken publish button rather than
    an expired cookie -- which is precisely the wrong bug to go looking for.

    The second browser is finished with, so it is closed first and its session released.
  */
  await b2.close()
  b2 = null
  await openPalette(b)
  check('the first browser is signed in again and back on its draft',
    (await bannerState(b)) === 'Draft saved', await bannerState(b))

  // ══ 4. Publishing asks first ══════════════════════════════════════════════════════════════════
  section('Publishing takes an explicit confirmation')
  check('the publish control opens a confirmation',
    (await clickText(b, 'Publish site-wide')) === 'ok')
  await sleep(700)
  check('a confirmation dialog appears', Boolean(await b.eval(
    `!!document.querySelector('[role="alertdialog"]')`,
  )))
  check('...naming the consequence rather than asking if you are sure',
    await hasText(b, 'Publish to everyone?'))
  const declined = await publishedPalette()
  check('nothing is published while it is open', declined.revision === beforePreset.revision)

  check('declining is offered', (await clickIn(b, '[role="alertdialog"]', 'Keep it private')) === 'ok')
  await sleep(1200)
  check('the dialog closes', !(await b.eval(`!!document.querySelector('[role="alertdialog"]')`)))
  const afterDecline = await publishedPalette()
  check('and declining published nothing', afterDecline.revision === beforePreset.revision,
    `${beforePreset.revision} -> ${afterDecline.revision}`)

  // ══ 5. Confirming publishes, and a visitor sees it ════════════════════════════════════════════
  section('Confirming publishes to everyone')
  check('the publish control reopens the confirmation',
    (await clickText(b, 'Publish site-wide')) === 'ok')
  await sleep(900)
  check('the confirming button says what it does, not "OK"',
    (await clickIn(b, '[role="alertdialog"]', 'Publish site-wide')) === 'ok')
  await sleep(5000)

  const published = await publishedPalette()
  check('a new revision exists', published.revision !== beforePreset.revision,
    `${beforePreset.revision} -> ${published.revision}`)
  check('it carries the palette that was drafted',
    samePalette(published.palette, savedDraft),
    `${Object.keys(published.palette).length} vs ${Object.keys(savedDraft).length} tokens`)
  check('the banner now reads published site-wide',
    (await bannerState(b)) === 'Published site-wide', await bannerState(b))

  const visitorAfter = await publicHtml()
  const block = /<style data-published-theme[^>]*>([\s\S]*?)<\/style>/.exec(visitorAfter)?.[1] ?? ''
  check('a signed-out visitor is served a theme block', block.length > 0)
  check('...containing the published colour, so the cache was invalidated',
    savedDraft.void ? block.includes(savedDraft.void) : block.length > 0,
    `looking for ${savedDraft.void} in ${block.slice(0, 120)}`)
  check('...in the head, before any script runs',
    visitorAfter.indexOf('data-published-theme') < visitorAfter.indexOf('</head>'))

  // ══ 6. Reverting ══════════════════════════════════════════════════════════════════════════════
  section('The two reverts and the reset')
  /*
    Reset runs FIRST, on purpose.

    Straight after publishing, the preview already IS the published theme, so "Back to published"
    is correctly disabled and there is nothing for it to prove. Resetting moves the preview off the
    published palette, which is what makes the revert meaningful -- and it is also the state in
    which the two controls have to be shown to be different from each other.
  */
  const graphiteVoid = THEME_TOKEN_REGISTRY.find((t) => t.key === 'void')!.fallback
  check('Reset to graphite is offered', (await clickText(b, 'Reset to graphite')) === 'ok')
  await sleep(1800)
  const afterReset = await liveToken(b, '--void')
  check('...and shows the built-in ground, not the published one',
    afterReset === graphiteVoid, `--void is ${afterReset}, built-in is ${graphiteVoid}`)
  check('...which is genuinely different from what is published',
    savedDraft.void != null && afterReset !== savedDraft.void,
    `published --void is ${savedDraft.void}`)
  check('...without publishing the reset',
    (await publishedPalette()).revision === published.revision)

  check('Back to published is offered once the preview has moved',
    (await clickText(b, 'Back to published')) === 'ok')
  await sleep(1500)
  check('...and lands back on the published state',
    (await bannerState(b)) === 'Published site-wide', await bannerState(b))
  check('...restoring the published ground',
    savedDraft.void ? (await liveToken(b, '--void')) === savedDraft.void : true,
    `--void is ${await liveToken(b, '--void')}`)

  // ══ 7. History and rollback ═══════════════════════════════════════════════════════════════════
  section('Revision history and rolling back')
  check('Revision history is offered', (await clickText(b, 'Revision history')) === 'ok')
  await sleep(4000)
  /*
    Scoped to the list, because the banner also says "Live: revision 8" and the text search is
    case-insensitive -- an unscoped match would pass on the banner alone and report a history that
    never rendered. Read through textContent rather than innerText, which is layout-dependent and
    comes back empty for a row that has not been painted. The backslash is doubled because this is
    a template literal: written once, the browser receives /^Revision d+/ and nothing ever matches.
  */
  const listed = Number(await b.eval(`(function () {
    return Array.from(document.querySelectorAll('li')).filter(function (e) {
      return /^Revision \\d+/.test((e.textContent || '').trim());
    }).length;
  })()`))
  check('the history lists published revisions', listed > 0, `${listed} row(s)`)
  const rows = Number(await b.eval(`(function () {
    return Array.from(document.querySelectorAll('button')).filter(function (e) {
      return (e.textContent || '').trim().indexOf('Roll back') === 0;
    }).length;
  })()`))
  check('earlier revisions are offered for rollback', rows > 0, `${rows} rollback control(s)`)

  if (rows > 0) {
    /*
      Target the revision this run started on, by number.

      "The first Roll back button" is whatever happens to sit at the top of the list, which on a
      machine that has run this suite before is another copy of the same palette -- and rolling a
      palette back onto itself proves nothing while looking like a pass.
    */
    const rolledInto = start.revision
    check('rolling back to the revision this run started on is offered',
      (await b.eval(`(function () {
        var want = 'Revision ' + ${JSON.stringify(String(rolledInto))};
        var row = Array.from(document.querySelectorAll('li')).filter(function (e) {
          return (e.textContent || '').trim().indexOf(want) === 0;
        })[0];
        if (!row) return 'no-row';
        var el = Array.from(row.querySelectorAll('button')).filter(function (e) {
          return (e.textContent || '').trim().indexOf('Roll back') === 0;
        })[0];
        if (!el) return 'not-found';
        if (el.disabled) return 'disabled';
        el.click();
        return 'ok';
      })()`)) === 'ok', `revision ${rolledInto}`)
    await sleep(4000)
    const rolled = await publishedPalette()
    check('rollback publishes forward rather than deleting',
      rolled.revision != null && published.revision != null
      && rolled.revision > published.revision,
      `${published.revision} -> ${rolled.revision}`)
    /*
      Read the published block rather than the whole page: #000000 is also a static theme-color meta
      tag, so "the colour is absent from the HTML" can never be true for it.
    */
    const rolledBlock = publishedBlock(await publicHtml())
    check('and a visitor stops being served the rolled-back palette',
      savedDraft.void ? !rolledBlock.includes(savedDraft.void) : true,
      `block still reads ${rolledBlock.slice(0, 100)}`)
  }
} finally {
  /*
    ── Leave the theme exactly as it was found, and PROVE it ─────────────────────────────────────
    Publishing here really publishes, so a restore that quietly fails leaves the development site
    wearing a test palette and every later run of this suite starting from it -- which is how a
    "restore to what I found" step turns into permanent drift. The restore is therefore verified
    rather than attempted, and a failure to restore fails the suite.
  */
  try {
    const draft = await getDraft(THEME_PAGE_KEY)
    if (draft) {
      const doc = structuredClone(draft.document) as unknown as Doc
      const mod = themeModule(doc)
      if (mod) {
        for (const k of Object.keys(normaliseTokens(mod.config))) mod.config[k] = ''
        for (const [k, v] of Object.entries(start.palette)) mod.config[k] = v
      }
      const s = await saveDraft(THEME_PAGE_KEY, doc as never, draft.version, ACTOR)
      if (s.issues !== 0) throw new Error(`the restoring draft did not validate (${s.issues} issue(s))`)
      await publish(THEME_PAGE_KEY, ACTOR, 'Restore the theme after verification')
    }
    section('The site is left as it was found')
    const restored = await publishedPalette()
    check('the published palette is back to the one this run started with',
      samePalette(restored.palette, start.palette),
      `started ${JSON.stringify(start.palette).slice(0, 80)}, now ${JSON.stringify(restored.palette).slice(0, 80)}`)
    check('and the saved draft matches it',
      samePalette(await draftPalette(), start.palette))
  } catch (err) {
    check('the theme was restored', false, (err as Error).message)
  }
  if (b2) await b2.close()
  await b.close()
  await prisma.$disconnect()
}

console.log(`\n${'═'.repeat(74)}`)
if (fail) {
  console.log(`\n${fail} FAILED:\n`)
  for (const f of failures) console.log(`  x ${f}`)
}
console.log(`\n${pass} checks passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
