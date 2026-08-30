import 'server-only'

/**
 * Scheduled publication.
 *
 * ── One service, two triggers ────────────────────────────────────────────────────────────────────
 * Everything below is driven by `runDueSchedules`. The cron endpoint calls it; the request-time
 * fallback calls it; the verification suite calls it. There is deliberately no second code path
 * that "also publishes" — a scheduler with two implementations is a scheduler where one of them is
 * subtly wrong and nobody notices until the wrong one runs at three in the morning.
 *
 * ── Why the request-time fallback exists at all ──────────────────────────────────────────────────
 * A cron is a promise made by the platform. It can be misconfigured, disabled during an incident,
 * or simply not exist on whatever this is deployed to next. The fallback means the worst case for a
 * missing cron is "the announcement appears when somebody next loads the page" rather than "the
 * announcement never appears and nobody finds out until it is discussed in a meeting".
 *
 * It is cheap by construction: after each sweep the service records when the next revision is
 * actually due, and does no database work at all until that moment arrives.
 *
 * ── Why each revision gets its own transaction ───────────────────────────────────────────────────
 * A sweep publishes a set of unrelated things. One of them failing — a module removed from the
 * registry since it was scheduled, a document that no longer validates — must not take the others
 * with it. So the sweep is a loop of independent transactions rather than one big one, and a
 * failure is recorded against the revision that caused it.
 *
 * ── Concurrency ──────────────────────────────────────────────────────────────────────────────────
 * Two cron invocations can overlap, and a cron can overlap the request fallback. Each activation
 * claims its revision with `SELECT ... FOR UPDATE SKIP LOCKED` inside the transaction, and re-reads
 * the state under that lock before doing anything. A second caller either skips the row (locked) or
 * finds it no longer SCHEDULED (already done) — so it can neither double-publish nor write a second
 * audit entry. The audit write is inside the same transaction as the state change, which is what
 * makes that guarantee hold rather than merely being likely.
 */

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from '@/lib/competition/audit'
import { validateDocument } from './document'
import { revalidateForKey } from './service'

/** The actor recorded against an unattended activation. */
export const SCHEDULER_ACTOR: Actor = { userId: 0, username: 'scheduler' }

export type ActivationStatus = 'activated' | 'failed' | 'expired' | 'skipped'

export interface Activation {
  pageKey: string
  pageTitle: string
  revisionNumber: number
  status: ActivationStatus
  /** Present on `failed`. The validator's own words — never anything from the environment. */
  error?: string
  /** When it was due, so a late activation is visible as a late activation. */
  scheduledFor?: string
}

export interface SweepResult {
  ranAt: string
  trigger: 'cron' | 'request' | 'manual'
  /** How many due revisions were considered, before locking. */
  considered: number
  activations: Activation[]
  /** ISO timestamp of the next revision due after this sweep, or null if none is pending. */
  nextDueAt: string | null
}

/**
 * Publish every revision whose time has come.
 *
 * `now` is injectable so the tests can stand exactly on a boundary. Everything compared here is a
 * `Date`, which Prisma maps to `timestamptz`, so the comparison happens in UTC regardless of the
 * server's zone — the display layer is the only place a local zone appears.
 */
export async function runDueSchedules(options: {
  now?: Date
  trigger?: SweepResult['trigger']
} = {}): Promise<SweepResult> {
  const now = options.now ?? new Date()
  const trigger = options.trigger ?? 'manual'

  /*
    Candidates are selected by the server from the state of the database. Nothing about which
    revision to publish can come from a caller — that is the difference between "run the schedule"
    and "publish this for me", and only the first one is safe to expose on an endpoint.
  */
  const due = await prisma.sitePageRevision.findMany({
    where: { state: 'SCHEDULED', scheduledFor: { lte: now } },
    orderBy: { scheduledFor: 'asc' },
    select: { id: true, number: true, scheduledFor: true, pageId: true },
    take: 200,
  })

  const activations: Activation[] = []
  const touchedKeys = new Set<string>()

  for (const candidate of due) {
    const outcome = await activateOne(candidate.id, now)
    if (outcome) {
      activations.push(outcome)
      if (outcome.status === 'activated') touchedKeys.add(outcome.pageKey)
    }
  }

  // Expiry is the other half of a schedule: a revision with an `expiresAt` in the past reverts to
  // whatever it replaced, so "show this until the season starts" does not need a second reminder.
  for (const expired of await findExpired(now)) {
    const outcome = await expireOne(expired.pageId, now)
    if (outcome) {
      activations.push(outcome)
      if (outcome.status === 'expired') touchedKeys.add(outcome.pageKey)
    }
  }

  /*
    Cache invalidation happens after every transaction has committed, once per affected page.

    Inside the loop it would advertise a layout while later revisions in the same sweep were still
    being written, and a visitor arriving in that window could see two different versions of the
    site in one page load — the new navigation with the old footer.
  */
  for (const key of touchedKeys) await revalidateForKey(key)

  return {
    ranAt: now.toISOString(),
    trigger,
    considered: due.length,
    activations,
    nextDueAt: (await nextDue(now))?.toISOString() ?? null,
  }
}

/**
 * Activate one revision, or explain why not.
 *
 * Returns null when there was nothing to do — the row was claimed by another caller, or had already
 * moved on. That is a successful outcome, not a failure, and it must not appear in the report as
 * one: a cron that overlaps itself would otherwise look like a cron that is going wrong.
 */
async function activateOne(revisionId: string, now: Date): Promise<Activation | null> {
  return prisma.$transaction(async (tx) => {
    /*
      The claim.

      `FOR UPDATE SKIP LOCKED` rather than a plain read: two overlapping sweeps must not queue up
      behind each other on the same row and then both proceed once the lock is released. The second
      one skips it entirely and gets on with the rest of its work.

      ── Why the time is NOT in this query ──────────────────────────────────────────────────────
      It was, and the whole scheduler silently did nothing.

      `scheduledFor` is `timestamp(3)` — naive, no zone, which is what Prisma's Postgres provider
      writes for a `DateTime`. A JS `Date` bound into a raw query arrives as `timestamptz`. Comparing
      the two makes Postgres read the stored naive value in the SESSION zone, so a revision stored as
      12:10 was compared as 12:10 America/Phoenix — 19:10 UTC — and was never due. Prisma's own query
      builder is self-consistent, which is exactly why `findMany` above found the row and the raw
      claim beneath it did not.

      So the raw statement now does only what raw SQL is needed for: take the row lock. Which rows
      are due is decided by `findMany` above and re-confirmed in TypeScript below, where both sides
      are `Date` objects the driver parsed the same way.
    */
    const claimed = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id"
      FROM "site_page_revision"
      WHERE "id" = ${revisionId} AND "state" = 'SCHEDULED'
      FOR UPDATE SKIP LOCKED
    `
    if (!claimed.length) return null

    const revision = await tx.sitePageRevision.findUnique({
      where: { id: revisionId },
      include: { page: true },
    })
    // Re-confirmed under the lock, in TypeScript. The row could have been rescheduled into the
    // future between the sweep's `findMany` and this lock, and activating it then would publish
    // something ahead of the time somebody deliberately moved it to.
    if (!revision || revision.state !== 'SCHEDULED') return null
    if (!revision.scheduledFor || revision.scheduledFor > now) return null

    const page = revision.page
    const base: Omit<Activation, 'status'> = {
      pageKey: page.key,
      pageTitle: page.title,
      revisionNumber: revision.number,
      scheduledFor: revision.scheduledFor?.toISOString(),
    }

    /*
      Validated again, here, under the lock.

      The document was validated when it was scheduled, but that could have been a week ago and the
      module registry travels with the code. A deploy that removed a module between the schedule and
      its due time would otherwise publish a layout the renderer has to fall back on — unattended,
      with nobody watching.
    */
    const check = validateDocument(revision.document)
    if (!check.ok) {
      const reason = check.issues.slice(0, 3).map((i) => `${i.path} — ${i.message}`).join('; ')
      await tx.sitePageRevision.update({
        where: { id: revision.id },
        data: { state: 'FAILED', activationError: reason.slice(0, 500), scheduledFor: null },
      })
      await recordAudit(SCHEDULER_ACTOR, {
        action: 'site_builder.schedule_failed',
        entity: 'SitePage',
        entityId: page.key,
        newValue: { revision: revision.number, reason: reason.slice(0, 500) },
      }, tx)
      // The page keeps whatever it was already publishing. Nothing about the live site changed.
      return { ...base, status: 'failed' as const, error: reason }
    }

    const previousRevisionId = page.publishedRevisionId
    await tx.sitePageRevision.update({
      where: { id: revision.id },
      data: {
        state: 'PUBLISHED',
        activatedAt: now,
        scheduledFor: null,
        activationError: null,
        previousRevisionId,
      },
    })
    await tx.sitePage.update({
      where: { id: page.id },
      data: { publishedRevisionId: revision.id },
    })
    await recordAudit(SCHEDULER_ACTOR, {
      action: 'site_builder.schedule_activated',
      entity: 'SitePage',
      entityId: page.key,
      oldValue: { revisionId: previousRevisionId },
      newValue: {
        revision: revision.number,
        dueAt: revision.scheduledFor?.toISOString() ?? null,
        activatedAt: now.toISOString(),
      },
    }, tx)

    return { ...base, status: 'activated' as const }
  }).catch(async (err) => {
    /*
      A transaction that threw for a reason validation did not catch — a deadlock, a connection
      dropped mid-write. The revision is untouched because the transaction rolled back, so the next
      sweep will try it again. It is reported rather than swallowed, but not marked FAILED: a
      transient database fault is not a broken document, and marking it would stop a schedule that
      is perfectly capable of publishing five minutes later.
    */
    const revision = await prisma.sitePageRevision.findUnique({
      where: { id: revisionId },
      include: { page: true },
    })
    return {
      pageKey: revision?.page.key ?? '(unknown)',
      pageTitle: revision?.page.title ?? '(unknown)',
      revisionNumber: revision?.number ?? 0,
      status: 'skipped' as const,
      error: err instanceof Error ? err.message.slice(0, 300) : 'The activation could not be completed.',
    }
  })
}

/** Pages whose currently published revision has an expiry in the past. */
async function findExpired(now: Date): Promise<{ pageId: string }[]> {
  const rows = await prisma.sitePage.findMany({
    where: {
      publishedRevision: { expiresAt: { lte: now }, state: 'PUBLISHED' },
    },
    select: { id: true },
    take: 200,
  })
  return rows.map((r) => ({ pageId: r.id }))
}

/**
 * Revert a page whose published revision has expired.
 *
 * Reverting means pointing at `previousRevisionId` — the revision this one replaced — rather than
 * at "the newest other revision", which would resurrect something that was itself rolled back. If
 * there is no predecessor, or the predecessor no longer validates, the page keeps what it has:
 * an expiry is a preference, and honouring it by breaking the page would be the wrong trade.
 */
async function expireOne(pageId: string, now: Date): Promise<Activation | null> {
  return prisma.$transaction(async (tx) => {
    /*
      Lock the page row and nothing else — see the note in `activateOne` about why no timestamp goes
      into a raw comparison here. Whether the expiry has actually passed is settled in TypeScript
      immediately below, against the `Date` Prisma parsed.
    */
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "site_page" WHERE "id" = ${pageId}
      FOR UPDATE SKIP LOCKED
    `
    if (!locked.length) return null

    const page = await tx.sitePage.findUnique({ where: { id: pageId }, include: { publishedRevision: true } })
    const current = page?.publishedRevision
    if (!page || !current || !current.expiresAt || current.expiresAt > now) return null

    const base = { pageKey: page.key, pageTitle: page.title, revisionNumber: current.number }

    if (!current.previousRevisionId) {
      // Nothing to fall back to. Clear the expiry so the sweep does not reconsider it every minute
      // for the rest of the site's life, and say so in the audit trail.
      await tx.sitePageRevision.update({ where: { id: current.id }, data: { expiresAt: null } })
      await recordAudit(SCHEDULER_ACTOR, {
        action: 'site_builder.schedule_expiry_skipped',
        entity: 'SitePage',
        entityId: page.key,
        newValue: { revision: current.number, reason: 'there is no earlier revision to revert to' },
      }, tx)
      return { ...base, status: 'skipped' as const, error: 'no earlier revision to revert to' }
    }

    const previous = await tx.sitePageRevision.findUnique({ where: { id: current.previousRevisionId } })
    if (!previous || !validateDocument(previous.document).ok) {
      await tx.sitePageRevision.update({ where: { id: current.id }, data: { expiresAt: null } })
      await recordAudit(SCHEDULER_ACTOR, {
        action: 'site_builder.schedule_expiry_skipped',
        entity: 'SitePage',
        entityId: page.key,
        newValue: { revision: current.number, reason: 'the earlier revision no longer validates' },
      }, tx)
      return { ...base, status: 'skipped' as const, error: 'the earlier revision no longer validates' }
    }

    await tx.sitePage.update({ where: { id: page.id }, data: { publishedRevisionId: previous.id } })
    await tx.sitePageRevision.update({
      where: { id: current.id },
      data: { state: 'ARCHIVED', expiresAt: null },
    })
    await recordAudit(SCHEDULER_ACTOR, {
      action: 'site_builder.schedule_expired',
      entity: 'SitePage',
      entityId: page.key,
      oldValue: { revision: current.number },
      newValue: { revision: previous.number, expiredAt: now.toISOString() },
    }, tx)

    return { ...base, status: 'expired' as const, revisionNumber: previous.number }
  }).catch(() => null)
}

/** When the next pending revision is due, for the fallback's own scheduling. */
async function nextDue(now: Date): Promise<Date | null> {
  const [pending, expiring] = await Promise.all([
    prisma.sitePageRevision.findFirst({
      where: { state: 'SCHEDULED', scheduledFor: { gt: now } },
      orderBy: { scheduledFor: 'asc' },
      select: { scheduledFor: true },
    }),
    prisma.sitePageRevision.findFirst({
      where: { state: 'PUBLISHED', expiresAt: { gt: now } },
      orderBy: { expiresAt: 'asc' },
      select: { expiresAt: true },
    }),
  ])
  const times = [pending?.scheduledFor, expiring?.expiresAt].filter((d): d is Date => !!d)
  if (!times.length) return null
  return times.reduce((a, b) => (a < b ? a : b))
}

// ── The request-time fallback ───────────────────────────────────────────────────────────────────

/**
 * State that lives for as long as this server process does.
 *
 * `nextCheckAt` is the whole reason this is cheap. After a sweep the service knows when the next
 * revision is due, so between now and then there is nothing to look for and it does no database
 * work at all. A site with no schedules pending pays exactly one query per process, ever.
 *
 * `inFlight` coalesces: a burst of concurrent requests on a cold process runs one sweep between
 * them, not one each.
 */
const state: { nextCheckAt: number; inFlight: Promise<void> | null } = {
  nextCheckAt: 0,
  inFlight: null,
}

/** The longest this will go without looking, even when it believes nothing is due. */
const MAX_QUIET_MS = 5 * 60 * 1000

/** Exported for the tests, which need a process that has not already decided it is up to date. */
export function resetFallbackState(): void {
  state.nextCheckAt = 0
  state.inFlight = null
}

/**
 * Activate anything overdue before the caller reads published content.
 *
 * Never throws. This runs on a render path, and a scheduler fault must degrade to "the schedule is
 * a little late" rather than to a page that will not render — the published site working is worth
 * more than the schedule being punctual.
 */
export async function ensureSchedulesApplied(now: Date = new Date()): Promise<void> {
  const t = now.getTime()
  if (t < state.nextCheckAt) return
  if (state.inFlight) return state.inFlight

  state.inFlight = (async () => {
    try {
      const result = await runDueSchedules({ now, trigger: 'request' })
      const next = result.nextDueAt ? Date.parse(result.nextDueAt) : Number.POSITIVE_INFINITY
      state.nextCheckAt = Math.min(next, t + MAX_QUIET_MS)
      if (result.activations.length) {
        console.info('[site-builder] request-time schedule sweep', {
          activated: result.activations.filter((a) => a.status === 'activated').map((a) => `${a.pageKey}#${a.revisionNumber}`),
          failed: result.activations.filter((a) => a.status === 'failed').map((a) => `${a.pageKey}#${a.revisionNumber}`),
        })
      }
    } catch (err) {
      /*
        Back off rather than retry on every request.

        A database that is refusing connections would otherwise turn every page view into another
        failed sweep, which is how a small fault becomes a large one.
      */
      state.nextCheckAt = t + MAX_QUIET_MS
      console.error('[site-builder] the request-time schedule sweep failed', err)
    } finally {
      state.inFlight = null
    }
  })()

  return state.inFlight
}

// ── Reading schedules, for the interface ────────────────────────────────────────────────────────

export type ScheduleState = 'scheduled' | 'overdue' | 'activated' | 'failed' | 'cancelled'

export interface ScheduleEntry {
  pageKey: string
  pageTitle: string
  revisionNumber: number
  state: ScheduleState
  /** Always UTC on the wire. The interface renders it in the reader's own zone. */
  scheduledFor: string | null
  expiresAt: string | null
  activatedAt: string | null
  cancelledAt: string | null
  cancelledBy: string | null
  error: string | null
  summary: string | null
}

/**
 * Every schedule worth showing: pending, overdue, recently activated, failed, cancelled.
 *
 * Recent history is included rather than only what is pending, because "did last night's schedule
 * go out?" is the question this list mostly exists to answer.
 */
export async function listSchedules(now: Date = new Date(), sinceDays = 30): Promise<ScheduleEntry[]> {
  const since = new Date(now.getTime() - sinceDays * 86_400_000)
  const rows = await prisma.sitePageRevision.findMany({
    where: {
      OR: [
        { state: 'SCHEDULED' },
        { state: 'FAILED', publishedAt: { gte: since } },
        { activatedAt: { gte: since } },
        { cancelledAt: { gte: since } },
      ],
    },
    include: { page: { select: { key: true, title: true } } },
    orderBy: [{ scheduledFor: 'asc' }, { publishedAt: 'desc' }],
    take: 100,
  })

  return rows.map((r) => ({
    pageKey: r.page.key,
    pageTitle: r.page.title,
    revisionNumber: r.number,
    state: scheduleStateOf(r, now),
    scheduledFor: r.scheduledFor?.toISOString() ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    activatedAt: r.activatedAt?.toISOString() ?? null,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    cancelledBy: r.cancelledByUsername,
    error: r.activationError,
    summary: r.summary,
  }))
}

/**
 * Which of the five words describes this revision.
 *
 * `overdue` is derived rather than stored: it is not a state the database is ever in, it is a state
 * the CLOCK is in, and storing it would mean something had to write the row the moment it lapsed.
 */
export function scheduleStateOf(
  revision: { state: string; scheduledFor: Date | null; activatedAt: Date | null; cancelledAt: Date | null },
  now: Date,
): ScheduleState {
  if (revision.cancelledAt) return 'cancelled'
  if (revision.state === 'FAILED') return 'failed'
  if (revision.state === 'SCHEDULED') {
    return revision.scheduledFor && revision.scheduledFor <= now ? 'overdue' : 'scheduled'
  }
  if (revision.activatedAt) return 'activated'
  return 'scheduled'
}

export type { Prisma }
