'use server'

/**
 * Every write the builder can perform.
 *
 * ── The rule, without exception ──────────────────────────────────────────────────────────────────
 * Each action begins with `requireCapability('manage_site_builder')`. Not one of them trusts that
 * the caller reached a page that checked, or that the Edit Mode toggle was on, or that the UI would
 * not have offered the button. A server action is a public HTTP endpoint with a generated name — the
 * only thing standing between it and an anonymous request is the check on its first line.
 *
 * The actions return `{ ok }` results rather than throwing across the boundary. A thrown error in a
 * server action reaches the client as a generic digest with the message stripped in production, so
 * "this page was changed in another tab" would arrive as "an error occurred" — which is precisely
 * the case where the administrator most needs to be told what actually happened.
 */

import { revalidatePath } from 'next/cache'

import { requireCapability } from '@/lib/competition/staff-auth'
import { recordAudit } from '@/lib/competition/audit'
import { prisma } from '@/lib/prisma'
import {
  ConflictError, bootstrap, discardDraft, getDraft, publish, resetToFactory, rollback, saveDraft,
} from './service'
import { validateDocument } from './document'
import type { LayoutDocument } from './document'
import { playerRefsIn } from './player-refs'
import { danglingPlayerIds } from '@/lib/players/picker-search'
import { getModule } from './registry'

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: string; conflictVersion?: number }

function fail(error: string, conflictVersion?: number): ActionResult<never> {
  return { ok: false, error, conflictVersion }
}

/** Wrap an action so an unexpected throw becomes a readable message instead of a digest. */
async function guarded<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ConflictError) {
      return { ok: false, error: err.message, conflictVersion: err.currentVersion }
    }
    const message = err instanceof Error ? err.message : 'Something went wrong.'
    console.error('[site-builder] action failed', err)
    return { ok: false, error: message }
  }
}

// ── Draft lifecycle ─────────────────────────────────────────────────────────────────────────────

export async function saveDraftAction(
  key: string,
  document: LayoutDocument,
  expectedVersion: number,
): Promise<ActionResult<{ version: number; issues: number }>> {
  return guarded(async () => {
    const actor = await requireCapability('manage_site_builder')
    const unknownPlayer = await newlyBrokenPlayerRef(key, document)
    if (unknownPlayer) return fail(unknownPlayer)
    const result = await saveDraft(key, document, expectedVersion, actor)
    return { ok: true, data: result }
  })
}

/**
 * A player reference this save INTRODUCES that names nobody, described for the editor.
 *
 * ── Why only the new ones ───────────────────────────────────────────────────────────────────────
 * Checking every reference would mean a player deleted last week wedges the whole page: the
 * document is saved as one object, so one stale id in one module would block every unrelated edit
 * on the page, including the edit that would have fixed it. And a config written before this field
 * existed must keep working untouched, which is the compatibility promise.
 *
 * So the rule is narrower and enforceable: whatever is already stored is left alone and flagged in
 * the picker, while a reference that was not there a moment ago has to name a real player. The
 * picker cannot produce a bad one, so this is the guard for everything that does not come from the
 * picker — a crafted request, a pasted document, an import.
 *
 * Costs one keyed query, and only when the incoming document mentions a player at all.
 */
async function newlyBrokenPlayerRef(key: string, document: LayoutDocument): Promise<string | null> {
  const incoming = playerRefsIn(document)
  if (incoming.length === 0) return null

  const stored = await getDraft(key)
  const before = new Set(stored ? playerRefsIn(stored.document).map((r) => r.playerId) : [])
  const added = [...new Set(incoming.map((r) => r.playerId))].filter((id) => !before.has(id))
  if (added.length === 0) return null

  const missing = new Set(await danglingPlayerIds(added))
  if (missing.size === 0) return null

  const ref = incoming.find((r) => missing.has(r.playerId))
  const where = ref ? getModule(ref.moduleType)?.name ?? ref.moduleType : 'a module'
  return `${where} refers to a player who does not exist. Choose one from the search instead.`
}

export async function publishAction(key: string, summary?: string): Promise<ActionResult<{ revisionNumber: number }>> {
  return guarded(async () => {
    const actor = await requireCapability('manage_site_builder')
    const result = await publish(key, actor, summary)
    return { ok: true, data: { revisionNumber: result.revisionNumber } }
  })
}

export async function discardDraftAction(key: string): Promise<ActionResult> {
  return guarded(async () => {
    const actor = await requireCapability('manage_site_builder')
    await discardDraft(key, actor)
    return { ok: true }
  })
}

export async function rollbackAction(key: string, revisionNumber: number): Promise<ActionResult<{ revisionNumber: number }>> {
  return guarded(async () => {
    const actor = await requireCapability('manage_site_builder')
    const result = await rollback(key, revisionNumber, actor)
    return { ok: true, data: result }
  })
}

export async function resetToFactoryAction(key: string): Promise<ActionResult> {
  return guarded(async () => {
    const actor = await requireCapability('manage_site_builder')
    await resetToFactory(key, actor)
    return { ok: true }
  })
}

export async function bootstrapAction(): Promise<ActionResult<{ created: string[]; skipped: string[] }>> {
  return guarded(async () => {
    const actor = await requireCapability('manage_site_builder')
    const result = await bootstrap(actor)
    // `/staff/site-builder`, not `/admin/…`: the route moved and this line did not follow it, so
    // the control centre kept showing "not bootstrapped" until something else revalidated it.
    revalidatePath('/staff/site-builder')
    return { ok: true, data: result }
  })
}

/** The draft, for the editor to load. A READ, and it is capability-checked exactly like a write —
 *  draft content is unpublished work and is not public. */
export async function getDraftAction(key: string): Promise<ActionResult<{ document: LayoutDocument; version: number; dirty: boolean }>> {
  return guarded(async () => {
    await requireCapability('manage_site_builder')
    const draft = await getDraft(key)
    if (!draft) return fail(`No editable page is registered for "${key}".`)
    return { ok: true, data: draft }
  })
}

// ── Scheduling ──────────────────────────────────────────────────────────────────────────────────

/**
 * Schedule the current draft to publish later, and optionally to expire.
 *
 * The revision is created immediately in the SCHEDULED state rather than at the appointed time.
 * That means the document is frozen and validated at the moment the administrator scheduled it, so
 * a later edit to the draft cannot change what was scheduled, and the scheduler's job is only to
 * flip a pointer rather than to build and validate a document unattended.
 */
export async function scheduleAction(
  key: string,
  scheduledFor: string,
  expiresAt?: string,
): Promise<ActionResult<{ revisionNumber: number }>> {
  return guarded(async () => {
    const actor = await requireCapability('manage_site_builder')
    const when = Date.parse(scheduledFor)
    if (Number.isNaN(when)) return fail('That publish date could not be read.')
    if (expiresAt && Number.isNaN(Date.parse(expiresAt))) return fail('That expiry date could not be read.')
    if (expiresAt && Date.parse(expiresAt) <= when) return fail('The expiry must be after the publish time.')

    const page = await prisma.sitePage.findUnique({ where: { key }, include: { draft: true } })
    if (!page?.draft) return fail('There is nothing to schedule: this page has no draft.')

    const check = validateDocument(page.draft.document)
    if (!check.ok) return fail('This layout cannot be scheduled until its settings are valid.')

    const last = await prisma.sitePageRevision.findFirst({
      where: { pageId: page.id }, orderBy: { number: 'desc' }, select: { number: true },
    })
    const revision = await prisma.sitePageRevision.create({
      data: {
        pageId: page.id,
        number: (last?.number ?? 0) + 1,
        document: check.value as never,
        state: 'SCHEDULED',
        summary: `Scheduled for ${new Date(when).toISOString()}`,
        previousRevisionId: page.publishedRevisionId,
        publishedById: actor.userId,
        publishedByUsername: actor.username,
        scheduledFor: new Date(when),
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    })
    await recordAudit(actor, {
      action: 'site_builder.schedule',
      entity: 'SitePage',
      entityId: key,
      newValue: { revision: revision.number, scheduledFor, expiresAt: expiresAt ?? null },
    })
    return { ok: true, data: { revisionNumber: revision.number } }
  })
}

export async function cancelScheduleAction(key: string, revisionNumber: number): Promise<ActionResult> {
  return guarded(async () => {
    const actor = await requireCapability('manage_site_builder')
    const page = await prisma.sitePage.findUnique({ where: { key } })
    if (!page) return fail(`No editable page is registered for "${key}".`)
    /*
      Archived rather than deleted, and stamped rather than merely archived.

      A cancelled schedule is a thing that happened, so the audit trail should be able to point at
      the document that was going to publish. `cancelledAt` is what lets the interface say
      "cancelled" rather than "archived": ARCHIVED alone cannot tell somebody calling it off from a
      revision that was superseded, and those two need different words in front of an administrator.

      `updateMany` with the state in the WHERE clause is deliberate. It makes this a no-op when the
      scheduler has already activated the revision, rather than a race that un-publishes something
      that is live.
    */
    const cancelled = await prisma.sitePageRevision.updateMany({
      where: { pageId: page.id, number: revisionNumber, state: 'SCHEDULED' },
      data: {
        state: 'ARCHIVED',
        scheduledFor: null,
        cancelledAt: new Date(),
        cancelledByUsername: actor.username,
      },
    })
    if (cancelled.count === 0) {
      return fail('That schedule is no longer pending — it has already published, or was cancelled.')
    }
    await recordAudit(actor, {
      action: 'site_builder.cancel_schedule', entity: 'SitePage', entityId: key,
      newValue: { revision: revisionNumber },
    })
    revalidatePath('/staff/site-builder')
    return { ok: true }
  })
}

/**
 * Move a pending schedule to a different time.
 *
 * Deliberately NOT "cancel and re-schedule": that would freeze the CURRENT draft, which may have
 * moved on since the schedule was set. Rescheduling keeps the document exactly as it was frozen and
 * changes only when it goes out — which is what an administrator means when they say "make that
 * Tuesday instead".
 */
export async function rescheduleAction(
  key: string,
  revisionNumber: number,
  scheduledFor: string,
  expiresAt?: string | null,
): Promise<ActionResult<{ scheduledFor: string }>> {
  return guarded(async () => {
    const actor = await requireCapability('manage_site_builder')
    const when = Date.parse(scheduledFor)
    if (Number.isNaN(when)) return fail('That publish date could not be read.')
    if (expiresAt && Number.isNaN(Date.parse(expiresAt))) return fail('That expiry date could not be read.')
    if (expiresAt && Date.parse(expiresAt) <= when) return fail('The expiry must be after the publish time.')

    const page = await prisma.sitePage.findUnique({ where: { key } })
    if (!page) return fail(`No editable page is registered for "${key}".`)

    const existing = await prisma.sitePageRevision.findUnique({
      where: { pageId_number: { pageId: page.id, number: revisionNumber } },
      select: { state: true, scheduledFor: true },
    })
    if (!existing) return fail(`Revision ${revisionNumber} does not exist for this page.`)
    if (existing.state !== 'SCHEDULED') {
      return fail('Only a pending schedule can be moved. This one has already published or was cancelled.')
    }

    const moved = await prisma.sitePageRevision.updateMany({
      // The state is in the WHERE clause for the same reason it is in `cancelScheduleAction`: the
      // scheduler may have activated this revision between the read above and this write.
      where: { pageId: page.id, number: revisionNumber, state: 'SCHEDULED' },
      data: {
        scheduledFor: new Date(when),
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        summary: `Scheduled for ${new Date(when).toISOString()}`,
      },
    })
    if (moved.count === 0) return fail('That schedule published while you were changing it.')

    await recordAudit(actor, {
      action: 'site_builder.reschedule',
      entity: 'SitePage',
      entityId: key,
      oldValue: { scheduledFor: existing.scheduledFor?.toISOString() ?? null },
      newValue: { revision: revisionNumber, scheduledFor: new Date(when).toISOString(), expiresAt: expiresAt ?? null },
    })
    revalidatePath('/staff/site-builder')
    return { ok: true, data: { scheduledFor: new Date(when).toISOString() } }
  })
}

/**
 * Run the schedule sweep now, by hand.
 *
 * The manual recovery path documented in docs/site-builder-scheduling.md. It exists so that an
 * Owner who finds an overdue schedule does not have to wait for a cron they may not be able to see,
 * and does not need a secret to do it — they are already holding the capability that lets them
 * publish the same thing directly.
 *
 * It runs the same service the cron runs. There is no "publish this one" variant, here or anywhere:
 * the server picks what is due.
 */
export async function runSchedulesNowAction(): Promise<ActionResult<{
  considered: number
  activated: number
  failed: number
}>> {
  return guarded(async () => {
    const actor = await requireCapability('manage_site_builder')
    const { runDueSchedules } = await import('./scheduler')
    const result = await runDueSchedules({ trigger: 'manual' })

    await recordAudit(actor, {
      action: 'site_builder.run_schedules',
      entity: 'SitePage',
      entityId: null,
      newValue: {
        considered: result.considered,
        activated: result.activations.filter((a) => a.status === 'activated').map((a) => `${a.pageKey}#${a.revisionNumber}`),
        failed: result.activations.filter((a) => a.status === 'failed').map((a) => `${a.pageKey}#${a.revisionNumber}`),
      },
    })
    revalidatePath('/staff/site-builder')
    return {
      ok: true,
      data: {
        considered: result.considered,
        activated: result.activations.filter((a) => a.status === 'activated').length,
        failed: result.activations.filter((a) => a.status === 'failed').length,
      },
    }
  })
}

// ── Reusable modules and templates ──────────────────────────────────────────────────────────────

export async function saveReusableAction(
  name: string,
  moduleType: string,
  config: Record<string, unknown>,
  category: string,
): Promise<ActionResult<{ id: string }>> {
  return guarded(async () => {
    const actor = await requireCapability('manage_site_builder')
    const clean = name.trim().slice(0, 120).replace(/[<>]/g, '')
    if (!clean) return fail('Give the reusable module a name.')
    const created = await prisma.siteReusableModule.create({
      data: { name: clean, moduleType, category, config: config as never, createdByUsername: actor.username },
    })
    await recordAudit(actor, {
      action: 'site_builder.reusable_create', entity: 'SiteReusableModule', entityId: created.id,
      newValue: { name: clean, moduleType },
    })
    revalidatePath('/staff/site-builder')
    return { ok: true, data: { id: created.id } }
  })
}

export async function saveTemplateAction(
  name: string,
  scope: 'page' | 'section',
  document: LayoutDocument,
): Promise<ActionResult<{ id: string }>> {
  return guarded(async () => {
    const actor = await requireCapability('manage_site_builder')
    const clean = name.trim().slice(0, 120).replace(/[<>]/g, '')
    if (!clean) return fail('Give the template a name.')
    const check = validateDocument(document)
    if (!check.ok) return fail('This layout cannot be saved as a template until its settings are valid.')
    const created = await prisma.siteTemplate.create({
      data: { name: clean, scope, document: check.value as never, createdByUsername: actor.username },
    })
    await recordAudit(actor, {
      action: 'site_builder.template_create', entity: 'SiteTemplate', entityId: created.id,
      newValue: { name: clean, scope, sections: check.value.sections.length },
    })
    revalidatePath('/staff/site-builder')
    return { ok: true, data: { id: created.id } }
  })
}

// ── Trash ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Delete moves to the trash; it does not destroy.
 *
 * The editor's own undo covers the current session, but an administrator who deletes a module,
 * publishes, and closes the tab has no session left to undo in. The trash is what that person
 * recovers from a day later.
 */
export async function trashAction(
  kind: 'module' | 'section' | 'page',
  label: string,
  payload: unknown,
  pageId?: string,
): Promise<ActionResult<{ id: string }>> {
  return guarded(async () => {
    const actor = await requireCapability('manage_site_builder')
    const created = await prisma.siteTrashItem.create({
      data: {
        kind,
        label: label.slice(0, 200).replace(/[<>]/g, ''),
        payload: payload as never,
        pageId: pageId ?? null,
        deletedByUsername: actor.username,
        // Thirty days. Long enough that "I deleted that last month" is recoverable, short enough
        // that the table does not become an unbounded archive of every experiment.
        purgeAfter: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })
    await recordAudit(actor, {
      action: `site_builder.trash_${kind}`, entity: 'SiteTrashItem', entityId: created.id,
      newValue: { label },
    })
    return { ok: true, data: { id: created.id } }
  })
}

export async function purgeTrashAction(id: string): Promise<ActionResult> {
  return guarded(async () => {
    const actor = await requireCapability('manage_site_builder')
    const item = await prisma.siteTrashItem.findUnique({ where: { id } })
    if (!item) return fail('That item is no longer in the trash.')
    await prisma.siteTrashItem.delete({ where: { id } })
    await recordAudit(actor, {
      action: 'site_builder.trash_purge', entity: 'SiteTrashItem', entityId: id,
      oldValue: { kind: item.kind, label: item.label },
    })
    revalidatePath('/staff/site-builder')
    return { ok: true }
  })
}

// ── Editor preferences ──────────────────────────────────────────────────────────────────────────

export async function savePreferencesAction(preferences: Record<string, unknown>): Promise<ActionResult> {
  return guarded(async () => {
    const actor = await requireCapability('manage_site_builder')
    // Not audited: panel widths and the last chosen breakpoint are not administrative acts, and
    // logging them would bury the entries that matter.
    await prisma.siteBuilderPref.upsert({
      where: { userId: actor.userId },
      create: { userId: actor.userId, preferences: preferences as never },
      update: { preferences: preferences as never },
    })
    return { ok: true }
  })
}
