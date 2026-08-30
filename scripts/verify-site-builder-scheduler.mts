/**
 * Scheduled publication — the whole service, against a real database.
 *
 * ── Why this is its own suite ────────────────────────────────────────────────────────────────────
 * Everything here is about TIME and CONCURRENCY, and both are things a test has to construct
 * deliberately rather than observe. `runDueSchedules` takes an injectable `now` so a test can stand
 * exactly on a boundary — the second a revision becomes due, and the second before — which is the
 * one case a "schedule something for two seconds from now and sleep" test can never pin down.
 *
 * It WRITES, so like the other database suites it refuses to run anywhere but a disposable clone,
 * asserted before Prisma is imported.
 *
 * Run: scripts/db/make-test-clone.sh 8br_test_sched
 *      DATABASE_URL=<clone> npm run test:site-builder:scheduler
 */

import { assertDisposableTestDatabase } from '../src/lib/db-guard'

assertDisposableTestDatabase('verify-site-builder-scheduler')

const { prisma } = await import('../src/lib/prisma')
const { bootstrap, saveDraft, getDraft, readPublishedLayout } = await import('../src/lib/site-builder/service')
const { validateDocument } = await import('../src/lib/site-builder/document')
const { createInstance, insertModule } = await import('../src/lib/site-builder/operations')
const {
  runDueSchedules, ensureSchedulesApplied, resetFallbackState, listSchedules, scheduleStateOf,
} = await import('../src/lib/site-builder/scheduler')
await import('../src/components/site-builder/modules')

let pass = 0
const failures: string[] = []
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
const eq = (name: string, a: unknown, b: unknown) => {
  const x = JSON.stringify(a); const y = JSON.stringify(b)
  check(name, x === y, x === y ? '' : `got ${x}, expected ${y}`)
}
const section = (t: string) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`)

const actor = { userId: 999999, username: 'scheduler-suite' }

await prisma.$executeRawUnsafe(`
  TRUNCATE site_page_revision, site_page_draft, site_trash_item,
           site_reusable_module, site_template_revision, site_template,
           site_theme_profile, site_builder_pref, site_page RESTART IDENTITY CASCADE
`)
await prisma.auditLog.deleteMany({ where: { action: { startsWith: 'site_builder.schedule' } } })
await bootstrap(actor)

/** A fixed instant everything is measured against, so no test depends on how long the suite takes. */
const T0 = new Date('2026-09-01T12:00:00.000Z')
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000)

/**
 * Freeze a page's current draft into a SCHEDULED revision, the way `scheduleAction` does.
 *
 * Written out here rather than calling the action because the action resolves a session through
 * Payload, which this harness deliberately does not have. The rows it produces are identical — the
 * suite asserts against the same columns the action writes.
 */
async function scheduleFor(key: string, when: Date, opts: { expiresAt?: Date; marker?: string } = {}) {
  const page = (await prisma.sitePage.findUnique({ where: { key } }))!
  const draft = (await getDraft(key))!
  let document = draft.document
  if (opts.marker) {
    document = insertModule(
      document,
      document.sections[0].id,
      createInstance('content.heading', { id: opts.marker, config: { ...createInstance('content.heading').config, text: opts.marker } }),
    )
  }
  const last = await prisma.sitePageRevision.findFirst({
    where: { pageId: page.id }, orderBy: { number: 'desc' }, select: { number: true },
  })
  return prisma.sitePageRevision.create({
    data: {
      pageId: page.id,
      number: (last?.number ?? 0) + 1,
      document: validateDocument(document).value as never,
      state: 'SCHEDULED',
      scheduledFor: when,
      expiresAt: opts.expiresAt ?? null,
      previousRevisionId: page.publishedRevisionId,
      publishedByUsername: actor.username,
      summary: `Scheduled for ${when.toISOString()}`,
    },
  })
}

const liveNumber = async (key: string) =>
  (await prisma.sitePage.findUnique({ where: { key }, include: { publishedRevision: true } }))!.publishedRevision?.number ?? null

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Exact activation time')

/*
  The boundary is `<=`, and the second before it is not.

  A scheduler that is a minute early publishes something nobody has approved yet; one that is a
  minute late is merely late. Both are worth pinning exactly, and neither can be pinned by a test
  that sleeps.
*/
const exact = await scheduleFor('/', minutes(10), { marker: 'exact-marker' })
const beforeSweep = await runDueSchedules({ now: minutes(9.999) })
eq('a revision one millisecond early is not considered', beforeSweep.considered, 0)
eq('and nothing was activated', beforeSweep.activations.length, 0)
eq('the live page is unchanged', await liveNumber('/'), 1)
check('the sweep reports when it next needs to look', beforeSweep.nextDueAt === minutes(10).toISOString(),
  String(beforeSweep.nextDueAt))

const onTime = await runDueSchedules({ now: minutes(10) })
eq('at exactly the scheduled instant it activates', onTime.activations.filter((a) => a.status === 'activated').length, 1)
eq('and the live page is now that revision', await liveNumber('/'), exact.number)
const activatedRow = (await prisma.sitePageRevision.findUnique({ where: { id: exact.id } }))!
eq('the revision is PUBLISHED', activatedRow.state, 'PUBLISHED')
eq('it records when it actually went out', activatedRow.activatedAt?.toISOString(), minutes(10).toISOString())
check('and its scheduledFor is cleared, so it cannot be swept twice', activatedRow.scheduledFor === null)
check('the published document is the one that was frozen',
  JSON.stringify((await readPublishedLayout('/')).document).includes('exact-marker'))

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Several revisions due at once')

const a1 = await scheduleFor('/rankings', minutes(20), { marker: 'multi-rankings' })
const a2 = await scheduleFor('/tournaments', minutes(21), { marker: 'multi-tournaments' })
const a3 = await scheduleFor('/achievements', minutes(22), { marker: 'multi-achievements' })
const future = await scheduleFor('/yahoo', minutes(600), { marker: 'far-future' })

const multi = await runDueSchedules({ now: minutes(30) })
eq('all three due revisions activate in one sweep',
  multi.activations.filter((a) => a.status === 'activated').length, 3)
eq('rankings is live', await liveNumber('/rankings'), a1.number)
eq('tournaments is live', await liveNumber('/tournaments'), a2.number)
eq('achievements is live', await liveNumber('/achievements'), a3.number)

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('A future revision is left alone')

const futureRow = (await prisma.sitePageRevision.findUnique({ where: { id: future.id } }))!
eq('the future revision is still SCHEDULED', futureRow.state, 'SCHEDULED')
check('its scheduled time is untouched', futureRow.scheduledFor?.toISOString() === minutes(600).toISOString())
check('the page it belongs to has not moved', (await liveNumber('/yahoo')) !== future.number)
eq('and the sweep names it as the next thing due', multi.nextDueAt, minutes(600).toISOString())

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('A global page activates the same way')

/*
  The navigation, the footer and the theme are GLOBAL pages, so they go through exactly this path.
  They are checked separately because they are the ones whose cache invalidation is different —
  they render in the root layout and appear on every page rather than on one.
*/
const navDraft = (await getDraft('nav'))!
const navModule = navDraft.document.sections[0].modules.find((m) => m.type === 'global.navigation')!
const navDoc = structuredClone(navDraft.document)
navDoc.sections[0].modules = navDoc.sections[0].modules.map((m) => m.id === navModule.id
  ? { ...m, config: { ...m.config, items: [{ label: 'Scheduled link', destination: '/rankings', customHref: '', mobileLabel: '', newTab: false, icon: '', badge: '', audience: 'everyone', device: 'both', from: '', until: '', children: [] }] } }
  : m)
await saveDraft('nav', navDoc, navDraft.version, actor)
const navScheduled = await scheduleFor('nav', minutes(40))

const globalSweep = await runDueSchedules({ now: minutes(41) })
eq('the global activates', globalSweep.activations.filter((a) => a.status === 'activated' && a.pageKey === 'nav').length, 1)
eq('and it is live', await liveNumber('nav'), navScheduled.number)
const liveNav = await readPublishedLayout('nav')
const liveItems = (liveNav.document.sections[0].modules.find((m) => m.type === 'global.navigation')?.config.items ?? []) as { label: string }[]
check('the published navigation is the scheduled one', liveItems.some((i) => i.label === 'Scheduled link'))

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('A cancelled schedule is ignored')

const cancelled = await scheduleFor('/the-break', minutes(50), { marker: 'cancelled-marker' })
await prisma.sitePageRevision.update({
  where: { id: cancelled.id },
  data: { state: 'ARCHIVED', scheduledFor: null, cancelledAt: minutes(45), cancelledByUsername: 'someone' },
})
const beforeCancelledSweep = await liveNumber('/the-break')
const cancelledSweep = await runDueSchedules({ now: minutes(60) })
check('a cancelled revision is not considered',
  !cancelledSweep.activations.some((a) => a.revisionNumber === cancelled.number && a.pageKey === '/the-break'))
eq('and the page it belonged to did not move', await liveNumber('/the-break'), beforeCancelledSweep)
const cancelledRow = (await prisma.sitePageRevision.findUnique({ where: { id: cancelled.id } }))!
eq('it stays ARCHIVED', cancelledRow.state, 'ARCHIVED')
eq('the interface calls it cancelled', scheduleStateOf(cancelledRow, minutes(60)), 'cancelled')

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('An invalid scheduled revision fails without taking anything with it')

/*
  The document is poisoned AFTER it is scheduled, which is exactly the real case: a module is
  removed from the registry, or a field's range is tightened, between the schedule being set and its
  due time. The revision was valid when it was frozen and is not valid when it comes due.
*/
const goodBefore = await scheduleFor('/rankings', minutes(70), { marker: 'good-alongside-bad' })
const bad = await scheduleFor('/the-break', minutes(70))
await prisma.sitePageRevision.update({
  where: { id: bad.id },
  /*
    A setting the validator rejects, not a document it can coerce.

    The first attempt at this test used `sections: 'not an array'`, which `validateDocument`
    quietly turns into an empty page and reports as valid — so the scheduler activated it, quite
    correctly, and the test failed for the right reason. An unsafe destination is genuinely
    invalid: it is the same bar `publish` applies by hand, which is the bar the scheduler has to
    apply unattended.
  */
  data: {
    document: {
      version: 1,
      sections: [{
        id: 'poisoned', name: 'Poisoned', width: 'wide', columns: { desktop: [1] }, style: {}, visibility: {},
        modules: [{
          id: 'poisoned-button', type: 'content.button', configVersion: 1,
          config: { label: 'Go', href: 'javascript:alert(1)', variant: 'primary', newTab: false, align: 'left' },
          layout: { desktop: { span: 1 } }, style: {}, visibility: {}, reusableId: null,
        }],
      }],
    } as never,
  },
})
const liveBeforeFailure = await liveNumber('/the-break')

const mixed = await runDueSchedules({ now: minutes(71) })
const badOutcome = mixed.activations.find((a) => a.revisionNumber === bad.number && a.pageKey === '/the-break')
eq('the invalid revision is reported as failed', badOutcome?.status, 'failed')
check('with a reason', !!badOutcome?.error && badOutcome.error.length > 0, badOutcome?.error)
const badRow = (await prisma.sitePageRevision.findUnique({ where: { id: bad.id } }))!
eq('and is marked FAILED in the database', badRow.state, 'FAILED')
check('with the reason stored', !!badRow.activationError)
check('the failure text carries no environment detail',
  !/postgres|password|DATABASE_URL|secret/i.test(badRow.activationError ?? ''), badRow.activationError ?? '')
eq('the page keeps the revision it was already publishing', await liveNumber('/the-break'), liveBeforeFailure)

// The whole point of separate transactions: the valid one alongside it still went out.
eq('the valid revision in the same sweep still activated', await liveNumber('/rankings'), goodBefore.number)
eq('the interface calls the failed one failed', scheduleStateOf(badRow, minutes(71)), 'failed')

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Repeated invocation is a no-op')

const auditBefore = await prisma.auditLog.count({ where: { action: 'site_builder.schedule_activated' } })
const liveBefore = await liveNumber('/rankings')
const again = await runDueSchedules({ now: minutes(80) })
eq('a second sweep finds nothing due', again.considered, 0)
eq('and activates nothing', again.activations.filter((a) => a.status === 'activated').length, 0)
eq('the live revision is unchanged', await liveNumber('/rankings'), liveBefore)
eq('and no second audit entry was written',
  await prisma.auditLog.count({ where: { action: 'site_builder.schedule_activated' } }), auditBefore)

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Concurrent invocations do not double-publish')

/*
  Six sweeps launched at once against the same due revision.

  Without `FOR UPDATE SKIP LOCKED` and the state re-read under that lock, this is the case that
  produces two audit entries and — depending on interleaving — a page pointing at a revision whose
  predecessor was recorded as something else. One activation, one audit row, is the whole assertion.
*/
const contended = await scheduleFor('/achievements', minutes(90), { marker: 'contended' })
const auditBeforeRace = await prisma.auditLog.count({
  where: { action: 'site_builder.schedule_activated', entityId: '/achievements' },
})

const racers = await Promise.all(
  Array.from({ length: 6 }, () => runDueSchedules({ now: minutes(91), trigger: 'cron' })),
)
const activatedByRacers = racers.flatMap((r) => r.activations).filter(
  (a) => a.status === 'activated' && a.revisionNumber === contended.number,
)
eq('exactly one of six concurrent sweeps activated it', activatedByRacers.length, 1)
eq('the page points at it once', await liveNumber('/achievements'), contended.number)
eq('and exactly one audit entry was written',
  await prisma.auditLog.count({ where: { action: 'site_builder.schedule_activated', entityId: '/achievements' } }),
  auditBeforeRace + 1)
check('no racer reported a failure',
  !racers.flatMap((r) => r.activations).some((a) => a.status === 'failed' && a.revisionNumber === contended.number))

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Expiry reverts to the revision it replaced')

const beforeExpiry = await liveNumber('/tournaments')
const temporary = await scheduleFor('/tournaments', minutes(100), { marker: 'temporary-banner', expiresAt: minutes(120) })
await runDueSchedules({ now: minutes(101) })
eq('the temporary revision goes live', await liveNumber('/tournaments'), temporary.number)

const stillLive = await runDueSchedules({ now: minutes(119) })
eq('and stays live until its expiry', await liveNumber('/tournaments'), temporary.number)
check('the sweep knows when it expires', stillLive.nextDueAt === minutes(120).toISOString(), String(stillLive.nextDueAt))

const afterExpiry = await runDueSchedules({ now: minutes(121) })
check('the expiry is reported', afterExpiry.activations.some((a) => a.status === 'expired' && a.pageKey === '/tournaments'))
eq('and the page is back to what it replaced', await liveNumber('/tournaments'), beforeExpiry)
eq('the expired revision is archived',
  (await prisma.sitePageRevision.findUnique({ where: { id: temporary.id } }))!.state, 'ARCHIVED')

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('The request-time fallback')

/*
  The fallback is the same service behind a cheap guard. What is checked here is the guard: that it
  runs when something is due, that it does NOT hit the database when nothing is, and that a burst of
  concurrent callers produces one sweep between them rather than one each.
*/
resetFallbackState()
const fallbackTarget = await scheduleFor('/yahoo', minutes(130), { marker: 'fallback-marker' })
await prisma.sitePageRevision.update({ where: { id: future.id }, data: { state: 'ARCHIVED', scheduledFor: null } })

await ensureSchedulesApplied(minutes(131))
eq('the fallback activates an overdue revision', await liveNumber('/yahoo'), fallbackTarget.number)

// Nothing is due now, so the guard must stop looking. A second call with a schedule inserted behind
// its back proves it: the guard is holding a "next due" time in the future, so it does not sweep.
const sneaky = await scheduleFor('/rankings', minutes(132), { marker: 'sneaky' })
const liveBeforeSneaky = await liveNumber('/rankings')
await ensureSchedulesApplied(minutes(133))
eq('the guard does not sweep again before it believes anything is due',
  await liveNumber('/rankings'), liveBeforeSneaky)

// Reset it, and the same call now does the work — so the skip above was the guard, not a failure.
resetFallbackState()
await ensureSchedulesApplied(minutes(134))
eq('once the guard is cleared the same revision activates', await liveNumber('/rankings'), sneaky.number)

// A burst: one sweep between them, not one each.
resetFallbackState()
const burstTarget = await scheduleFor('/the-break', minutes(140), { marker: 'burst' })
const auditBeforeBurst = await prisma.auditLog.count({
  where: { action: 'site_builder.schedule_activated', entityId: '/the-break' },
})
await Promise.all(Array.from({ length: 8 }, () => ensureSchedulesApplied(minutes(141))))
eq('eight concurrent callers activate it exactly once',
  await prisma.auditLog.count({ where: { action: 'site_builder.schedule_activated', entityId: '/the-break' } }),
  auditBeforeBurst + 1)
eq('and it is live', await liveNumber('/the-break'), burstTarget.number)

// It must never throw into a render path.
resetFallbackState()
let threw = false
try {
  await ensureSchedulesApplied(minutes(200))
} catch {
  threw = true
}
check('the fallback never throws', !threw)

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('What the interface is told')

const entries = await listSchedules(minutes(200))
const states = new Set(entries.map((e) => e.state))
check('the list reports activated revisions', states.has('activated'), [...states].join(', '))
check('and failed ones', states.has('failed'), [...states].join(', '))
check('and cancelled ones', states.has('cancelled'), [...states].join(', '))
check('every time it reports is UTC',
  entries.every((e) => [e.scheduledFor, e.activatedAt, e.cancelledAt, e.expiresAt]
    .filter(Boolean).every((t) => String(t).endsWith('Z'))))
check('no entry leaks anything but page keys and numbers',
  entries.every((e) => !/postgres|password|secret/i.test(JSON.stringify(e))))

// `overdue` is the clock's state, not the row's, so it changes with `now` and nothing else.
const pending = await scheduleFor('/rankings', minutes(500))
const pendingRow = (await prisma.sitePageRevision.findUnique({ where: { id: pending.id } }))!
eq('before its time it reads as scheduled', scheduleStateOf(pendingRow, minutes(499)), 'scheduled')
eq('after its time it reads as overdue', scheduleStateOf(pendingRow, minutes(501)), 'overdue')
eq('and nothing about the row changed', (await prisma.sitePageRevision.findUnique({ where: { id: pending.id } }))!.state, 'SCHEDULED')

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Competition data untouched')

const counts = {
  seasons: await prisma.season.count(),
  ledger: await prisma.ratingLedger.count(),
  entrants: await prisma.seasonEntrant.count(),
  playoffs: await prisma.seasonPlayoffMatch.count(),
}
console.log(`   seasons ${counts.seasons} · ledger ${counts.ledger} · entrants ${counts.entrants} · playoff rows ${counts.playoffs}`)
check('competition data survived the whole suite', counts.seasons > 0 && counts.ledger > 0)
const s16426 = await prisma.season.findUnique({ where: { id: 16426 } })
if (s16426) {
  eq('Season 16426 is still completed', s16426.lifecycleState, 'COMPLETED')
  eq('Season 16426 still records Kevin', s16426.championName, 'Kevin')
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(70)}`)
if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log(`  ✗ ${f}`)
}
console.log(`\n${pass} checks passed, ${failures.length} failed\n`)
await prisma.$disconnect()
process.exit(failures.length ? 1 : 0)
