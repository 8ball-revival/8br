/**
 * The picker as an Owner actually uses it.
 *
 * ── What only a browser can prove ───────────────────────────────────────────────────────────────
 * `test:player-picker` proves the search, the validator and the lifecycle. None of that says the
 * editor stopped showing a cuid, that a keyboard reaches the list, or that typing a name into the
 * search box cannot become the stored value — which was the whole complaint. So every assertion
 * here starts at the control and ends at the document the editor is holding.
 *
 * It restores the module to whatever it found, and proves it did.
 *
 * Run: npm run test:player-picker:ui (with the dev server up)
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
const { getDraft, saveDraft } = await import('../src/lib/site-builder/service')
const { resolvePlayer } = await import('../src/lib/players/picker-search')

const HOME = '/'
const MODULE = 'competitions.recordFeature'
const ACTOR = { userId: 0, username: 'player-picker-ui-verification' }

type Mod = { id: string; type: string; config: Record<string, unknown>; children?: Mod[] }
type Doc = { sections: { modules: Mod[] }[] }
const walk = (m: Mod[]): Mod[] => m.flatMap((x) => [x, ...walk(x.children ?? [])])
const recordModules = (d: Doc) => walk(d.sections.flatMap((s) => s.modules)).filter((m) => m.type === MODULE)

/** What the DRAFT holds right now — the editor autosaves, so this is where a click ends up. */
const storedHolder = async (): Promise<string> => {
  const d = await getDraft(HOME)
  return d ? String(recordModules(d.document as unknown as Doc)[0]?.config.holderPlayerId ?? '') : ''
}

const startHolders = (await getDraft(HOME))
  ? recordModules((await getDraft(HOME))!.document as unknown as Doc).map((m) => String(m.config.holderPlayerId ?? ''))
  : []
const startHolder = startHolders[0] ?? ''
const startPlayer = startHolder ? await resolvePlayer(startHolder) : null

// ── Driving the inspector ──────────────────────────────────────────────────────────────────────
const ASIDE = `[].slice.call(document.querySelectorAll('aside')).filter(function (a) {
  return /Settings/i.test(a.getAttribute('aria-label') || '');
})[0]`

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

const inspectorText = `(function () { var a = ${ASIDE}; return a ? (a.innerText || '') : ''; })()`

/** Click a button inside the inspector by the text it shows. */
const clickInInspector = (text: string) => `(function () {
  var a = ${ASIDE};
  if (!a) return 'no-inspector';
  var el = [].slice.call(a.querySelectorAll('button')).filter(function (b) {
    return (b.textContent || '').trim().indexOf(${JSON.stringify(text)}) === 0;
  })[0];
  if (!el) return 'not-found';
  if (el.disabled) return 'disabled';
  el.click();
  return 'ok';
})()`

const typeInSearch = (term: string) => `(function () {
  var a = ${ASIDE};
  if (!a) return 'no-inspector';
  var input = a.querySelector('input[role="combobox"]');
  if (!input) return 'no-search-box';
  var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, ${JSON.stringify(term)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
  return 'ok';
})()`

const optionTexts = `(function () {
  var a = ${ASIDE};
  if (!a) return [];
  return [].slice.call(a.querySelectorAll('[role="option"]')).map(function (o) {
    return (o.textContent || '').trim().slice(0, 70) + (o.getAttribute('aria-selected') === 'true' ? '  <=' : '');
  });
})()`

const b = await launch()
try {
  section('The inspector shows a player, not a cuid')
  await b.viewport(1500, 1100, false)
  await b.signInAsOwner()
  await b.goto('/?edit=1', 16000)

  const sel = await b.eval(selectModule(MODULE)) as { ok: boolean; why?: string }
  check('the record feature can be selected on the canvas', sel.ok === true, sel.why)
  await sleep(2500)

  const text = String(await b.eval(inspectorText))
  check('the inspector opened', text.length > 0)
  if (startPlayer) {
    check(`it names the linked player (${startPlayer.name})`, text.includes(startPlayer.name),
      text.slice(0, 160))
    check('...rather than the raw id', !text.includes(startHolder),
      'the cuid is visible in the panel without being asked for')
  }
  check('it explains that the fallbacks are ignored while a player is linked',
    /ignored while a player is linked/i.test(text))

  // ══ The stored id is available, but only on request ═══════════════════════════════════════════
  section('The id is behind a disclosure, not in your face')
  check('a control offers it', (await b.eval(clickInInspector('Show stored id'))) === 'ok')
  await sleep(600)
  const revealed = String(await b.eval(inspectorText))
  check('...and reveals the stored id when asked', revealed.includes(startHolder), startHolder)
  check('...with a way to copy it', /copy/i.test(revealed))
  await b.eval(clickInInspector('Hide stored id'))
  await sleep(400)

  // ══ Searching ═════════════════════════════════════════════════════════════════════════════════
  section('Searching by name, by handle and by an old alias')
  /*
    Opened by its ROLE, not by its label.

    The trigger shows the linked player's name once one is chosen, so matching on "Search for a
    player" finds it only while the field is empty — which is the one state this test is not in.
    `aria-haspopup="listbox"` is what the control is, whatever it currently says.
  */
  /*
    The label is read BEFORE the trigger is clicked.

    Opening the search replaces the trigger with the search box, so it no longer exists to be
    inspected afterwards -- reading it second reports a control with no label rather than a control
    that is gone.
  */
  const triggerLabel = String(await b.eval(`(function () {
    var a = ${ASIDE};
    var btn = a && a.querySelector('button[aria-haspopup="listbox"]');
    return btn ? (btn.getAttribute('aria-label') || '') : '';
  })()`))
  check('the trigger says what it does and who is linked',
    startHolder
      ? /Change the linked player/i.test(triggerLabel)
      : /Choose a player/i.test(triggerLabel),
    triggerLabel || 'no aria-label on the trigger')

  const opened = await b.eval(`(function () {
    var a = ${ASIDE};
    if (!a) return 'no-inspector';
    var btn = a.querySelector('button[aria-haspopup="listbox"]');
    if (!btn) return 'no-trigger';
    btn.click();
    return 'ok';
  })()`)
  check('the picker opens from its trigger', opened === 'ok', String(opened))
  await sleep(600)
  check('a search box appears', Boolean(await b.eval(
    `(function(){var a=${ASIDE};return !!a.querySelector('input[role="combobox"]')})()`,
  )))

  check('one character is not searched', (await b.eval(typeInSearch('k'))) === 'ok')
  await sleep(900)
  check('...and it says so rather than listing everybody',
    /at least two characters/i.test(String(await b.eval(inspectorText))))

  await b.eval(typeInSearch('kevin'))
  await sleep(1800)
  const byName = await b.eval(optionTexts) as string[]
  check('searching a name lists results', byName.length > 0, JSON.stringify(byName.slice(0, 3)))
  check('...showing the CueVerse ID beside the name',
    byName.some((t) => /sixohtwo/i.test(t)), JSON.stringify(byName.slice(0, 3)))

  await b.eval(typeInSearch('po0lin'))
  await sleep(1800)
  const byAlias = await b.eval(optionTexts) as string[]
  check('searching an old handle finds the player who used it',
    byAlias.some((t) => /derrick/i.test(t)), JSON.stringify(byAlias.slice(0, 3)))
  check('...and says why they matched', byAlias.some((t) => /known as/i.test(t)),
    JSON.stringify(byAlias.slice(0, 2)))

  await b.eval(typeInSearch('zzzznobodyzzzz'))
  await sleep(1800)
  check('a term nobody matches says so',
    /no player matches/i.test(String(await b.eval(inspectorText))))
  check('...and offers nothing to click', (await b.eval(optionTexts) as string[]).length === 0)

  // ══ Keyboard ══════════════════════════════════════════════════════════════════════════════════
  section('Choosing with the keyboard alone')
  await b.eval(typeInSearch('kevin'))
  await sleep(1800)
  await b.eval(`(function(){var a=${ASIDE};var i=a.querySelector('input[role="combobox"]');if(i)i.focus();return !!i})()`)
  await b.key('ArrowDown')
  await b.key('ArrowUp')
  const highlighted = (await b.eval(optionTexts) as string[]).filter((t) => t.endsWith('<='))
  check('an option is highlighted for the keyboard', highlighted.length === 1,
    JSON.stringify(await b.eval(optionTexts)))

  await b.key('Enter')
  await sleep(2500)
  const afterEnter = await storedHolder()
  const chosen = await resolvePlayer(afterEnter)
  check('pressing Enter stores a player id', /^c[a-z0-9]{20,30}$/.test(afterEnter), afterEnter)
  check('...the one that was highlighted', chosen?.name === 'Kevin', String(chosen?.name))
  check('...and never the text that was typed', afterEnter !== 'kevin')

  const afterText = String(await b.eval(inspectorText))
  check('the panel now names the new player', /Kevin/.test(afterText))
  check('...and still shows no cuid unasked', !afterText.includes(afterEnter))

  // ══ Change and clear ══════════════════════════════════════════════════════════════════════════
  section('Changing and clearing')
  const cleared = await b.eval(`(function () {
    var a = ${ASIDE};
    var btn = a.querySelector('button[aria-label="Clear the selected player"]');
    if (!btn) return 'not-found';
    btn.click();
    return 'ok';
  })()`)
  check('a clear control is offered', cleared === 'ok')
  await sleep(2500)
  check('clearing empties the stored reference', (await storedHolder()) === '', await storedHolder())
  check('...and the panel invites a search again',
    /search for a player/i.test(String(await b.eval(inspectorText))))

  // ══ Mobile ════════════════════════════════════════════════════════════════════════════════════
  section('The control fits a narrow editor')
  await b.viewport(390, 780, true)
  await sleep(1200)
  const overflow = await b.eval(`(function () {
    var a = ${ASIDE};
    if (!a) return null;
    return { scroll: a.scrollWidth, client: a.clientWidth };
  })()`) as { scroll: number; client: number } | null
  if (overflow) {
    check('the inspector does not scroll sideways on a phone',
      overflow.scroll <= overflow.client + 2, `${overflow.scroll} > ${overflow.client}`)
  } else {
    console.log('  --   the inspector is not shown at this width, so there is nothing to overflow')
  }
  await b.viewport(1500, 1100, false)
} finally {
  // ── Put the module back, and prove it ─────────────────────────────────────────────────────────
  try {
    const d = await getDraft(HOME)
    if (d) {
      const doc = structuredClone(d.document) as unknown as Doc
      recordModules(doc).forEach((m, i) => { m.config.holderPlayerId = startHolders[i] ?? '' })
      const s = await saveDraft(HOME, doc as never, d.version, ACTOR)
      if (s.issues !== 0) throw new Error(`the restoring draft did not validate (${s.issues})`)
    }
    section('The module is left as it was found')
    const after = await getDraft(HOME)
    const afterHolders = recordModules(after!.document as unknown as Doc).map((m) => String(m.config.holderPlayerId ?? ''))
    check('the draft holds the player it started with',
      JSON.stringify(afterHolders) === JSON.stringify(startHolders),
      `${JSON.stringify(startHolders)} -> ${JSON.stringify(afterHolders)}`)
  } catch (err) {
    check('the module was restored', false, (err as Error).message)
  }
  await b.close()
  await prisma.$disconnect()
}

console.log(`\n${'═'.repeat(74)}`)
if (fail) {
  console.log(`\n${fail} FAILED:\n`)
  for (const f of failures) console.log(`  x ${f}`)
}
console.log(`\n${pass} checks passed, ${fail} failed\n`)
await new Promise((r) => { setTimeout(r, 250) })
process.exit(fail ? 1 : 0)
