/**
 * Capture the current site as the first published layout, and keep code-defined pages in step.
 *
 * ── Two modes ────────────────────────────────────────────────────────────────────────────────────
 * Plain, it CREATES pages that do not exist yet and leaves every existing one completely alone —
 * including its draft and its whole revision history. Safe to re-run, safe as a startup step.
 *
 * `--refresh` additionally republishes pages whose published layout is still exactly what the code
 * defined, so a change to a factory layout reaches pages nobody has customised. A page that HAS been
 * customised is never touched: it is listed and skipped, because the administrator's edit is the
 * more recent decision and overwriting it silently would be the single worst thing this script could
 * do. Use `--refresh --force <key>` to republish a customised page deliberately.
 *
 * Only `site_*` tables are written. No competition data is touched, which the database suite asserts
 * separately.
 */

import { prisma } from '../src/lib/prisma'
import { bootstrap, publish, readPublishedLayout } from '../src/lib/site-builder/service'
import { FACTORY_PAGES } from '../src/lib/site-builder/factory'
import { validateDocument } from '../src/lib/site-builder/document'
import '../src/components/site-builder/modules'

const args = process.argv.slice(2)
const REFRESH = args.includes('--refresh')
const FORCE = args.filter((a) => a !== '--refresh' && a !== '--force')
const FORCED = args.includes('--force')

const url = process.env.DATABASE_URL ?? ''
const dbName = url.split('/').pop()?.split('?')[0] ?? 'unknown'
console.log(`Database: ${dbName}${REFRESH ? '  (refresh mode)' : ''}\n`)

const actor = {
  userId: 0,
  // A bootstrap is a system act, not something a person did. Attributing it to an administrator
  // would be a small lie in the one table that exists to be trusted.
  username: 'site-builder-bootstrap',
}

const result = await bootstrap(actor)
if (result.created.length) {
  console.log(`Created ${result.created.length} page(s):`)
  for (const key of result.created) console.log(`  + ${key}`)
} else {
  console.log('No new pages to create.')
}

if (REFRESH) {
  console.log('\nChecking existing pages against the code-defined layouts…')
  const refreshed: string[] = []
  const customised: string[] = []
  const unchanged: string[] = []

  for (const factory of FACTORY_PAGES) {
    if (result.created.includes(factory.key)) continue
    const page = await prisma.sitePage.findUnique({ where: { key: factory.key } })
    if (!page) continue

    const live = await readPublishedLayout(factory.key)
    const wanted = validateDocument(factory.document()).value

    /*
      "Customised" means the published layout differs from what the code defines — and that comparison
      has to ignore ids, which are generated afresh every time a factory layout is built. Comparing
      raw JSON would report every page as customised and refuse to refresh anything.
    */
    const shape = (doc: typeof wanted) => JSON.stringify(doc.sections.map((s) => ({
      name: s.name,
      width: s.width,
      columns: s.columns,
      modules: s.modules.map((m) => ({ type: m.type, config: m.config })),
    })))

    if (shape(live.document) === shape(wanted)) {
      unchanged.push(factory.key)
      continue
    }

    /*
      "Has a person edited this?" is the question, and comparing against the current factory layout
      cannot answer it: a page bootstrapped from an EARLIER version of that layout differs from the
      current one for exactly the reason we want to republish it, so the comparison reported every
      page as customised and refreshed nothing.

      The honest signal is the revision history. A page whose revisions were all published by the
      bootstrap actor has never been touched by a human, whatever its layout looks like now.
    */
    const humanRevisions = await prisma.sitePageRevision.count({
      where: { pageId: page.id, publishedByUsername: { not: actor.username } },
    })
    const isCodeDefined = humanRevisions === 0

    if (!isCodeDefined && !FORCED && !FORCE.includes(factory.key)) {
      customised.push(factory.key)
      continue
    }

    const draft = await prisma.sitePageDraft.findUnique({ where: { pageId: page.id } })
    await prisma.sitePageDraft.upsert({
      where: { pageId: page.id },
      create: { pageId: page.id, document: wanted as never, dirty: true, lastEditorUsername: actor.username },
      update: { document: wanted as never, version: { increment: 1 }, dirty: true, lastEditorUsername: actor.username },
    })
    void draft
    const published = await publish(factory.key, actor, 'Updated to the current built-in layout')
    refreshed.push(`${factory.key} → revision ${published.revisionNumber}`)
  }

  if (refreshed.length) {
    console.log(`\nRepublished ${refreshed.length}:`)
    for (const line of refreshed) console.log(`  ↻ ${line}`)
  }
  if (unchanged.length) console.log(`\nAlready current: ${unchanged.join(', ')}`)
  if (customised.length) {
    console.log(`\nLeft alone because they have been edited (pass --force to override):`)
    for (const key of customised) console.log(`  · ${key}`)
  }
}

const pages = await prisma.sitePage.count()
const revisions = await prisma.sitePageRevision.count()
const drafts = await prisma.sitePageDraft.count()
console.log(`\nsite_page ${pages} · site_page_revision ${revisions} · site_page_draft ${drafts}`)

await prisma.$disconnect()
