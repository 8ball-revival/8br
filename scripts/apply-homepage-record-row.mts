/**
 * Publish the approved homepage row onto a site that was bootstrapped before it existed.
 *
 * ── Why a script and not a bootstrap change alone ───────────────────────────────────────────────
 * `bootstrap` is idempotent by refusing to touch a page that already exists, which is exactly the
 * property that protects an Owner's edits — and exactly why changing the factory layout does nothing
 * to a site already running. The factory change is for the next site; this is for the one in front
 * of you.
 *
 * ── It goes through the ordinary lifecycle ──────────────────────────────────────────────────────
 * Read the draft, edit it, `saveDraft` (which validates), `publish` (which validates again, freezes
 * a revision, and writes an audit entry). No direct row surgery: this leaves exactly the history an
 * Owner making the same change by hand would leave, and it can be rolled back from the interface
 * like any other publish.
 *
 * ── What it will not do ─────────────────────────────────────────────────────────────────────────
 * It refuses a non-local database, and it is a no-op when the row is already in place — so running
 * it twice is safe and running it against the wrong thing is not possible.
 *
 * ── One thing it cannot do ──────────────────────────────────────────────────────────────────────
 * Clear a RUNNING server's cache. `revalidateTag` only works inside a request, so an Owner
 * publishing from the interface invalidates the page immediately, and this script — publishing from
 * its own process — cannot. The database is correct either way; a dev server started before the
 * publish keeps serving the previous layout until it is restarted with `.next` removed.
 *
 * Run: npm run apply:homepage-record
 */

import { readFileSync } from 'node:fs'

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
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error(`\nRefusing to run against "${host || '(unparseable)'}". This publishes; it is for a local copy.\n`)
  process.exit(1)
}

const APPLY = process.argv.includes('--apply')

const { prisma } = await import('../src/lib/prisma')
const { getDraft, saveDraft, publish } = await import('../src/lib/site-builder/service')
const { factoryDocument } = await import('../src/lib/site-builder/factory')
const { findPlayerIdByCueverseId } = await import('../src/lib/home/record-holder')
await import('../src/components/site-builder/modules')

const actor = { userId: 0, username: 'homepage-record-row' }
const KEY = '/'

const draft = await getDraft(KEY)
if (!draft) {
  console.error('\nThe homepage has not been bootstrapped, so there is nothing to edit.\n')
  process.exit(1)
}

const already = draft.document.sections.some((s) => s.modules.some((m) => m.type === 'competitions.recordFeature'))
if (already && !process.argv.includes('--replace')) {
  console.log('')
  console.log('  The record row is already on the homepage. Nothing to do.')
  console.log('  Pass --replace to put the approved row back over whatever is there now.')
  console.log('')
  await prisma.$disconnect()
  process.exit(0)
}

/*
  The new row is taken from the FACTORY rather than written out again here.

  Two descriptions of one layout drift, and the one in the factory is the one every future site gets.
  Lifting it means this script cannot disagree with it.
*/
const factory = factoryDocument(KEY)
const newRow = factory.sections.find((s) => s.id === 'home-record')
if (!newRow) {
  console.error('\nThe factory homepage no longer has a `home-record` row. Nothing was changed.\n')
  process.exit(1)
}

// The canonical player, so the panel follows their identity rather than a typed copy of it.
const holderId = await findPlayerIdByCueverseId('sixohtwo')
const row = structuredClone(newRow)
for (const m of row.modules) {
  if (m.type === 'competitions.recordFeature' && holderId) m.config.holderPlayerId = holderId
}

const next = structuredClone(draft.document)

/*
  Replace the row the approved change replaces, and leave everything else exactly alone.

  Matched by what the old row CONTAINS rather than by its position: a homepage somebody has already
  reordered must not have its third section overwritten regardless of what is in it.
*/
const oldIndex = next.sections.findIndex((s) => s.modules.some(
  (m) => m.type === 'editorial.breakFeature' || m.type === 'competitions.recordFeature',
))
if (oldIndex === -1) {
  console.error('\nCould not find the row to replace. Nothing was changed.\n')
  process.exit(1)
}
next.sections.splice(oldIndex, 1, row)

// And the achievements section moves to the dark ground.
let achievementsChanged = false
for (const section of next.sections) {
  for (const m of section.modules) {
    if (m.type === 'rankings.achievements' && m.config.surface !== 'dark') {
      m.config.surface = 'dark'
      achievementsChanged = true
    }
  }
}

console.log(`\n  homepage:        ${draft.document.sections.length} rows`)
console.log(`  replacing row:   ${oldIndex + 1} (${draft.document.sections[oldIndex].name})`)
console.log(`  with:            ${row.name} — ${row.modules.map((m) => m.type).join(', ')}`)
console.log(`  record holder:   ${holderId ? `player ${holderId}` : 'no player found; the fallback text will render'}`)
console.log(`  achievements:    ${achievementsChanged ? 'moved to the dark section' : 'already dark'}`)

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

const published = await publish(KEY, actor, 'Record feature, editorial column, and the dark achievements section')
console.log(`  published as revision ${published.revisionNumber}`)

const live = await getDraft(KEY)
const ok = live?.document.sections.some((s) => s.modules.some((m) => m.type === 'competitions.recordFeature'))
console.log(ok ? '\n  The record row is live.\n' : '\n  Something went wrong: the row is not there.\n')

await prisma.$disconnect()
process.exit(ok ? 0 : 1)
