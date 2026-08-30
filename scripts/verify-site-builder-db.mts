/**
 * Site builder verification — the parts that need a database.
 *
 * ── This script WRITES, so it refuses to run anywhere it should not ──────────────────────────────
 * Draft isolation, atomic publish, rollback and optimistic concurrency cannot be proved without
 * writing, and writing to the working copy of the live data would be exactly the accident this
 * repository has been bitten by before. So the first thing it does is assert the target database
 * matches the disposable pattern, and it refuses otherwise — before Prisma is even imported, because
 * importing it opens a connection.
 *
 * Run it against a clone:
 *   scripts/db/make-test-clone.sh 8br_test_sb
 *   DATABASE_URL=...8br_test_sb npm run test:site-builder:db
 */

import { assertDisposableTestDatabase } from '../src/lib/db-guard'

// Before anything else, and before Prisma is imported.
assertDisposableTestDatabase('verify-site-builder-db')

const { prisma } = await import('../src/lib/prisma')
const {
  bootstrap, publish, rollback, saveDraft, getDraft, readPublishedLayout, discardDraft,
  resetToFactory, ConflictError,
} = await import('../src/lib/site-builder/service')
const { validateDocument } = await import('../src/lib/site-builder/document')
const { createInstance, insertModule, removeModule, updateModuleConfig } = await import('../src/lib/site-builder/operations')
await import('../src/components/site-builder/modules')

let pass = 0
let fail = 0
const failures: string[] = []
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++
  else { fail++; failures.push(`${name}${detail ? ` — ${detail}` : ''}`) }
}
const eq = (name: string, a: unknown, b: unknown) => {
  const x = JSON.stringify(a); const y = JSON.stringify(b)
  check(name, x === y, x === y ? '' : `got ${x}, expected ${y}`)
}
const section = (t: string) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 74 - t.length))}`)

const actor = { userId: 999999, username: 'verification-script' }
const KEY = '/'

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Bootstrap')

/*
  Clear the builder tables first.

  The clone is taken from the working local database, which is now bootstrapped, so without this the
  suite would assert that bootstrap creates eleven pages against a database that already has them —
  and would report a failure that means nothing except "the clone was made later than the bootstrap".
  A test that only passes from one starting state is a test that will be wrong eventually.

  Only site_* tables are touched, and only on a disposable clone the guard above has already
  verified. No competition data is involved, which the final section asserts.
*/
await prisma.$executeRawUnsafe(`
  TRUNCATE site_page_revision, site_page_draft, site_trash_item,
           site_reusable_module, site_template, site_theme_profile, site_builder_pref,
           site_page RESTART IDENTITY CASCADE
`)

const first = await bootstrap(actor)
check('bootstrap creates pages', first.created.length > 0, `${first.created.length} created`)
check('bootstrap includes the homepage', first.created.includes('/'))

// Idempotence matters: this is meant to be safe to re-run, including as a startup step.
const second = await bootstrap(actor)
eq('re-running creates nothing', second.created, [])
check('re-running skips everything', second.skipped.length === first.created.length + first.skipped.length)

const page = await prisma.sitePage.findUnique({ where: { key: KEY }, include: { publishedRevision: true, draft: true } })
check('the page has a published revision', !!page?.publishedRevision)
check('the page has a draft', !!page?.draft)
eq('the first revision is number 1', page?.publishedRevision?.number, 1)
check('the draft starts clean', page?.draft?.dirty === false)

// The captured layout must be the homepage as built in code.
const published0 = await readPublishedLayout(KEY)
eq('published source is the revision', published0.source, 'published')
eq('five sections captured', published0.document.sections.length, 5)
eq('module order captured', published0.document.sections.flatMap((s) => s.modules.map((m) => m.type)), [
  'competitions.history', 'rankings.live', 'competitions.marquee',
  'editorial.breakFeature', 'content.archiveNotice', 'rankings.achievements', 'rankings.statusRail',
])

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Draft isolation')

const d0 = (await getDraft(KEY))!
const edited = insertModule(d0.document, d0.document.sections[0].id, createInstance('content.heading', { id: 'probe-heading' }))
const saved = await saveDraft(KEY, edited, d0.version, actor)
check('the draft saves', saved.version > d0.version)

const stillPublished = await readPublishedLayout(KEY)
// The whole point: an edit must not reach the public page until it is published.
eq('the published layout is unchanged by a draft edit',
  stillPublished.document.sections[0].modules.length, published0.document.sections[0].modules.length)
const draftNow = (await getDraft(KEY))!
eq('the draft holds the edit', draftNow.document.sections[0].modules.length, published0.document.sections[0].modules.length + 1)
check('the draft is marked dirty', draftNow.dirty)

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Optimistic concurrency')

// Two tabs. The second holds a version the row has moved past, and must be refused rather than
// silently overwriting whichever tab saved first.
let conflicted = false
try {
  await saveDraft(KEY, edited, d0.version, actor)
} catch (err) {
  conflicted = err instanceof ConflictError
}
check('a stale version is refused as a conflict', conflicted)

const afterConflict = (await getDraft(KEY))!
eq('the refused save changed nothing', afterConflict.version, saved.version)

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Publish')

const result = await publish(KEY, actor, 'Verification publish')
eq('publishing creates revision 2', result.revisionNumber, 2)

const live = await prisma.sitePage.findUnique({ where: { key: KEY }, include: { publishedRevision: true, draft: true } })
const liveDoc = validateDocument(live!.publishedRevision!.document).value
eq('the published revision now holds the edit',
  liveDoc.sections[0].modules.length, published0.document.sections[0].modules.length + 1)
check('the draft is clean after publishing', live?.draft?.dirty === false)
eq('the revision records who published it', live?.publishedRevision?.publishedByUsername, actor.username)
eq('the revision records the summary', live?.publishedRevision?.summary, 'Verification publish')
check('the revision chains to its predecessor', !!live?.publishedRevision?.previousRevisionId)

const auditRows = await prisma.auditLog.findMany({
  where: { action: 'site_builder.publish', entityId: KEY },
  orderBy: { createdAt: 'desc' },
})
check('publishing is audited', auditRows.length >= 1)
eq('the audit entry names the actor', auditRows[0]?.actorUsername, actor.username)

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Rollback')

const back = await rollback(KEY, 1, actor)
// Rollback must be append-only: a NEW revision, not a repointing, so history stays unambiguous
// about what was live when — and so the rollback itself can be rolled back.
eq('rollback creates a new revision', back.revisionNumber, 3)
const afterRollback = await prisma.sitePage.findUnique({ where: { key: KEY }, include: { publishedRevision: true } })
const rolledDoc = validateDocument(afterRollback!.publishedRevision!.document).value
eq('the rolled-back layout matches revision 1',
  rolledDoc.sections[0].modules.length, published0.document.sections[0].modules.length)
const revisionCount = await prisma.sitePageRevision.count({ where: { pageId: page!.id } })
eq('revision 2 still exists', revisionCount, 3)
check('rollback is audited', (await prisma.auditLog.count({ where: { action: 'site_builder.rollback' } })) >= 1)

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Invalid drafts and the fallback chain')

// A draft that cannot be validated must not be storable AS GIVEN. It is coerced to something valid
// rather than rejected outright, because refusing the whole save would strand an administrator whose
// document contained one bad field.
const cur = (await getDraft(KEY))!
const poisoned = structuredClone(cur.document)
poisoned.sections[0].modules[0] = {
  id: 'bad', type: 'content.button', configVersion: 1,
  config: { label: 'x', href: 'javascript:alert(1)', variant: 'primary', newTab: false, align: 'left' },
  layout: { desktop: { span: 1 } }, style: {}, visibility: {}, reusableId: null,
}
await saveDraft(KEY, poisoned, cur.version, actor)
const stored = await prisma.sitePageDraft.findUnique({ where: { pageId: page!.id } })
const storedDoc = stored!.document as { sections: { modules: { config: Record<string, unknown> }[] }[] }
check('an unsafe URL never reaches the database',
  storedDoc.sections[0].modules[0].config.href !== 'javascript:alert(1)',
  String(storedDoc.sections[0].modules[0].config.href))

// A published revision that somehow fails validation must fall back rather than break the page.
await prisma.sitePageRevision.update({
  where: { id: afterRollback!.publishedRevisionId! },
  data: { document: { version: 1, sections: 'not an array' } },
})
const recovered = await prisma.sitePage.findUnique({ where: { key: KEY }, include: { publishedRevision: true } })
const badCheck = validateDocument(recovered!.publishedRevision!.document)
check('a corrupted document yields no sections rather than throwing', badCheck.value.sections.length === 0)

// Put it back so the remaining checks run against a sane page.
await prisma.sitePageRevision.update({
  where: { id: afterRollback!.publishedRevisionId! },
  data: { document: rolledDoc as never },
})

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Discard and factory reset')

const beforeDiscard = (await getDraft(KEY))!
await saveDraft(KEY, removeModule(beforeDiscard.document, beforeDiscard.document.sections[0].modules[0].id), beforeDiscard.version, actor)
await discardDraft(KEY, actor)
const discarded = (await getDraft(KEY))!
eq('discard returns the draft to the published layout',
  discarded.document.sections[0].modules.length, rolledDoc.sections[0].modules.length)
check('discard leaves the draft clean', !discarded.dirty)

await resetToFactory(KEY, actor)
const reset = (await getDraft(KEY))!
eq('reset restores five sections', reset.document.sections.length, 5)
check('reset marks the draft dirty so it can be reviewed', reset.dirty)
// Crucially, reset does NOT publish. The public page must still be whatever was live.
const afterReset = await prisma.sitePage.findUnique({ where: { key: KEY }, include: { publishedRevision: true } })
eq('reset does not publish', afterReset!.publishedRevisionId, afterRollback!.publishedRevisionId)

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Competition data untouched')

// The builder is a presentation layer. Nothing it does may alter the record.
const counts = {
  seasons: await prisma.season.count(),
  ledger: await prisma.ratingLedger.count(),
  entrants: await prisma.seasonEntrant.count(),
  playoffs: await prisma.seasonPlayoffMatch.count(),
  articles: await prisma.article.count(),
}
console.log(`   seasons ${counts.seasons} · ledger ${counts.ledger} · entrants ${counts.entrants} · playoff rows ${counts.playoffs} · articles ${counts.articles}`)
check('competition data is still present', counts.seasons > 0 && counts.ledger > 0)
const season16426 = await prisma.season.findUnique({ where: { id: 16426 } })
if (season16426) {
  eq('Season 16426 is still completed', season16426.lifecycleState, 'COMPLETED')
  eq('Season 16426 still records its champion', season16426.championName, 'Kevin')
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(78)}`)
if (fail) {
  console.log(`\n${fail} FAILED:\n`)
  for (const f of failures) console.log(`  ✗ ${f}`)
}
console.log(`\n${pass} checks passed, ${fail} failed\n`)
await prisma.$disconnect()
process.exit(fail ? 1 : 0)
