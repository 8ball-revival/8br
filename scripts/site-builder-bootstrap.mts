/**
 * Capture the current site as the first published layout.
 *
 * Idempotent: a page that already exists is left completely alone, including its draft and its
 * revision history, so re-running after adding a page to FACTORY_PAGES creates only that one.
 *
 * This WRITES, but only site-builder rows — no competition data is touched, which the verification
 * suite asserts separately. It is the one builder operation that is meant to run against the real
 * local database rather than a clone, because its whole purpose is to set the feature up there.
 */

import { prisma } from '../src/lib/prisma'
import { bootstrap } from '../src/lib/site-builder/service'
import '../src/components/site-builder/modules'

const url = process.env.DATABASE_URL ?? ''
const dbName = url.split('/').pop()?.split('?')[0] ?? 'unknown'
console.log(`Database: ${dbName}\n`)

const actor = {
  userId: 0,
  // Named so the audit log is honest about what performed the write. A bootstrap is a system act,
  // not something a person did, and attributing it to an administrator would be a small lie in the
  // one table that exists to be trusted.
  username: 'site-builder-bootstrap',
}

const result = await bootstrap(actor)
if (result.created.length) {
  console.log(`Created ${result.created.length} page(s):`)
  for (const key of result.created) console.log(`  + ${key}`)
} else {
  console.log('Nothing to create.')
}
if (result.skipped.length) console.log(`\nAlready present: ${result.skipped.join(', ')}`)

const pages = await prisma.sitePage.count()
const revisions = await prisma.sitePageRevision.count()
const drafts = await prisma.sitePageDraft.count()
console.log(`\nsite_page ${pages} · site_page_revision ${revisions} · site_page_draft ${drafts}`)

await prisma.$disconnect()
