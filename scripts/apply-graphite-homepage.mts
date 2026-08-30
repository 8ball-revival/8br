/**
 * Publish the approved graphite homepage onto a site that was bootstrapped before it existed.
 *
 * ── Why a script and not a factory change alone ─────────────────────────────────────────────────
 * `bootstrap` is idempotent by refusing to touch a page that already exists, which is exactly the
 * property that protects an Owner's edits — and exactly why changing the factory layout does nothing
 * to a site already running. The factory change is for the next site; this is for the one in front
 * of you.
 *
 * ── It goes through the ordinary lifecycle ──────────────────────────────────────────────────────
 * Read the draft, replace the homepage sections, `saveDraft` (which validates), `publish` (which
 * validates again, freezes a revision, and writes an audit entry). No direct row surgery: this
 * leaves exactly the history an Owner making the same change by hand would leave, and it can be
 * rolled back from the interface like any other publish.
 *
 * ── What it will not do ─────────────────────────────────────────────────────────────────────────
 * Run against a non-local database. Touch any table other than the builder's own. Invent an asset —
 * every file the layout references is checked on disk first, and a missing one stops the run before
 * anything is written.
 *
 * ── One thing it cannot do ──────────────────────────────────────────────────────────────────────
 * Clear a RUNNING server's cache. `revalidateTag` only works inside a request, so an Owner
 * publishing from the interface invalidates the page immediately, and this script — publishing from
 * its own process — cannot. The database is correct either way; a dev server started before the
 * publish keeps serving the previous layout until it is restarted with `.next` removed.
 *
 * Run: npm run apply:graphite-homepage -- --apply
 */

import { readFileSync, existsSync } from 'node:fs'

function envFile(file: string): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    for (const raw of readFileSync(file, 'utf8').split(String.fromCharCode(10))) {
      const line = raw.trim()
      const eq = line.indexOf('=')
      if (eq < 1 || line.startsWith('#')) continue
      const key = line.slice(0, eq).trim()
      if (!/^[A-Z0-9_]+$/.test(key)) continue
      let value = line.slice(eq + 1).trim()
      if (value.length > 1 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
        value = value.slice(1, -1)
      }
      out[key] = value
    }
  } catch { /* no such file */ }
  return out
}

const env = envFile('.env.replica')
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL ?? ''
if (!process.env.DIRECT_URL) process.env.DIRECT_URL = env.DIRECT_URL ?? process.env.DATABASE_URL ?? ''

const url = process.env.DATABASE_URL ?? ''
const host = (() => { try { return new URL(url).hostname } catch { return '' } })()
const database = (() => { try { return new URL(url).pathname.slice(1) } catch { return '' } })()
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error(`\nRefusing to run against "${host || '(unparseable)'}". This publishes; it is for a local copy.\n`)
  process.exit(1)
}

const APPLY = process.argv.includes('--apply')

/*
  Every asset the layout points at, checked before anything is written.

  A missing image is a 404 the page does not report: the layout validates, the render succeeds, and
  the result is a blank rectangle nobody notices until it is in front of somebody. Cheaper to fail
  here.
*/
const REQUIRED_ASSETS = [
  'public/assets/homepage/homepage-champion-sixohtwo-desktop.webp',
  'public/assets/homepage/homepage-champion-sixohtwo-mobile.webp',
  'public/assets/homepage/homepage-8brcam-camera.webp',
  'public/assets/homepage/table-clear-58-7-poster.webp',
  'public/assets/homepage/article-mlp-tribute.webp',
  'public/assets/homepage/article-cueverse-top-10.webp',
  'public/assets/homepage/article-kevin-vs-travis.webp',
  'public/assets/branding/wcc-logo.png',
]
const missing = REQUIRED_ASSETS.filter((f) => !existsSync(f))
if (missing.length) {
  console.error('\nThese files are referenced by the layout and are not on disk:\n')
  for (const f of missing) console.error(`  ${f}`)
  console.error('\nNothing was changed. Install the asset package first.\n')
  process.exit(1)
}

const { prisma } = await import('../src/lib/prisma')
const { getDraft, saveDraft, publish } = await import('../src/lib/site-builder/service')
const { factoryDocument } = await import('../src/lib/site-builder/factory')
await import('../src/components/site-builder/modules')

const actor = { userId: 0, username: 'graphite-homepage' }
const KEY = '/'

const draft = await getDraft(KEY)
if (!draft) {
  console.error('\nThe homepage has not been bootstrapped, so there is nothing to edit.\n')
  process.exit(1)
}

const factory = factoryDocument(KEY)
const already = JSON.stringify(draft.document.sections) === JSON.stringify(factory.sections)
if (already && !process.argv.includes('--force')) {
  console.log('')
  console.log('  The homepage already matches the approved layout. Nothing to do.')
  console.log('  Pass --force to publish it again anyway.')
  console.log('')
  await prisma.$disconnect()
  process.exit(0)
}

/*
  The whole homepage is replaced, and that is the honest description of this change.

  The earlier record-row script spliced one row and left the rest alone, because that was a one-row
  change. This is a different page: every row is new or rebuilt, the columns have moved, and three
  of the old modules no longer exist. Splicing would produce a hybrid nobody designed. Anything an
  Owner had customised on the old homepage is superseded — which is why the previous revision is
  frozen and one click away in the builder's history.
*/
const next = structuredClone(draft.document)
const before = next.sections.map((s) => `${s.id}[${s.modules.map((m) => m.type).join('+')}]`)
next.sections = structuredClone(factory.sections)

console.log(`\n  database:        ${database}`)
console.log(`  replacing:       ${before.length} row(s)`)
for (const row of before) console.log(`                   - ${row}`)
console.log(`  with:            ${next.sections.length} row(s)`)
for (const s of next.sections) {
  const types = s.modules.map((m) => {
    const kids = (m.children ?? []).map((c) => c.type).join(' + ')
    return kids ? `${m.type}(${kids})` : m.type
  }).join(' | ')
  console.log(`                   + ${s.id}: ${types}`)
}

if (!APPLY) {
  console.log('\n  Nothing was changed. Re-run with --apply to save and publish.\n')
  await prisma.$disconnect()
  process.exit(0)
}

// The ordinary lifecycle: save (validates), then publish (validates again, freezes, audits).
const saved = await saveDraft(KEY, next, draft.version, actor)
console.log(`\n  draft saved as version ${saved.version}${saved.issues ? ` with ${saved.issues} issue(s)` : ''}`)
if (saved.issues > 0) {
  console.error('  The draft did not validate cleanly. It has NOT been published.')
  await prisma.$disconnect()
  process.exit(1)
}

const published = await publish(KEY, actor, 'Graphite-black homepage: champion hero, ranking rail, plaques')
console.log(`  published as revision ${published.revisionNumber}`)

const live = await getDraft(KEY)
const ok = live?.document.sections.some((s) => s.modules.some((m) => m.type === 'home.championHero'))
console.log(ok ? '\n  The graphite homepage is live.\n' : '\n  Something went wrong: the hero is not there.\n')

await prisma.$disconnect()
process.exit(ok ? 0 : 1)
