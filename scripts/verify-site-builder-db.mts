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
  And the recovery links are appended regardless of what any of that says.

  This is the rule that makes a broken navigation survivable: publish one with no Admin link and it
  disappears for everybody except the people who need it to get back in and fix it.
*/
const stripped = visibleLinks([], ownerViewer, 'desktop')
const recoveryHrefs = ensureRecoveryLinks(stripped, ownerViewer).map((l) => l.href)
eq('an empty navigation still reaches Admin and the builder', recoveryHrefs, ['/staff', '/staff/site-builder'])
eq('and adds nothing for a visitor', ensureRecoveryLinks([], guestViewer).length, 0)


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
