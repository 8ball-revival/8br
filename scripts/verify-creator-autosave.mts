/**
 * Creator autosave and Save and Exit.
 *
 * Two halves, because the risks are different.
 *
 * The FIRST half drives the autosave state machine directly with explicit time. Autosave's failure
 * modes are all timing: a write on every keystroke, two saves racing so the older lands last, a
 * "Saved" badge from a response that no longer describes the form, a navigation warning for changes
 * already written. None of those can be pinned down by clicking a form — they need a clock you
 * control, which is exactly what the engine exposes.
 *
 * The SECOND half runs against the real database and the real services, and asserts the things a
 * broken Save and Exit would do to actual records: create a second draft, publish something, apply
 * it to the Rankings, or let an unauthorised caller write. Those cannot be established from a state
 * machine, so they are tested where they happen.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-creator-autosave.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { AutosaveEngine, changedFields, DEFAULT_DEBOUNCE_MS } from '../src/lib/creator/autosave-engine.ts'
import { createDraft } from '../src/lib/creator/setup.ts'
import { updateSeasonSettings } from '../src/lib/seasons/service.ts'
import { seasonIsLive, seasonIsArchived } from '../src/lib/competition/lifecycle-rules.ts'
import { listCreatorProjects } from '../src/lib/creator/projects.ts'
import { deleteFixtureAuditRows } from '../src/lib/verification/fixture-actors.ts'

assertLocalDatabase('verify-creator-autosave')

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++ } else { fail++; console.log('  FAIL ' + n + (d ? ` — ${d}` : '')) }
}
const section = (s: string) => console.log(`\n${s}`)

const FIXTURE_SLUG = 'zzauto-competition'
const actor = { userId: 990601, username: 'creator-setup-verify' }

const cleanupErrors: string[] = []
async function cleanup() {
  const strays = await prisma.season.findMany({
    where: { competitionSeries: { slug: FIXTURE_SLUG } }, select: { id: true },
  }).catch(() => [] as { id: number }[])
  for (const { id } of strays) {
    await prisma.season.delete({ where: { id } })
      .catch((e) => cleanupErrors.push(`season ${id}: ${e instanceof Error ? e.message.slice(-160) : String(e)}`))
  }
  await deleteFixtureAuditRows(prisma, [actor.username]).catch(() => {})
  await prisma.competitionSeries.deleteMany({ where: { slug: FIXTURE_SLUG, seasons: { none: {} } } }).catch(() => {})
}

// ── Half one: the state machine, on a clock we control.
type Form = { title: string; description: string }
const engineOf = (initial: Form = { title: 'A', description: '' }) => new AutosaveEngine<Form>(initial)

section('Nothing is written until typing stops')
{
  let t = 0
  const e = engineOf()
  e.change('title', 'AB', t)
  check('a change marks the form dirty', e.snapshot().state === 'dirty')
  check('...and says so', e.snapshot().message === 'Unsaved changes')
  check('nothing is written immediately', e.tick(t) === null)
  check('nor part way through the debounce', e.tick(t + DEFAULT_DEBOUNCE_MS - 1) === null)

  // Each keystroke restarts the clock, so a fast typist produces one write, not twenty.
  t = 500
  e.change('title', 'ABC', t)
  check('a further keystroke restarts the debounce', e.tick(t + DEFAULT_DEBOUNCE_MS - 1) === null)
  const req = e.tick(t + DEFAULT_DEBOUNCE_MS)
  check('the write goes once typing stops', req !== null)
  check('...carrying only what changed', req != null && Object.keys(req.patch).join() === 'title')
  check('...with the newest value, not an intermediate one', req?.patch.title === 'ABC')
  check('the badge reads Saving', e.snapshot().state === 'saving')
}

section('Only what actually changed is written')
{
  const e = engineOf({ title: 'A', description: 'x' })
  e.change('title', 'B', 0)
  const req = e.tick(DEFAULT_DEBOUNCE_MS)
  check('an untouched field is not sent', req != null && !('description' in req.patch))

  check('the diff compares rendered values',
    Object.keys(changedFields({ a: 1 }, { a: '1' })).length === 0)
  check('...and still catches a real difference',
    Object.keys(changedFields({ a: 2 }, { a: 1 })).join() === 'a')
}

section('Typing a value back produces no write at all')
{
  const e = engineOf({ title: 'A', description: '' })
  e.change('title', 'AB', 0)
  e.change('title', 'A', 100)
  check('the form is no longer dirty', !e.snapshot().dirty)
  check('nothing is written', e.tick(10_000) === null)
  check('and no audit row would be manufactured', e.tick(20_000) === null)
}

section('One save at a time, and never out of order')
{
  const e = engineOf()
  e.change('title', 'B', 0)
  const first = e.tick(DEFAULT_DEBOUNCE_MS)!
  check('the first save is issued', first.seq === 1)

  // Typing while the save is running must NOT start a second one.
  e.change('title', 'C', DEFAULT_DEBOUNCE_MS + 10)
  check('a change during a save issues nothing',
    e.tick(DEFAULT_DEBOUNCE_MS * 3) === null)
  check('the badge still reads Saving', e.snapshot().state === 'saving')

  e.settle(first.seq, { ok: true }, DEFAULT_DEBOUNCE_MS * 3)
  check('after it settles the newer change is still pending', e.snapshot().dirty)
  const second = e.tick(DEFAULT_DEBOUNCE_MS * 5)
  check('...and is written next, in order', second !== null && second.seq === 2)
  check('...carrying the newest value', second?.patch.title === 'C')
}

section('A stale response cannot claim the form is saved')
{
  const e = engineOf()
  e.change('title', 'B', 0)
  const first = e.tick(DEFAULT_DEBOUNCE_MS)!
  e.settle(first.seq, { ok: true }, DEFAULT_DEBOUNCE_MS)
  e.change('title', 'C', 2000)
  const second = e.tick(2000 + DEFAULT_DEBOUNCE_MS)!

  // The FIRST response arrives late, after a newer save was issued.
  e.settle(first.seq, { ok: true }, 5000)
  check('the late response does not say Saved', e.snapshot().state === 'saving')
  check('...and does not clear the pending change', e.snapshot().dirty)

  e.settle(second.seq, { ok: true }, 5100)
  check('the current response does say Saved', e.snapshot().state === 'saved')
  check('...and the form is clean', !e.snapshot().dirty)
}

section('A failed save keeps what was typed')
{
  const e = engineOf()
  e.change('title', 'B', 0)
  const req = e.tick(DEFAULT_DEBOUNCE_MS)!
  e.settle(req.seq, { ok: false, error: 'Server said no.' }, DEFAULT_DEBOUNCE_MS)

  check('the badge reads Save failed', e.snapshot().state === 'error')
  check('...with the reason', e.snapshot().error === 'Server said no.')
  check('the typed value is still on the form', e.values().title === 'B')
  check('the form is still dirty, so nothing looks persisted', e.snapshot().dirty)

  const retry = e.retry()
  check('retry re-issues the write immediately', retry !== null)
  check('...carrying the same value', retry?.patch.title === 'B')
  e.settle(retry!.seq, { ok: true }, 9000)
  check('a successful retry clears the error', e.snapshot().error === null)
  check('...and reads Saved', e.snapshot().state === 'saved')
}

section('Save and Exit flushes rather than waiting for the timer')
{
  const e = engineOf()
  e.change('title', 'B', 0)
  const flushed = e.flush()
  check('flush writes without waiting for the debounce', flushed !== null)
  check('...carrying the pending value', flushed?.patch.title === 'B')
  e.settle(flushed!.seq, { ok: true }, 1)
  check('...and the form is clean afterwards', !e.snapshot().dirty)
  check('flushing a clean form writes nothing', e.flush() === null)
}

section('The navigation warning fires only for genuinely unsaved work')
{
  const e = engineOf()
  check('a clean form does not warn', !e.shouldWarnOnLeave())
  e.change('title', 'B', 0)
  check('unsaved typing warns', e.shouldWarnOnLeave())
  const req = e.flush()!
  e.settle(req.seq, { ok: true }, 1)
  check('once confirmed it stops warning', !e.shouldWarnOnLeave())

  // A save in flight has NOT been confirmed and can still fail, so it counts as unsaved. Leaving
  // mid-flight can abandon the request; the warning is the only thing standing between that and
  // silently losing the edit.
  e.change('title', 'C', 100)
  const inflight = e.flush()!
  check('a change still in flight warns, because it can still fail', e.shouldWarnOnLeave())
  e.settle(inflight.seq, { ok: true }, 200)
  check('once the server confirms it, the warning stops', !e.shouldWarnOnLeave())

  // A failed save must keep warning: that is precisely the case where leaving loses the work.
  e.change('title', 'D', 300)
  const doomed = e.flush()!
  e.settle(doomed.seq, { ok: false, error: 'nope' }, 400)
  check('a failed save keeps warning', e.shouldWarnOnLeave())
}

section('A refresh restores the last CONFIRMED values, not the typed ones')
{
  const e = engineOf({ title: 'A', description: '' })
  e.change('title', 'B', 0)
  const req = e.flush()!
  e.settle(req.seq, { ok: true }, 1)
  e.change('title', 'C-unsaved', 100)
  check('the confirmed record holds the saved value', e.confirmedValues().title === 'B')
  check('...not the one still being typed', e.confirmedValues().title !== 'C-unsaved')
}

// ── Half two: the real records.
async function main() {
  await cleanup()
  const comp = await prisma.competitionSeries.upsert({
    where: { slug: FIXTURE_SLUG },
    update: {},
    create: { slug: FIXTURE_SLUG, name: 'ZZ Autosave Fixture', shortName: 'ZZA', active: true },
    select: { id: true },
  })

  const made = await createDraft(actor, {
    type: 'season', competitionYear: 1991, competitionSeriesId: comp.id,
    purpose: 'reconstruction', structure: 'groups_playoffs', title: 'ZZAUTO Draft',
  })
  if (!made.ok || made.id == null) throw new Error(`could not create the draft: ${made.error}`)
  const id = made.id

  section('Autosave writes to the one canonical draft, never a new record')
  const before = await prisma.season.count()
  for (const title of ['ZZAUTO one', 'ZZAUTO two', 'ZZAUTO three']) {
    const r = await updateSeasonSettings(actor, id, { subtitle: title })
    check(`saving "${title}" succeeded`, r.ok, r.error ?? '')
  }
  const after = await prisma.season.count()
  check('no extra Season was created by repeated saves', after === before, `${before} -> ${after}`)
  const row = await prisma.season.findUniqueOrThrow({
    where: { id },
    select: {
      subtitle: true, lifecycleState: true, publiclyVisible: true, reconstruction: true,
      ladderAppliedAt: true, _count: { select: { entrants: true, groups: true, ratingLedger: true } },
    },
  })
  check('the last write is the one that stuck', row.subtitle === 'ZZAUTO three', String(row.subtitle))

  section('Saving a draft publishes nothing')
  check('still a reconstruction', row.reconstruction === true)
  check('still not publicly visible', row.publiclyVisible === false)
  check('not Live', !seasonIsLive(
    { lifecycleState: row.lifecycleState, reconstruction: row.reconstruction }, row.publiclyVisible))
  check('not Archived', !seasonIsArchived({
    lifecycleState: row.lifecycleState, ladderAppliedAt: row.ladderAppliedAt, reopenedAt: null,
  }))
  check('nothing applied to the Rankings', row._count.ratingLedger === 0)
  check('no entrants or groups invented by saving', row._count.entrants === 0 && row._count.groups === 0)

  section('The saved draft is on the Creator dashboard, in its own phase')
  const projects = await listCreatorProjects()
  const mine = projects.find((p) => p.kind === 'season' && p.id === id)
  check('the draft appears on the dashboard', mine != null)
  check('...under a working bucket, not Completed',
    mine != null && mine.bucket !== 'completed', String(mine?.bucket))
  check('...showing the saved title', mine?.title === 'ZZAUTO three', String(mine?.title))
  check('...with no public link, because nothing was published', mine?.publicHref == null)
  check('...and its Creator link returns to the same record', mine?.href === `/creator/seasons/${id}`)

  section('Reopening the draft restores what was saved')
  const reopened = await prisma.season.findUniqueOrThrow({
    where: { id }, select: { subtitle: true, competitionYear: true, division: true, lifecycleState: true },
  })
  check('the title survives a reload', reopened.subtitle === 'ZZAUTO three')
  check('the competition year survives', reopened.competitionYear === 1991)
  check('the workflow phase is preserved', reopened.lifecycleState === row.lifecycleState)

  section('An unchanged save is still refused the chance to corrupt anything')
  const noop = await updateSeasonSettings(actor, id, { subtitle: 'ZZAUTO three' })
  check('re-saving the same value succeeds harmlessly', noop.ok)
  const stillOne = await prisma.season.count({ where: { subtitle: 'ZZAUTO three' } })
  check('and still exactly one record holds it', stillOne === 1, String(stillOne))

  section('Authorisation is enforced by the server action, not the form')
  const actionSource = (await import('node:fs')).readFileSync('src/lib/seasons/actions.ts', 'utf8')
  const idx = actionSource.indexOf('export async function updateSeasonSettingsAction')
  const body = actionSource.slice(idx, idx + 400)
  check('the save action checks a capability before writing',
    body.includes("requireCapability('manage_competitions')"))
  check('...before calling the service',
    body.indexOf('requireCapability') < body.indexOf('updateSeasonSettings(actor'))
}

let exitCode = 0
try {
  await main()
} catch (e) {
  fail++
  console.log('\nFATAL ' + (e instanceof Error ? e.message : String(e)))
} finally {
  await cleanup()
  if (cleanupErrors.length) {
    fail++
    console.log('\nCLEANUP LEFT RECORDS BEHIND:')
    for (const e of cleanupErrors) console.log('  ' + e)
  }
  const left = await prisma.season.count({ where: { competitionSeries: { slug: FIXTURE_SLUG } } }).catch(() => -1)
  check('fixture Seasons cleaned up', left === 0, String(left))

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  exitCode = fail === 0 ? 0 : 1
  await prisma.$disconnect()
}
process.exit(exitCode)
