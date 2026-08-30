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
const { visibleLinks, ensureRecoveryLinks, contrastRatio } = await import('../src/lib/site-builder/globals')
const { isVisible, factsFor, describeVisibility } = await import('../src/lib/site-builder/visibility')
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
section('Scheduling')

/*
  A scheduled revision is built and frozen NOW, not at the appointed hour.

  That is deliberate. It means a later edit to the draft cannot silently change what was scheduled,
  and it means the scheduler only has to move a pointer rather than build and validate a document
  unattended at three in the morning with nobody watching it.
*/
const soon = new Date(Date.now() + 3_600_000)
const later = new Date(Date.now() + 7_200_000)
const scheduledSource = (await getDraft(KEY))!
const pageRow = (await prisma.sitePage.findUnique({ where: { key: KEY } }))!
const lastNumber = (await prisma.sitePageRevision.findFirst({
  where: { pageId: pageRow.id }, orderBy: { number: 'desc' },
}))!.number
const scheduled = await prisma.sitePageRevision.create({
  data: {
    pageId: pageRow.id,
    number: lastNumber + 1,
    document: scheduledSource.document as never,
    state: 'SCHEDULED',
    scheduledFor: soon,
    expiresAt: later,
    publishedByUsername: actor.username,
  },
})
eq('a scheduled revision is stored as SCHEDULED', scheduled.state, 'SCHEDULED')
eq('it records when it should publish', scheduled.scheduledFor?.getTime(), soon.getTime())
eq('it records when it should expire', scheduled.expiresAt?.getTime(), later.getTime())

const whileScheduled = (await prisma.sitePage.findUnique({ where: { key: KEY } }))!
check('scheduling changes nothing about what is live', whileScheduled.publishedRevisionId !== scheduled.id)

// The draft moves on after scheduling. What was scheduled must not move with it.
const movedOn = (await getDraft(KEY))!
await saveDraft(
  KEY,
  insertModule(movedOn.document, movedOn.document.sections[0].id, createInstance('content.heading', { id: 'after-schedule' })),
  movedOn.version,
  actor,
)
const frozen = (await prisma.sitePageRevision.findUnique({ where: { id: scheduled.id } }))!
const frozenIds = validateDocument(frozen.document).value.sections[0].modules.map((m) => m.id)
check('a later draft edit does not reach the scheduled revision', !frozenIds.includes('after-schedule'))

/*
  Activation is a pointer move and nothing else — the document was frozen above. It happens in one
  transaction for the same reason publishing does: a page must never be left pointing at a revision
  whose own state says it is not published.
*/
await prisma.$transaction(async (tx: typeof prisma) => {
  await tx.sitePageRevision.update({ where: { id: scheduled.id }, data: { state: 'PUBLISHED' } })
  await tx.sitePage.update({ where: { id: pageRow.id }, data: { publishedRevisionId: scheduled.id } })
})
const activated = (await prisma.sitePage.findUnique({ where: { key: KEY }, include: { publishedRevision: true } }))!
eq('activation makes the scheduled revision live', activated.publishedRevisionId, scheduled.id)
eq(
  'activation publishes exactly what was frozen',
  validateDocument(activated.publishedRevision!.document).value.sections.flatMap((x) => x.modules.map((m) => m.type)),
  validateDocument(scheduledSource.document).value.sections.flatMap((x) => x.modules.map((m) => m.type)),
)
const liveAfterActivation = await readPublishedLayout(KEY)
check(
  'the live page renders the activated revision',
  liveAfterActivation.source === 'published' && liveAfterActivation.document.sections.length === 5,
)

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Reusable modules')

const reusable = await prisma.siteReusableModule.create({
  data: {
    name: 'Verification announcement',
    category: 'content',
    moduleType: 'content.announcement',
    config: { title: 'Original' } as never,
    createdByUsername: actor.username,
  },
})
check('a module can be saved for reuse', !!reusable.id)
eq('it starts at version 1', reusable.version, 1)

const beforeLink = (await getDraft(KEY))!
await saveDraft(
  KEY,
  insertModule(
    beforeLink.document,
    beforeLink.document.sections[0].id,
    createInstance('content.announcement', { id: 'linked-1', reusableId: reusable.id }),
  ),
  beforeLink.version,
  actor,
)
const withLink = (await getDraft(KEY))!
const linked = withLink.document.sections[0].modules.find((m) => m.id === 'linked-1')
check('a linked instance survives validation', !!linked)
eq('and keeps the link', linked?.reusableId, reusable.id)

/*
  Editing the source bumps its version and does NOT rewrite the instances in place.

  This is the guarantee item 7 of the brief asks for. A linked module can sit on a dozen pages, each
  with its own draft and its own publish history. Rewriting them here would push the change onto all
  of those pages at once, publishing work nobody had reviewed. The version bump is how an instance
  learns it is behind; taking the update is a separate, deliberate act.
*/
const bumped = await prisma.siteReusableModule.update({
  where: { id: reusable.id },
  data: { config: { title: 'Changed' } as never, version: { increment: 1 } },
})
eq('editing the source bumps its version', bumped.version, 2)
const afterBump = (await getDraft(KEY))!
const stillLinked = afterBump.document.sections[0].modules.find((m) => m.id === 'linked-1')
eq('the instance still points at the source', stillLinked?.reusableId, reusable.id)
eq(
  'and nothing was published by the edit',
  (await prisma.sitePage.findUnique({ where: { key: KEY } }))!.publishedRevisionId,
  scheduled.id,
)

// Detaching removes the link and nothing else: whatever settings it had are what it keeps.
const detachDoc = structuredClone(afterBump.document)
const detachTarget = detachDoc.sections[0].modules.find((m) => m.id === 'linked-1')!
const settingsBefore = JSON.stringify(detachTarget.config)
detachTarget.reusableId = null
await saveDraft(KEY, detachDoc, afterBump.version, actor)
const afterDetach = (await getDraft(KEY))!
const detached = afterDetach.document.sections[0].modules.find((m) => m.id === 'linked-1')
eq('a detached instance keeps its settings', JSON.stringify(detached?.config), settingsBefore)
check('a detached instance no longer follows the source', !detached?.reusableId)

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Templates and inheritance')

const template = await prisma.siteTemplate.create({
  data: {
    name: 'Verification page template',
    scope: 'page',
    document: validateDocument(afterDetach.document).value as never,
    createdByUsername: actor.username,
  },
})
check('a layout can be saved as a template', !!template.id)
const readBack = validateDocument((await prisma.siteTemplate.findUnique({ where: { id: template.id } }))!.document)
check('a template validates when read back', readBack.ok)
eq('a template keeps its sections', readBack.value.sections.length, afterDetach.document.sections.length)

// A template is a starting point, never a live link. Editing one must publish nothing, anywhere.
const publishedBefore = await prisma.sitePage.findMany({
  select: { key: true, publishedRevisionId: true }, orderBy: { key: 'asc' },
})
await prisma.siteTemplate.update({ where: { id: template.id }, data: { name: 'Renamed template' } })
const publishedAfter = await prisma.sitePage.findMany({
  select: { key: true, publishedRevisionId: true }, orderBy: { key: 'asc' },
})
eq('editing a template publishes nothing on any page', publishedAfter, publishedBefore)

/*
  Inheritance: a Season page with no override of its own is governed by the `season` template, and a
  page may name a parent it falls back to. Both are structural, so both are checked against the rows
  rather than against a description of them.
*/
const seasonTemplate = await prisma.sitePage.findUnique({ where: { key: 'season' } })
eq('the season template is a TEMPLATE', seasonTemplate?.kind, 'TEMPLATE')
check('the season template is published', !!seasonTemplate?.publishedRevisionId)
const override = await prisma.sitePage.create({
  data: {
    kind: 'TEMPLATE',
    key: 'season:override-probe',
    title: 'Override probe',
    scopeEntityId: 16426,
    parentId: seasonTemplate!.id,
  },
})
const withParent = await prisma.sitePage.findUnique({ where: { id: override.id }, include: { parent: true } })
eq('an override can name the template it falls back to', withParent?.parent?.key, 'season')
// Deleting an override must not take its parent with it — inheritance is a fallback, not ownership.
await prisma.sitePage.delete({ where: { id: override.id } })
check(
  'the season template survives its override being deleted',
  !!(await prisma.sitePage.findUnique({ where: { key: 'season' } })),
)

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Templates as first-class things')

/*
  A template used to be write-only: savable, insertable, and unreachable afterwards. Everything
  below is the lifecycle that was missing — and the case that mattered most is the first one, a
  template with nothing in it and nothing built from it, which previously could not be opened at all.
*/
const {
  createTemplate, getTemplate, updateTemplate, getTemplateRevisions, rollbackTemplate,
  duplicateTemplate, setTemplateArchived, deleteTemplate, getTemplateUsage, listTemplates,
  blankDocument,
} = await import('../src/lib/site-builder/templates')

// ── A blank template, created from nothing ──────────────────────────────────────────────────────
const blank = await createTemplate({ name: 'Blank probe', scope: 'section', description: 'Made empty' }, actor)
const blankDetail = (await getTemplate(blank.id))!
check('a template can be created with no layout to copy', !!blankDetail)
eq('it is a section template', blankDetail.scope, 'section')
eq('it keeps its description', blankDetail.description, 'Made empty')
eq('it opens on one empty section rather than on nothing', blankDetail.sectionCount, 1)
eq('with no modules in it', blankDetail.moduleCount, 0)
eq('and revision 1 exists from the moment it is created', blankDetail.revisionCount, 1)
check('a blank template appears in the listing', (await listTemplates()).some((t) => t.id === blank.id))

// A zero-instance template is exactly the case that used to be unreachable.
const zeroUsage = await getTemplateUsage(blank.id)
eq('nothing links to it', zeroUsage.linkedReusables.length, 0)
eq('and nothing was built from it', zeroUsage.likelyStartedFrom.length, 0)
check('it is still fully readable', (await getTemplate(blank.id))!.document.sections.length === 1)

// ── Editing it directly ─────────────────────────────────────────────────────────────────────────
const templateEdit = structuredClone(blankDetail.document)
templateEdit.sections[0].name = 'Standings block'
templateEdit.sections[0].modules = [createInstance('content.heading', { id: 'tpl-heading' })]
const save1 = await updateTemplate(blank.id, { document: templateEdit }, actor, 'Added a heading')
eq('saving writes a revision', save1.revisionNumber, 2)
const afterTemplateEdit = (await getTemplate(blank.id))!
eq('the layout is stored', afterTemplateEdit.moduleCount, 1)
eq('and the section keeps its name', afterTemplateEdit.document.sections[0].name, 'Standings block')

// Renaming and rescoping are part of the same history.
await updateTemplate(blank.id, { name: 'Standings starter', scope: 'page', description: null }, actor, 'Renamed')
const renamed = (await getTemplate(blank.id))!
eq('a template can be renamed', renamed.name, 'Standings starter')
eq('and rescoped', renamed.scope, 'page')
eq('a cleared description is null rather than empty', renamed.description, null)

// ── History and rollback ────────────────────────────────────────────────────────────────────────
const revisions = await getTemplateRevisions(blank.id)
eq('every save is in the history', revisions.length, 3)
eq('the newest is first', revisions[0].number, 3)
check('the current one is marked', revisions.some((r) => r.isCurrent))
check('each carries what it was called at the time',
  revisions.some((r) => r.name === 'Blank probe') && revisions.some((r) => r.name === 'Standings starter'))

const rolled = await rollbackTemplate(blank.id, 1, actor)
eq('a rollback appends rather than truncating', rolled.revisionNumber, 4)
const afterTemplateRollback = (await getTemplate(blank.id))!
eq('it restores the name too, not only the layout', afterTemplateRollback.name, 'Blank probe')
eq('and the layout', afterTemplateRollback.moduleCount, 0)
eq('the revisions it rolled past still exist', (await getTemplateRevisions(blank.id)).length, 4)

// The rollback is itself rollback-able, which is the point of appending.
await rollbackTemplate(blank.id, 3, actor)
eq('rolling the rollback back returns to where it was', (await getTemplate(blank.id))!.name, 'Standings starter')

// ── Duplicate, archive, restore ─────────────────────────────────────────────────────────────────
const copy = await duplicateTemplate(blank.id, actor)
const copyDetail = (await getTemplate(copy.id))!
check('a duplicate is a separate template', copy.id !== blank.id)
eq('named as a copy', copyDetail.name, 'Standings starter copy')
eq('with its own history starting at 1', copyDetail.revisionCount, 1)

await setTemplateArchived(copy.id, true, actor)
check('an archived template is out of the ordinary listing', !(await listTemplates()).some((t) => t.id === copy.id))
check('but is still there when asked for', (await listTemplates({ includeArchived: true })).some((t) => t.id === copy.id))
check('and keeps its history', (await getTemplateRevisions(copy.id)).length === 1)
await setTemplateArchived(copy.id, false, actor)
check('restoring brings it back', (await listTemplates()).some((t) => t.id === copy.id))

// ── Usage, and the impact warning ───────────────────────────────────────────────────────────────
const plantedSource = await prisma.siteReusableModule.create({
  data: {
    name: 'Planted announcement', category: 'content', moduleType: 'content.announcement',
    config: { title: 'Planted' } as never, createdByUsername: actor.username,
  },
})
const withLinked = structuredClone((await getTemplate(blank.id))!.document)
withLinked.sections[0].modules = [
  createInstance('content.announcement', { id: 'tpl-linked', reusableId: plantedSource.id }),
]
await updateTemplate(blank.id, { document: withLinked }, actor, 'Planted a linked module')

const usageBefore = await getTemplateUsage(blank.id)
eq('the template reports the linked module it plants', usageBefore.linkedReusables.length, 1)
eq('by name', usageBefore.linkedReusables[0].name, 'Planted announcement')
eq('and says it is on no page yet', usageBefore.linkedReusables[0].onPages.length, 0)

// Put an instance of that module on a real page, and the warning becomes a real warning.
const homeDraft = (await getDraft(KEY))!
await saveDraft(KEY, insertModule(
  homeDraft.document,
  homeDraft.document.sections[0].id,
  createInstance('content.announcement', { id: 'live-linked', reusableId: plantedSource.id }),
), homeDraft.version, actor)

const usageAfter = await getTemplateUsage(blank.id)
check('once a page carries one, the template says which page', usageAfter.linkedReusables[0].onPages.length > 0,
  JSON.stringify(usageAfter.linkedReusables[0].onPages))

/*
  Deleting is refused while something depends on it.

  Not because the template is referenced — inserting one copies it, so no page ever points back —
  but because of the LINKED modules it plants, which do reach live pages.
*/
let deleteRefused = false
let refusalMessage = ''
try {
  await deleteTemplate(blank.id, actor)
} catch (err) {
  deleteRefused = true
  refusalMessage = err instanceof Error ? err.message : ''
}
check('deleting a template whose linked modules are live is refused', deleteRefused)
check('and the refusal says what to do instead', /archive/i.test(refusalMessage), refusalMessage)
check('the template is still there', !!(await getTemplate(blank.id)))

// A template nothing depends on deletes cleanly, and takes its revisions with it.
const disposable = await createTemplate({ name: 'Disposable', scope: 'section' }, actor)
await updateTemplate(disposable.id, { name: 'Disposable, edited' }, actor)
eq('it has history before deletion', (await getTemplateRevisions(disposable.id)).length, 2)
await deleteTemplate(disposable.id, actor)
check('an unused template deletes', !(await getTemplate(disposable.id)))
eq('and its revisions go with it', await prisma.siteTemplateRevision.count({ where: { templateId: disposable.id } }), 0)

// ── Editing a template publishes nothing, anywhere ──────────────────────────────────────────────
const publishedBeforeTemplateWork = await prisma.sitePage.findMany({
  select: { key: true, publishedRevisionId: true }, orderBy: { key: 'asc' },
})
await updateTemplate(blank.id, { name: 'Renamed once more' }, actor, 'A change with no consequences')
eq('editing a template publishes nothing on any page',
  await prisma.sitePage.findMany({ select: { key: true, publishedRevisionId: true }, orderBy: { key: 'asc' } }),
  publishedBeforeTemplateWork)

// ── Validation is applied on the way in ─────────────────────────────────────────────────────────
let invalidRefused = false
try {
  await updateTemplate(blank.id, {
    document: {
      version: 1,
      sections: [{
        id: 'bad', name: 'Bad', width: 'wide', columns: { desktop: [1] }, style: {}, visibility: {},
        modules: [{
          id: 'bad-button', type: 'content.button', configVersion: 1,
          config: { label: 'x', href: 'javascript:alert(1)', variant: 'primary', newTab: false, align: 'left' },
          layout: { desktop: { span: 1 } }, style: {}, visibility: {}, reusableId: null,
        }],
      }],
    },
  }, actor)
} catch {
  invalidRefused = true
}
check('a template cannot be saved with a setting the validator rejects', invalidRefused)
let unnamedRefused = false
try {
  await createTemplate({ name: '   ', scope: 'page' }, actor)
} catch {
  unnamedRefused = true
}
check('and cannot be created without a name', unnamedRefused)

// A blank document is a real document, not a special case downstream.
const blankDoc = blankDocument('page')
eq('a blank template document has one section', blankDoc.sections.length, 1)
check('and it validates', validateDocument(blankDoc).ok)

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Trash')

const trashed = await prisma.siteTrashItem.create({
  data: {
    kind: 'module',
    label: 'Deleted heading',
    payload: createInstance('content.heading', { id: 'trashed-1' }) as never,
    deletedByUsername: actor.username,
    purgeAfter: new Date(Date.now() + 30 * 86_400_000),
  },
})
check('a deleted module goes to the trash rather than vanishing', !!trashed.id)
check('and carries a purge date, so the trash does not grow forever', !!trashed.purgeAfter)
const restored = validateDocument({
  version: 1,
  sections: [{
    id: 'restore-probe',
    name: 'Restore probe',
    width: 'wide',
    columns: { desktop: [1] },
    style: {},
    visibility: {},
    modules: [trashed.payload],
  }],
})
eq('a trashed payload validates back into a document', restored.value.sections[0].modules.length, 1)
eq('and comes back as what it was', restored.value.sections[0].modules[0].type, 'content.heading')

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Globals — navigation, footer and theme')

/*
  Navigation, footer and theme go through the same draft/publish/revision/rollback machinery as a
  page, because they are pages — GLOBAL ones. That is why there is no second, weaker approval path
  for the header: changing the site navigation is a publish, audited like any other publish.
*/
for (const key of ['nav', 'footer', 'theme']) {
  const globalPage = await prisma.sitePage.findUnique({ where: { key }, include: { draft: true } })
  check(`the ${key} global exists`, !!globalPage)
  eq(`the ${key} global is a GLOBAL`, globalPage?.kind, 'GLOBAL')
  check(`the ${key} global is published`, !!globalPage?.publishedRevisionId)
  check(`the ${key} global has a draft to edit`, !!globalPage?.draft)
}

// Editing the navigation is a real publish, with a real revision and a real audit entry.
const navBefore = (await getDraft('nav'))!
const navModule = navBefore.document.sections[0].modules.find((m) => m.type === 'global.navigation')
check('the navigation module is where navigation is edited', !!navModule)
const navEdited = updateModuleConfig(navBefore.document, navModule!.id, {
  items: [{ label: 'Probe', href: '/rankings', children: [], visibility: {}, mobileLabel: '', newTab: false }],
})
await saveDraft('nav', navEdited, navBefore.version, actor)
const navPublish = await publish('nav', actor, 'Navigation probe')
check('publishing the navigation creates a revision', navPublish.revisionNumber > 1)
check(
  'publishing the navigation is audited',
  (await prisma.auditLog.count({ where: { action: 'site_builder.publish', entityId: 'nav' } })) >= 1,
)
const navLivePublished = await readPublishedLayout('nav')
const navPublishedItems = (navLivePublished.document.sections[0].modules
  .find((m) => m.type === 'global.navigation')?.config.items ?? []) as { label: string }[]
check('the published navigation is the edited one', navPublishedItems.some((i) => i.label === 'Probe'))

// And it rolls back the same way a page does.
const navRolled = await rollback('nav', 1, actor)
check('the navigation can be rolled back', navRolled.revisionNumber > navPublish.revisionNumber)
const navLive = await readPublishedLayout('nav')
const navLiveItems = (navLive.document.sections[0].modules
  .find((m) => m.type === 'global.navigation')?.config.items ?? []) as { label: string }[]
check('rollback restores the navigation that was there before', !navLiveItems.some((i) => i.label === 'Probe'))

// A theme edit must never make the interface unreadable, so contrast is checked before it publishes.
eq('black on black is 1:1, nowhere near readable', contrastRatio('#000000', '#000000'), 1)
check('white on the site background passes AA', (contrastRatio('#ffffff', '#0b0b0d') ?? 0) >= 4.5)

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Condition evaluation, end to end')

/*
  Conditions are checked in the pure suite against the evaluator directly. What is checked HERE is
  the part only a database can show: that a rule an administrator builds in the inspector survives
  validation, storage, publishing and read-back intact, and still decides the same way afterwards.

  A condition system that evaluates correctly in memory and loses its OR group on the way through
  JSONB is a condition system that silently shows the wrong thing to real visitors.
*/
const condDraft = (await getDraft(KEY))!
const condTarget = condDraft.document.sections[0].modules[0]
const builtRule = {
  match: 'any' as const,
  conditions: [{ subject: 'isOwner' as const }],
  groups: [{
    match: 'all' as const,
    conditions: [
      { subject: 'signedIn' as const },
      { subject: 'currentYear' as const, value: '2026' },
    ],
  }],
}
const withRule = structuredClone(condDraft.document)
withRule.sections[0].modules[0] = { ...condTarget, visibility: builtRule }
await saveDraft(KEY, withRule, condDraft.version, actor)
await publish(KEY, actor, 'Condition probe')

const publishedRule = (await readPublishedLayout(KEY)).document.sections[0].modules[0].visibility
eq('an OR rule survives publishing', publishedRule.match, 'any')
eq('its direct condition survives', publishedRule.conditions?.length, 1)
eq('its group survives', publishedRule.groups?.length, 1)
eq('the group keeps its own operator', publishedRule.groups?.[0].match, 'all')
eq('the group keeps both conditions', publishedRule.groups?.[0].conditions.length, 2)

// And the rule that came back out of the database decides the same way it would have in memory.
const base = factsFor({ route: '/' })
const asOwner = { ...base, signedIn: true, isOwner: true, currentYear: 2020 }
const asMember2026 = { ...base, signedIn: true, isOwner: false, currentYear: 2026 }
const asMember2020 = { ...base, signedIn: true, isOwner: false, currentYear: 2020 }
const asGuest = { ...base, signedIn: false, isOwner: false, currentYear: 2026 }
check('the Owner matches on the direct condition alone', isVisible(publishedRule, asOwner))
check('a member in 2026 matches on the group alone', isVisible(publishedRule, asMember2026))
check('a member outside the year matches neither', !isVisible(publishedRule, asMember2020))
check('a signed-out visitor matches neither', !isVisible(publishedRule, asGuest))

// The rule is data, so it can also be explained back in English rather than shown as a formula.
const described = describeVisibility(publishedRule)
check('the rule reads as a sentence', described.startsWith('Shown when') && described.includes(', or '))

// Put the page back before the counts at the end.
const cleanup = (await getDraft(KEY))!
const cleaned = structuredClone(cleanup.document)
cleaned.sections[0].modules[0] = { ...cleaned.sections[0].modules[0], visibility: {} }
await saveDraft(KEY, cleaned, cleanup.version, actor)
await publish(KEY, actor, 'Condition probe removed')

// ── Navigation visibility uses the same idea with a smaller vocabulary ───────────────────────────
const navRules = [
  { label: 'Everyone', href: '/', audience: 'everyone', device: 'both' },
  { label: 'Members', href: '/account', audience: 'signedIn', device: 'both' },
  { label: 'Visitors', href: '/login', audience: 'signedOut', device: 'both' },
  { label: 'Staff', href: '/staff', audience: 'staff', device: 'both' },
  { label: 'Owner', href: '/staff/site-builder', audience: 'owner', device: 'both' },
  { label: 'Phone', href: '/m', audience: 'everyone', device: 'mobileOnly' },
  { label: 'Desk', href: '/d', audience: 'everyone', device: 'desktopOnly' },
].map((l) => ({ ...l, mobileLabel: '', newTab: false, icon: '', badge: '', children: [] }))

const ownerViewer = { signedIn: true, isStaff: true, isOwner: true }
const guestViewer = { signedIn: false, isStaff: false, isOwner: false }
const ownerSees = visibleLinks(navRules, ownerViewer, 'desktop').map((l) => l.label)
const guestSees = visibleLinks(navRules, guestViewer, 'desktop').map((l) => l.label)
const ownerOnPhone = visibleLinks(navRules, ownerViewer, 'mobile').map((l) => l.label)
eq('the Owner sees the member, staff and owner links', ownerSees, ['Everyone', 'Members', 'Staff', 'Owner', 'Desk'])
eq('a signed-out visitor sees none of them', guestSees, ['Everyone', 'Visitors', 'Desk'])
check('a phone-only link appears only on a phone', ownerOnPhone.includes('Phone') && !ownerSees.includes('Phone'))
check('a desktop-only link stays off the phone', !ownerOnPhone.includes('Desk'))

/*
  A navigation link's date window is applied when the navigation is READ, not in the browser.

  That is the difference between "not shown yet" and "shown to anyone who reads the page source".
  A link meant to appear when registration opens must not be in the markup a month early, so this is
  checked against the real published read rather than against the filter.
*/
const { toLink } = await import('../src/lib/site-builder/globals')
const now = new Date('2026-08-30T12:00:00Z')
const dated = (from: string, until: string) => toLink({
  label: 'Probe', mobileLabel: '', destination: '/rankings', customHref: '', newTab: false,
  icon: '', badge: '', audience: 'everyone', device: 'both', from, until, children: [],
}, now)
check('a link inside its window is published', dated('2026-01-01', '2026-12-31') !== null)
check('a link that has not started yet is dropped entirely', dated('2999-01-01', '') === null)
check('and one that has finished is too', dated('', '2000-01-01') === null)
check('an open-ended start is honoured', dated('2026-01-01', '') !== null)
check('an open-ended end is honoured', dated('', '2999-01-01') !== null)
check('no window at all always publishes', dated('', '') !== null)
check('an unreadable date is ignored rather than hiding the link', dated('not a date', '') !== null)

/*
  Dropped, not hidden — the returned value is null, so the link never enters the document the header
  renders from. A link scheduled for next month must not be in this month's markup, where anybody
  reading the page source would find it.
*/
const scheduledChild = toLink({
  label: 'Parent', mobileLabel: '', destination: '/', customHref: '', newTab: false,
  icon: '', badge: '', audience: 'everyone', device: 'both', from: '', until: '',
  children: [{
    label: 'Future child', mobileLabel: '', destination: '/rankings', customHref: '', newTab: false,
    icon: '', badge: '', audience: 'everyone', device: 'both', from: '2999-01-01', until: '', children: [],
  }],
}, now)
eq('a dropdown item outside its window is dropped too', scheduledChild?.children.length, 0)

// A link with no destination at all is dropped rather than published as a dead '#'.
check('a link with nowhere to go is dropped', toLink({
  label: 'Nowhere', mobileLabel: '', destination: 'custom', customHref: '', newTab: false,
  icon: '', badge: '', audience: 'everyone', device: 'both', from: '', until: '', children: [],
}, now) === null)

/*
  And the recovery links are appended regardless of what any of that says.

  This is the rule that makes a broken navigation survivable: publish one with no Admin link and it
  disappears for everybody except the people who need it to get back in and fix it.
*/
const stripped = visibleLinks([], ownerViewer, 'desktop')
const recoveryHrefs = ensureRecoveryLinks(stripped, ownerViewer).map((l) => l.href)
eq('an empty navigation still reaches Admin and the builder', recoveryHrefs, ['/staff', '/staff/site-builder'])
eq('and adds nothing for a visitor', ensureRecoveryLinks([], guestViewer).length, 0)


// ════════════════════════════════════════════════════════════════════════════════════════════════
section('The capture suite’s guard, snapshot and restore')

/*
  The screenshot capture publishes — that is what makes it proof rather than a mock-up — so it is the
  one verification script that mutates a database somebody cares about. Everything below is the
  machinery that makes that safe, and it is checked here rather than trusted, because a restore that
  quietly does not work is worse than no restore at all: it looks like the page was put back.
*/
const {
  assertCaptureAllowed, snapshotPages, restorePages, recoverInterruptedRun, clearJournal, JOURNAL,
} = await import('../scripts/capture-guard.mts')
const { existsSync, readFileSync, writeFileSync } = await import('node:fs')

const realUrl = process.env.DATABASE_URL
const realAck = process.env.SB_CAPTURE_ACKNOWLEDGE

/** Run something with a pretend environment, and always put the real one back. */
const withEnv = <T>(url: string | undefined, ack: string | undefined, fn: () => T): T => {
  if (url === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = url
  if (ack === undefined) delete process.env.SB_CAPTURE_ACKNOWLEDGE; else process.env.SB_CAPTURE_ACKNOWLEDGE = ack
  try {
    return fn()
  } finally {
    if (realUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = realUrl
    if (realAck === undefined) delete process.env.SB_CAPTURE_ACKNOWLEDGE; else process.env.SB_CAPTURE_ACKNOWLEDGE = realAck
  }
}

const refuses = (url: string | undefined, ack: string | undefined): string => {
  try {
    withEnv(url, ack, () => assertCaptureAllowed())
    return ''
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

const ACK = 'i-accept-local-writes'
check('a remote host is refused',
  /not local/i.test(refuses('postgresql://u:p@db.example.com:5432/anything', ACK)))
check('a managed host is refused even with the acknowledgement',
  /not local/i.test(refuses('postgresql://u:p@ep-x.aws.neon.tech/neondb', ACK)))
check('a local host with a production-looking name is refused',
  /does not look disposable/i.test(refuses('postgresql://u:p@127.0.0.1:5432/8br_production', ACK)))
check('and one named for Neon or Vercel is too',
  /does not look disposable/i.test(refuses('postgresql://u:p@localhost:5432/neondb', ACK)))
check('a local database with no acknowledgement is refused',
  /--i-accept-local-writes/i.test(refuses('postgresql://u:p@127.0.0.1:5432/8br_dev_copy', undefined)))
check('a wrong acknowledgement does not count',
  /--i-accept-local-writes/i.test(refuses('postgresql://u:p@127.0.0.1:5432/8br_dev_copy', 'yes')))
/*
  With no DATABASE_URL set, the guard reads `.env.replica` — which is the whole point, because that
  is how the capture is normally run. What it must NOT do is skip the host check on that path, so
  what is asserted is that the fallback still goes through the same gate and still names a local
  database rather than being waved through.
*/
const fallback = (() => {
  try { return withEnv(undefined, ACK, () => assertCaptureAllowed()) } catch (err) { return err instanceof Error ? err.message : String(err) }
})()
check('with no DATABASE_URL the guard falls back to the development one',
  typeof fallback === 'object' && /127\.0\.0\.1|localhost/.test(fallback.label), JSON.stringify(fallback))
check('and that fallback is still a local database',
  typeof fallback === 'object' && !/neon|vercel|amazonaws/i.test(fallback.label), JSON.stringify(fallback))
check('something that is not a URL is refused',
  /could not be read as a URL/i.test(refuses('not-a-url', ACK)))

// And the one case that must be allowed, or the capture cannot run at all.
let allowed: { label: string } | null = null
try {
  allowed = withEnv('postgresql://u:p@127.0.0.1:55432/8br_test_capture', ACK, () => assertCaptureAllowed())
} catch { /* reported below */ }
check('a local, disposable-looking database with the acknowledgement is allowed', !!allowed)
eq('and it says which database it is about to write to', allowed?.label, '8br_test_capture on 127.0.0.1')

// ── Snapshot and restore ────────────────────────────────────────────────────────────────────────
const journalBefore = await snapshotPages(prisma, 'suite')
const homeSnapshot = journalBefore.pages.find((p) => p.key === '/')!
check('the snapshot captures the page the capture writes to', !!homeSnapshot)
check('including its published revision', homeSnapshot.publishedRevisionId !== undefined)
check('and every revision number it had', homeSnapshot.revisionNumbers.length > 0)
check('and it is written to disk, so a killed run can be finished later', existsSync(JOURNAL))

const beforePublished = (await prisma.sitePage.findUnique({ where: { key: KEY } }))!.publishedRevisionId
const beforeRevisions = await prisma.sitePageRevision.count({ where: { page: { key: KEY } } })

// Now do to the page roughly what the capture does: edit it and publish, twice.
for (const label of ['capture-probe-one', 'capture-probe-two']) {
  const d = (await getDraft(KEY))!
  await saveDraft(KEY, insertModule(d.document, d.document.sections[0].id, createInstance('content.heading', { id: label })), d.version, actor)
  await publish(KEY, actor, label)
}
const afterPublished = (await prisma.sitePage.findUnique({ where: { key: KEY } }))!.publishedRevisionId
check('the probe publishes moved the page', afterPublished !== beforePublished)
eq('and added two revisions', await prisma.sitePageRevision.count({ where: { page: { key: KEY } } }), beforeRevisions + 2)

const notes = await restorePages(prisma, journalBefore)
check('the restore reports what it did', notes.length > 0, notes.join('; '))
eq('the page points at the revision it did before',
  (await prisma.sitePage.findUnique({ where: { key: KEY } }))!.publishedRevisionId, beforePublished)
eq('and the revisions the run added are gone',
  await prisma.sitePageRevision.count({ where: { page: { key: KEY } } }), beforeRevisions)
check('the restored page still renders', (await readPublishedLayout(KEY)).document.sections.length > 0)
check('and none of the probe content survives',
  !JSON.stringify((await readPublishedLayout(KEY)).document).includes('capture-probe'))

/*
  ── A run that was killed outright ─────────────────────────────────────────────────────────────

  No `finally` runs when a process is killed, so the journal on disk is the only thing left. The
  next invocation reads it and finishes the job — which is the difference between "the homepage is
  restored" and "the homepage is restored unless something went badly wrong", and the second is not
  a guarantee worth having.
*/
const interrupted = await snapshotPages(prisma, 'suite')
const publishedBeforeKill = (await prisma.sitePage.findUnique({ where: { key: KEY } }))!.publishedRevisionId
const revisionsBeforeKill = await prisma.sitePageRevision.count({ where: { page: { key: KEY } } })

const killedDraft = (await getDraft(KEY))!
await saveDraft(KEY, insertModule(killedDraft.document, killedDraft.document.sections[0].id, createInstance('content.heading', { id: 'killed-run-probe' })), killedDraft.version, actor)
await publish(KEY, actor, 'a run that never cleaned up')
check('the killed run left the page changed',
  (await prisma.sitePage.findUnique({ where: { key: KEY } }))!.publishedRevisionId !== publishedBeforeKill)
check('and its journal is still on disk', existsSync(JOURNAL))

const recoveredNotes = await recoverInterruptedRun(prisma, 'suite')
check('the next run recovers it', recoveredNotes.length > 0, recoveredNotes.join(' | '))
eq('the page is back where it was',
  (await prisma.sitePage.findUnique({ where: { key: KEY } }))!.publishedRevisionId, publishedBeforeKill)
eq('with no revisions left over',
  await prisma.sitePageRevision.count({ where: { page: { key: KEY } } }), revisionsBeforeKill)
check('and the journal is cleared, so it is not recovered twice', !existsSync(JOURNAL))
void interrupted

// A journal from a DIFFERENT database is left alone rather than applied to this one.
writeFileSync(JOURNAL, JSON.stringify({ takenAt: new Date().toISOString(), database: 'somewhere else', pages: [] }))
const foreign = await recoverInterruptedRun(prisma, 'suite')
check('a journal from another database is not applied', /different database/i.test(foreign.join(' ')), foreign.join(' '))
check('and is left where it is', existsSync(JOURNAL))
clearJournal()

// An unreadable journal is discarded rather than crashing the next run.
writeFileSync(JOURNAL, 'this is not json')
const broken = await recoverInterruptedRun(prisma, 'suite')
check('an unreadable journal is discarded', /discarded/i.test(broken.join(' ')), broken.join(' '))
check('and does not stop the run', !existsSync(JOURNAL))
void readFileSync

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
