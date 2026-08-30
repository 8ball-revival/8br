import 'server-only'
import { unstable_cache, revalidatePath, revalidateTag } from 'next/cache'
import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from '@/lib/competition/audit'
import { validateDocument, type LayoutDocument } from './document'
import { factoryDocument, FACTORY_PAGES } from './factory'
import '@/components/site-builder/modules'

/**
 * Reading and writing page layouts.
 *
 * ── The fallback chain ───────────────────────────────────────────────────────────────────────────
 * `getPublishedLayout` never throws and never returns nothing. It tries, in order:
 *
 *   1. the current published revision, if it validates;
 *   2. the most recent EARLIER revision that validates;
 *   3. the code-defined factory layout.
 *
 * Step 2 is the one that matters most and is easiest to leave out. A page whose newest revision is
 * broken has almost certainly been fine for its whole history, and dropping straight to the factory
 * layout would throw away every edit ever made rather than the one that broke. Falling back a
 * revision at a time loses the mistake and keeps the work.
 *
 * Every fallback is logged with the page key and the reason, because a site quietly serving a layout
 * from three revisions ago looks exactly like a site working correctly.
 */

export const SITE_BUILDER_TAG = 'site-builder-layout'

export interface PublishedLayout {
  document: LayoutDocument
  /** Which of the three sources actually rendered, so the health page can report it. */
  source: 'published' | 'earlier-revision' | 'factory'
  revisionNumber: number | null
  pageId: string | null
}

async function readPublished(key: string): Promise<PublishedLayout> {
  const page = await prisma.sitePage.findUnique({
    where: { key },
    include: { publishedRevision: true },
  })

  if (!page || !page.enabled) {
    return { document: factoryDocument(key), source: 'factory', revisionNumber: null, pageId: page?.id ?? null }
  }

  if (page.publishedRevision) {
    const check = validateDocument(page.publishedRevision.document)
    // Unknown module types do NOT disqualify a revision: those instances render as a fallback and
    // the rest of the page is fine. Only a genuine validation failure sends us back a revision.
    if (check.ok) {
      return {
        document: check.value,
        source: 'published',
        revisionNumber: page.publishedRevision.number,
        pageId: page.id,
      }
    }
    console.error('[site-builder] published revision failed validation; falling back', {
      key, revision: page.publishedRevision.number, issues: check.issues.slice(0, 5),
    })
  }

  const earlier = await prisma.sitePageRevision.findMany({
    where: { pageId: page.id, state: 'PUBLISHED', id: { not: page.publishedRevisionId ?? '' } },
    orderBy: { number: 'desc' },
    take: 10,
  })
  for (const rev of earlier) {
    const check = validateDocument(rev.document)
    if (check.ok) {
      console.warn('[site-builder] serving an earlier revision', { key, revision: rev.number })
      return { document: check.value, source: 'earlier-revision', revisionNumber: rev.number, pageId: page.id }
    }
  }

  console.error('[site-builder] no valid revision; serving the factory layout', { key })
  return { document: factoryDocument(key), source: 'factory', revisionNumber: null, pageId: page.id }
}

/**
 * The public read.
 *
 * Cached under one tag so a publish invalidates every page at once — layouts reference reusable
 * modules and a shared theme, so a per-page key would leave a page showing a stale copy of a global
 * an administrator had just changed. Layout reads are small and infrequent; correctness is worth
 * more here than a narrower key.
 */
export const getPublishedLayout = unstable_cache(
  readPublished,
  ['site-builder-published-v1'],
  { revalidate: 300, tags: [SITE_BUILDER_TAG] },
)

/** Draft read. Never cached — an administrator must see their own last keystroke. */
export async function getDraft(key: string): Promise<{ document: LayoutDocument; version: number; dirty: boolean } | null> {
  const page = await prisma.sitePage.findUnique({ where: { key }, include: { draft: true } })
  if (!page) return null
  if (!page.draft) {
    const published = await readPublished(key)
    return { document: published.document, version: 0, dirty: false }
  }
  const check = validateDocument(page.draft.document)
  return { document: check.value, version: page.draft.version, dirty: page.draft.dirty }
}

// ── Writes ──────────────────────────────────────────────────────────────────────────────────────

export class ConflictError extends Error {
  constructor(public readonly currentVersion: number) {
    super('This page was changed in another tab or window since you loaded it.')
    this.name = 'ConflictError'
  }
}

/**
 * Save a draft.
 *
 * `expectedVersion` is what makes two tabs safe. The caller sends the version it loaded; if the row
 * has moved on, the write is refused rather than applied, and the editor tells the administrator
 * instead of silently discarding whichever tab saved first.
 *
 * Validation runs here, not only at publish. A draft that cannot be validated cannot be stored, so
 * the table can never hold a document the renderer would choke on — which is what lets the render
 * path treat a validation failure as genuinely exceptional.
 */
export async function saveDraft(
  key: string,
  document: unknown,
  expectedVersion: number,
  actor: Actor,
): Promise<{ version: number; issues: number }> {
  const check = validateDocument(document)

  return prisma.$transaction(async (tx) => {
    const page = await tx.sitePage.findUnique({ where: { key }, include: { draft: true } })
    if (!page) throw new Error(`No editable page is registered for "${key}".`)

    if (page.draft) {
      if (page.draft.version !== expectedVersion) throw new ConflictError(page.draft.version)
      const updated = await tx.sitePageDraft.update({
        where: { pageId: page.id },
        data: {
          document: check.value as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
          dirty: true,
          lastEditorId: actor.userId,
          lastEditorUsername: actor.username,
        },
      })
      return { version: updated.version, issues: check.issues.length }
    }

    const created = await tx.sitePageDraft.create({
      data: {
        pageId: page.id,
        document: check.value as unknown as Prisma.InputJsonValue,
        version: 1,
        dirty: true,
        lastEditorId: actor.userId,
        lastEditorUsername: actor.username,
      },
    })
    return { version: created.version, issues: check.issues.length }
  })
}

/**
 * Publish the current draft.
 *
 * Everything below happens in ONE transaction: freeze the document into an immutable revision,
 * number it, point the page at it, mark the draft clean, and write the audit entry. A publish that
 * half-succeeded — a revision with no page pointing at it, or a page pointing at a revision that
 * was never written — is the kind of state that is very hard to reason about afterwards, so it is
 * made impossible rather than handled.
 *
 * Cache revalidation happens AFTER the transaction commits. Revalidating inside it would advertise
 * a layout that could still be rolled back.
 */
export async function publish(
  key: string,
  actor: Actor,
  summary?: string,
): Promise<{ revisionNumber: number; issues: string[] }> {
  const result = await prisma.$transaction(async (tx) => {
    const page = await tx.sitePage.findUnique({ where: { key }, include: { draft: true } })
    if (!page) throw new Error(`No editable page is registered for "${key}".`)
    if (!page.draft) throw new Error('There is nothing to publish: this page has no draft.')

    // Re-validated at the boundary even though saveDraft validated on the way in. The registry can
    // change between a save and a publish, and publishing is the moment that matters.
    const check = validateDocument(page.draft.document)
    if (!check.ok) {
      throw new Error(
        `This layout cannot be published yet: ${check.issues.slice(0, 3).map((i) => `${i.path} — ${i.message}`).join('; ')}`,
      )
    }

    const last = await tx.sitePageRevision.findFirst({
      where: { pageId: page.id },
      orderBy: { number: 'desc' },
      select: { number: true },
    })
    const number = (last?.number ?? 0) + 1

    const revision = await tx.sitePageRevision.create({
      data: {
        pageId: page.id,
        number,
        document: check.value as unknown as Prisma.InputJsonValue,
        state: 'PUBLISHED',
        summary: summary?.slice(0, 500) ?? null,
        previousRevisionId: page.publishedRevisionId,
        publishedById: actor.userId,
        publishedByUsername: actor.username,
      },
    })

    await tx.sitePage.update({
      where: { id: page.id },
      data: { publishedRevisionId: revision.id },
    })
    await tx.sitePageDraft.update({ where: { pageId: page.id }, data: { dirty: false } })

    await recordAudit(actor, {
      action: 'site_builder.publish',
      entity: 'SitePage',
      entityId: key,
      oldValue: { revision: last?.number ?? null },
      newValue: { revision: number, sections: check.value.sections.length, unknownTypes: check.unknownTypes },
      reason: summary ?? null,
    }, tx)

    return { revisionNumber: number, issues: check.unknownTypes }
  })

  await revalidateFor(key)
  return result
}

/**
 * Roll back to an earlier revision.
 *
 * Deliberately NOT a publish of the old document straight to the live page. It loads the old
 * revision into the DRAFT and then publishes that as a new revision, so history stays append-only:
 * the rollback itself is a revision, with its own number and its own audit entry, and it can be
 * rolled back in turn. Rewriting the pointer to an old revision would make history ambiguous about
 * what was live when.
 */
export async function rollback(key: string, revisionNumber: number, actor: Actor): Promise<{ revisionNumber: number }> {
  const page = await prisma.sitePage.findUnique({ where: { key } })
  if (!page) throw new Error(`No editable page is registered for "${key}".`)
  const target = await prisma.sitePageRevision.findUnique({
    where: { pageId_number: { pageId: page.id, number: revisionNumber } },
  })
  if (!target) throw new Error(`Revision ${revisionNumber} does not exist for this page.`)

  const check = validateDocument(target.document)
  const current = await prisma.sitePageDraft.findUnique({ where: { pageId: page.id } })
  await prisma.sitePageDraft.upsert({
    where: { pageId: page.id },
    create: {
      pageId: page.id,
      document: check.value as unknown as Prisma.InputJsonValue,
      dirty: true,
      lastEditorId: actor.userId,
      lastEditorUsername: actor.username,
    },
    update: {
      document: check.value as unknown as Prisma.InputJsonValue,
      version: { increment: 1 },
      dirty: true,
      lastEditorId: actor.userId,
      lastEditorUsername: actor.username,
    },
  })
  void current

  const published = await publish(key, actor, `Rolled back to revision ${revisionNumber}`)
  await recordAudit(actor, {
    action: 'site_builder.rollback',
    entity: 'SitePage',
    entityId: key,
    newValue: { restoredFrom: revisionNumber, newRevision: published.revisionNumber },
  })
  return { revisionNumber: published.revisionNumber }
}

/** Reset a page to the code-defined layout, as a draft the administrator can review before publishing. */
export async function resetToFactory(key: string, actor: Actor): Promise<void> {
  const page = await prisma.sitePage.findUnique({ where: { key } })
  if (!page) throw new Error(`No editable page is registered for "${key}".`)
  const doc = factoryDocument(key)
  await prisma.sitePageDraft.upsert({
    where: { pageId: page.id },
    create: {
      pageId: page.id,
      document: doc as unknown as Prisma.InputJsonValue,
      dirty: true,
      lastEditorId: actor.userId,
      lastEditorUsername: actor.username,
    },
    update: {
      document: doc as unknown as Prisma.InputJsonValue,
      version: { increment: 1 },
      dirty: true,
      lastEditorId: actor.userId,
      lastEditorUsername: actor.username,
    },
  })
  await recordAudit(actor, {
    action: 'site_builder.reset_to_factory',
    entity: 'SitePage',
    entityId: key,
  })
}

/** Discard the draft, returning the page to whatever is published. */
export async function discardDraft(key: string, actor: Actor): Promise<void> {
  const page = await prisma.sitePage.findUnique({ where: { key }, include: { publishedRevision: true } })
  if (!page) throw new Error(`No editable page is registered for "${key}".`)
  const doc = page.publishedRevision ? page.publishedRevision.document : factoryDocument(key)
  await prisma.sitePageDraft.upsert({
    where: { pageId: page.id },
    create: { pageId: page.id, document: doc as Prisma.InputJsonValue, dirty: false, lastEditorId: actor.userId, lastEditorUsername: actor.username },
    update: { document: doc as Prisma.InputJsonValue, version: { increment: 1 }, dirty: false, lastEditorId: actor.userId, lastEditorUsername: actor.username },
  })
  await recordAudit(actor, { action: 'site_builder.discard_draft', entity: 'SitePage', entityId: key })
}

// ── Cache ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Revalidate what a publish actually affects.
 *
 * A static page revalidates its own path. A TEMPLATE governs an unbounded set of routes, so it
 * revalidates the tag — the alternative would be enumerating every Season on the site and
 * revalidating each, which is slower and still wrong the moment a new one is created.
 */
async function revalidateFor(key: string): Promise<void> {
  revalidateTag(SITE_BUILDER_TAG, 'max')
  if (key.startsWith('/')) {
    revalidatePath(key)
  } else {
    const prefix = { season: '/seasons', tournament: '/tournaments', article: '/the-break', player: '/players' }[key]
    if (prefix) revalidatePath(`${prefix}/[id]`, 'page')
  }
}

// ── Bootstrap ───────────────────────────────────────────────────────────────────────────────────

/**
 * Capture the current site as the first published layout.
 *
 * Idempotent by design and safe to re-run: a page that already exists is left completely alone,
 * including its draft and its revision history. Re-running after adding a page to `FACTORY_PAGES`
 * creates only that one. This is what makes it safe to ship as a startup step rather than a
 * one-time script somebody has to remember not to run twice.
 */
export async function bootstrap(actor: Actor): Promise<{ created: string[]; skipped: string[] }> {
  const created: string[] = []
  const skipped: string[] = []

  for (const factory of FACTORY_PAGES) {
    const existing = await prisma.sitePage.findUnique({ where: { key: factory.key } })
    if (existing) {
      skipped.push(factory.key)
      continue
    }

    const doc = factory.document()
    const check = validateDocument(doc)
    if (!check.ok) {
      // A factory layout that does not validate is a programming error in this repository, not
      // something an administrator can fix, so it is loud rather than silently skipped.
      throw new Error(
        `The factory layout for "${factory.key}" is invalid: ${check.issues.slice(0, 3).map((i) => `${i.path} — ${i.message}`).join('; ')}`,
      )
    }

    await prisma.$transaction(async (tx) => {
      const page = await tx.sitePage.create({
        data: {
          key: factory.key,
          kind: factory.kind,
          title: factory.title,
          description: factory.description,
        },
      })
      const revision = await tx.sitePageRevision.create({
        data: {
          pageId: page.id,
          number: 1,
          document: check.value as unknown as Prisma.InputJsonValue,
          state: 'PUBLISHED',
          summary: 'Initial layout, captured from the site as it was built in code.',
          publishedById: actor.userId,
          publishedByUsername: actor.username,
        },
      })
      await tx.sitePage.update({ where: { id: page.id }, data: { publishedRevisionId: revision.id } })
      await tx.sitePageDraft.create({
        data: {
          pageId: page.id,
          document: check.value as unknown as Prisma.InputJsonValue,
          dirty: false,
          lastEditorId: actor.userId,
          lastEditorUsername: actor.username,
        },
      })
      await recordAudit(actor, {
        action: 'site_builder.bootstrap',
        entity: 'SitePage',
        entityId: factory.key,
        newValue: { sections: check.value.sections.length },
      }, tx)
    })
    created.push(factory.key)
  }

  if (created.length) revalidateTag(SITE_BUILDER_TAG, 'max')
  return { created, skipped }
}
