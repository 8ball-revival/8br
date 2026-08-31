/**
 * Personal preview, saved draft, published theme — and the walls between them.
 *
 * ── What this is really testing ─────────────────────────────────────────────────────────────────
 * That three promises hold. Dragging a colour changes nothing for anybody else. Saving changes
 * nothing for anybody else. Publishing changes it for everybody, on first paint, and can be undone.
 *
 * Each of those is checked by looking at what a DIFFERENT browser is served, because "the Owner sees
 * their draft" and "a visitor does not" are two facts and only the second one matters legally,
 * reputationally and to the person who visits the site.
 *
 * ── It leaves the site as it found it ───────────────────────────────────────────────────────────
 * Publishing here really publishes. The run records the revision it started on and rolls back to it
 * at the end, so a verification run is not an edit somebody has to notice and undo.
 *
 * Run: npm run test:theme:publish (with the dev server up)
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

const KEY = '8br-display-v1'
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
const { getDraft, saveDraft, publish, rollback } = await import('../src/lib/site-builder/service')
const { THEME_PAGE_KEY } = await import('../src/lib/site-builder/globals')
const { normaliseTokens } = await import('../src/lib/theme/presets')
const { verdictFor } = await import('../src/lib/theme/contrast')
const { THEME_PRESETS } = await import('../src/lib/theme/presets')

const ACTOR = { userId: 0, username: 'theme-publish-verification' }
type Doc = { sections: { modules: { type: string; config: Record<string, unknown>; children?: unknown[] }[] }[] }

const themeModule = (doc: Doc) => {
  const walk = (m: { type: string; config: Record<string, unknown>; children?: unknown[] }[]): typeof m =>
    m.flatMap((x) => [x, ...walk((x.children ?? []) as never)])
  return walk(doc.sections.flatMap((s) => s.modules)).find((m) => m.type === 'global.theme')
}

/** Write a palette into the theme page's draft the way the action does. */
const writeDraft = async (tokens: Record<string, string>) => {
  const draft = await getDraft(THEME_PAGE_KEY)
  if (!draft) throw new Error('the theme page is not bootstrapped')
  const next = structuredClone(draft.document) as unknown as Doc
  const mod = themeModule(next)
  if (!mod) throw new Error('no theme module')
  const clean = normaliseTokens(tokens)
  for (const k of Object.keys(normaliseTokens(mod.config))) if (!(k in clean)) mod.config[k] = ''
  for (const [k, v] of Object.entries(clean)) mod.config[k] = v
  return saveDraft(THEME_PAGE_KEY, next as never, draft.version, ACTOR)
}

/** What the server sends a signed-out visitor, read as raw HTML rather than from a rendered page. */
const publicHtml = async (path = '/') => {
  const res = await fetch(`${BASE}${path}?cb=${Math.random().toString(36).slice(2)}`, {
    headers: { 'Cache-Control': 'no-cache' },
  })
  return res.text()
}
const publishedBlockOf = (html: string) => {
  const m = /<style data-published-theme[^>]*>([\s\S]*?)<\/style>/.exec(html)
  return m ? m[1] : null
}

const startPage = await prisma.sitePage.findUnique({
  where: { key: THEME_PAGE_KEY },
  include: { publishedRevision: true },
})
const startRevision = startPage?.publishedRevision?.number ?? null

const b = await launch()
try {
  section('The theme page is the storage, and it already exists')
  check('a GLOBAL theme page is bootstrapped', startPage != null)
  check('...with a published revision', startRevision != null, String(startRevision))
  const startDoc = startPage?.publishedRevision?.document as unknown as Doc | undefined
  const startPalette = startDoc ? normaliseTokens(themeModule(startDoc)?.config ?? {}) : {}
  check('...whose palette is the built-in graphite (nothing overridden)',
    Object.keys(startPalette).length === 0, JSON.stringify(startPalette))

  const before = await publicHtml()
  check('so a visitor is served no theme block at all', publishedBlockOf(before) === null,
    String(publishedBlockOf(before)))

  // ══ 1. Personal preview ═══════════════════════════════════════════════════════════════════════
  section('Personal preview stays in one browser')
  await b.viewport(1440, 900, false)
  await b.goto('/', 14000)
  await b.eval(`(function () {
    var raw = {}; try { raw = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}) || '{}') } catch (e) {}
    raw.tokens = { void: '#120018' };
    localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify(raw));
    return true;
  })()`)
  await b.goto('/', 14000); await sleep(1200)
  const previewed = await b.eval(`getComputedStyle(document.documentElement).getPropertyValue('--void').trim()`)
  check('the previewing browser sees it', previewed === '#120018', String(previewed))

  const strangerDuringPreview = await publicHtml()
  check('a visitor is served nothing of it',
    !strangerDuringPreview.includes('#120018'), 'the preview colour reached the public HTML')

  // ══ 2. Saved draft ════════════════════════════════════════════════════════════════════════════
  section('A saved draft is durable, and still private')
  const saved = await writeDraft({ void: '#0a1f14', graphite: '#10301f' })
  check('the draft saves cleanly', saved.issues === 0, `${saved.issues} issue(s)`)

  const reread = await getDraft(THEME_PAGE_KEY)
  const draftPalette = normaliseTokens(themeModule(reread!.document as unknown as Doc)?.config ?? {})
  check('and survives being re-read from the database',
    draftPalette.void === '#0a1f14' && draftPalette.graphite === '#10301f', JSON.stringify(draftPalette))

  const strangerDuringDraft = await publicHtml()
  check('a visitor still sees the published theme, not the draft',
    !strangerDuringDraft.includes('#0a1f14'), 'the draft reached the public HTML')
  check('...and still no theme block', publishedBlockOf(strangerDuringDraft) === null)

  // ══ 3. Publish ════════════════════════════════════════════════════════════════════════════════
  section('Publishing reaches everybody, on first paint')
  const published = await publish(THEME_PAGE_KEY, ACTOR, 'Verification palette')
  check('publishing creates a revision', published.revisionNumber > (startRevision ?? 0),
    `revision ${published.revisionNumber}`)

  const strangerAfter = await publicHtml()
  const block = publishedBlockOf(strangerAfter)
  check('a visitor is now served a theme block', block != null)
  check('...containing the published value', block?.includes('#0a1f14') === true, String(block))
  check('...as a :root rule, so a preview can still layer over it',
    block?.startsWith(':root{') === true, String(block).slice(0, 40))
  check('...in the document head, before any script runs',
    strangerAfter.indexOf('data-published-theme') < strangerAfter.indexOf('</head>'))

  /*
    The layering, checked in a browser rather than argued from specificity.

    The previewing browser still has `--void: #120018` in localStorage from step 1. If the published
    rule beat it, the Owner's preview would have silently stopped working the moment anything was
    published — which is exactly the bug this arrangement was built to prevent.
  */
  await b.goto('/', 14000); await sleep(1200)
  const layered = await b.eval(`getComputedStyle(document.documentElement).getPropertyValue('--void').trim()`)
  check('the Owner preview still wins over the published theme', layered === '#120018', String(layered))

  // A clean browser, which is what a visitor is.
  await b.eval(`localStorage.removeItem(${JSON.stringify(KEY)}); true`)
  await b.goto('/', 14000); await sleep(1200)
  const asVisitor = await b.eval(`getComputedStyle(document.documentElement).getPropertyValue('--void').trim()`)
  check('a browser with nothing stored gets the published theme', asVisitor === '#0a1f14', String(asVisitor))

  const hydration = typeof b.consoleErrors === 'function'
    ? (b.consoleErrors() as string[]).filter((e) => /hydrat|did not match|Text content/i.test(e))
    : []
  check('no hydration mismatch from the theme block', hydration.length === 0,
    JSON.stringify(hydration).slice(0, 240))

  // ══ 4. Rollback ═══════════════════════════════════════════════════════════════════════════════
  section('Rollback restores an earlier revision publicly')
  if (startRevision != null) {
    const rolled = await rollback(THEME_PAGE_KEY, startRevision, ACTOR)
    check('rolling back publishes forward rather than deleting',
      rolled.revisionNumber > published.revisionNumber, `revision ${rolled.revisionNumber}`)
    const afterRollback = await publicHtml()
    check('a visitor stops being served the rolled-back palette',
      !afterRollback.includes('#0a1f14'), 'the old palette is still being served')
    const kept = await prisma.sitePageRevision.findFirst({
      where: { page: { key: THEME_PAGE_KEY }, number: published.revisionNumber },
    })
    check('and the revision that was rolled back is kept', kept != null)
  }

  // ══ 5. Validation and the contrast gate ═══════════════════════════════════════════════════════
  section('What cannot be stored, and what cannot be published')
  const dirty = normaliseTokens({
    void: 'red;background:url(//x)',
    graphite: 'var(--anything)',
    signal: 'rgb(255,0,0)',
    notAToken: '#000000',
    cleanWhite: '#FFF',
  })
  check('a declaration-breaking value never becomes a token', dirty.void === undefined)
  check('nor does a var() reference', dirty.graphite === undefined)
  check('nor an rgb() function', dirty.signal === undefined)
  check('nor an unknown key', (dirty as Record<string, string>).notAToken === undefined)
  check('a real hex survives, lower-cased', dirty.cleanWhite === '#fff')

  // Black on black: the gate must refuse it whatever the interface offered.
  const unreadable = verdictFor({ void: '#000000', cleanWhite: '#010101', graphite: '#000000' })
  check('a palette that hides essential text is not publishable', !unreadable.publishable,
    `${unreadable.blocking.length} blocking`)
  check('...and the refusal names what broke', unreadable.blocking.length > 0
    && unreadable.blocking[0].where.length > 0, JSON.stringify(unreadable.blocking[0]?.where))

  section('Every preset is publishable')
  for (const preset of THEME_PRESETS) {
    const v = verdictFor(preset.values)
    check(`${preset.name}`, v.publishable, v.blocking.map((x) => x.where).join(', '))
  }

  // ══ 6. Concurrency ════════════════════════════════════════════════════════════════════════════
  section('Two tabs cannot silently overwrite each other')
  const current = await getDraft(THEME_PAGE_KEY)
  const staleVersion = current!.version - 1
  let conflicted = false
  try {
    const doc = structuredClone(current!.document) as unknown as Doc
    themeModule(doc)!.config.void = '#111111'
    await saveDraft(THEME_PAGE_KEY, doc as never, staleVersion, ACTOR)
  } catch (err) {
    conflicted = (err as Error).constructor.name === 'ConflictError'
      || /changed|conflict/i.test((err as Error).message)
  }
  check('a stale version is refused rather than merged', conflicted)

  // ══ 7. A theme stored before a token existed ══════════════════════════════════════════════════
  section('An older theme resolves through safe defaults')
  const partial = normaliseTokens({ void: '#101014' })
  const v2 = verdictFor(partial)
  check('a palette naming one token still resolves the other 48', v2.results.length > 40,
    String(v2.results.length))
  check('...and is still judged publishable on its merits', v2.publishable,
    v2.blocking.map((x) => x.where).join(', '))
} finally {
  // ── Leave the theme exactly as it was found ─────────────────────────────────────────────────
  try {
    const draft = await getDraft(THEME_PAGE_KEY)
    if (draft) {
      const doc = structuredClone(draft.document) as unknown as Doc
      const mod = themeModule(doc)
      if (mod) for (const k of Object.keys(normaliseTokens(mod.config))) mod.config[k] = ''
      const s = await saveDraft(THEME_PAGE_KEY, doc as never, draft.version, ACTOR)
      if (s.issues === 0) await publish(THEME_PAGE_KEY, ACTOR, 'Restore the built-in graphite theme')
    }
  } catch (err) {
    console.error('  ! could not restore the theme:', (err as Error).message)
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
process.exit(fail ? 1 : 0)
