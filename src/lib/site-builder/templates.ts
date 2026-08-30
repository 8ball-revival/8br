import 'server-only'

/**
 * Templates, as first-class things rather than as saved clipboard contents.
 *
 * ── What changed, and why it had to ─────────────────────────────────────────────────────────────
 * A template used to be write-only: you could save a layout and insert it, and that was all. There
 * was no way to open one, no way to correct a mistake in one, no way to see where it was used, and
 * no way back if you overwrote it. A template with no published instance could not be reached at
 * all — the control centre said "no edit link" and meant it.
 *
 * Everything here exists to remove that. A template can be created empty, opened, edited, renamed,
 * rescoped, previewed against real data, duplicated, archived, restored, rolled back and — when
 * genuinely unused — deleted.
 *
 * ── Why templates get revisions ─────────────────────────────────────────────────────────────────
 * The moment a template is directly editable, it is a thing somebody will change and later regret
 * changing. Pages have revision history and a rollback for exactly that reason, and a template
 * edited the same way needs the same recourse. Without it, this would be the one part of the
 * builder where a mistake was permanent.
 *
 * ── Why a template never publishes anything ─────────────────────────────────────────────────────
 * A template is a STARTING POINT, not a link. Inserting one copies its sections with fresh ids and
 * no reference back, so editing a template later changes nothing on any page that started from it.
 * That is the opposite of a reusable module, which stays linked on purpose, and the difference is
 * the single most important thing to keep straight about the two.
 *
 * `usage` below reports linked REUSABLE MODULES carried inside a template's document, which is the
 * one way a template edit can reach a live page — not through the template, but through the modules
 * it plants. That is what the impact warning is about.
 */

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from '@/lib/competition/audit'
import { validateDocument, type LayoutDocument } from './document'
import { walkModules } from './operations'

export type TemplateScope = 'page' | 'section'

export interface TemplateDetail {
  id: string
  name: string
  description: string | null
  scope: TemplateScope
  category: string | null
  favorite: boolean
  document: LayoutDocument
  sectionCount: number
  moduleCount: number
  /** Module types the document uses that this build does not have. */
  unknownTypes: string[]
  createdAt: string
  updatedAt: string
  createdBy: string | null
  archivedAt: string | null
  revisionCount: number
}

export interface TemplateUsage {
  /** Reusable modules linked from inside this template, and the pages that already carry them. */
  linkedReusables: { id: string; name: string; missing: boolean; onPages: string[] }[]
  /** Pages whose CURRENT draft contains a section that looks like it came from this template. */
  likelyStartedFrom: string[]
}

const EMPTY_DOCUMENT: LayoutDocument = { version: 1, sections: [] }

function toDetail(row: {
  id: string; name: string; description: string | null; scope: string; category: string | null
  favorite: boolean; document: Prisma.JsonValue; createdAt: Date; updatedAt: Date
  createdByUsername: string | null; archivedAt: Date | null
  _count?: { revisions: number }
}): TemplateDetail {
  const check = validateDocument(row.document)
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    scope: row.scope === 'section' ? 'section' : 'page',
    category: row.category,
    favorite: row.favorite,
    document: check.value,
    sectionCount: check.value.sections.length,
    moduleCount: walkModules(check.value).length,
    unknownTypes: check.unknownTypes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdBy: row.createdByUsername,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    revisionCount: row._count?.revisions ?? 0,
  }
}

/**
 * Every template, including archived ones and including templates with nothing in them.
 *
 * A blank template is a legitimate and useful thing — it is how you start one — so a listing that
 * hid it would make creating one feel like it had failed.
 */
export async function listTemplates(options: { includeArchived?: boolean } = {}): Promise<TemplateDetail[]> {
  const rows = await prisma.siteTemplate.findMany({
    where: options.includeArchived ? {} : { archivedAt: null },
    orderBy: [{ favorite: 'desc' }, { updatedAt: 'desc' }],
    include: { _count: { select: { revisions: true } } },
    take: 200,
  })
  return rows.map(toDetail)
}

export async function getTemplate(id: string): Promise<TemplateDetail | null> {
  const row = await prisma.siteTemplate.findUnique({
    where: { id },
    include: { _count: { select: { revisions: true } } },
  })
  return row ? toDetail(row) : null
}

/**
 * Create a template.
 *
 * `document` is optional: without one you get a blank template with a single empty section, which
 * is a page you can start building in rather than an error message telling you to go and find a
 * layout to save first.
 */
export async function createTemplate(
  input: { name: string; scope: TemplateScope; description?: string; document?: LayoutDocument },
  actor: Actor,
): Promise<{ id: string }> {
  const name = cleanName(input.name)
  if (!name) throw new Error('Give the template a name.')

  const document = input.document ?? blankDocument(input.scope)
  const check = validateDocument(document)
  if (!check.ok) {
    throw new Error(`This layout cannot be saved as a template yet: ${firstIssues(check.issues)}`)
  }

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.siteTemplate.create({
      data: {
        name,
        scope: input.scope,
        description: cleanText(input.description, 500),
        document: check.value as unknown as Prisma.InputJsonValue,
        createdByUsername: actor.username,
      },
    })
    // Revision 1 is the template as created, so a rollback can always reach the beginning.
    await tx.siteTemplateRevision.create({
      data: {
        templateId: row.id,
        number: 1,
        name: row.name,
        description: row.description,
        scope: row.scope,
        document: check.value as unknown as Prisma.InputJsonValue,
        summary: 'Created',
        createdById: actor.userId,
        createdByUsername: actor.username,
      },
    })
    await recordAudit(actor, {
      action: 'site_builder.template_create',
      entity: 'SiteTemplate',
      entityId: row.id,
      newValue: { name, scope: input.scope, sections: check.value.sections.length },
    }, tx)
    return row
  })

  return { id: created.id }
}

/**
 * Save a change to a template, and keep what it was.
 *
 * Every save writes a revision. Templates are small documents saved rarely, so the storage is
 * irrelevant next to being able to answer "what did this look like on Tuesday".
 */
export async function updateTemplate(
  id: string,
  patch: { name?: string; description?: string | null; scope?: TemplateScope; document?: LayoutDocument; favorite?: boolean; category?: string | null },
  actor: Actor,
  summary?: string,
): Promise<{ revisionNumber: number }> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.siteTemplate.findUnique({ where: { id } })
    if (!existing) throw new Error('That template no longer exists.')

    const name = patch.name === undefined ? existing.name : cleanName(patch.name)
    if (!name) throw new Error('Give the template a name.')

    let document = validateDocument(existing.document).value
    if (patch.document !== undefined) {
      const check = validateDocument(patch.document)
      if (!check.ok) throw new Error(`This layout cannot be saved yet: ${firstIssues(check.issues)}`)
      document = check.value
    }

    const scope: TemplateScope = patch.scope ?? (existing.scope === 'section' ? 'section' : 'page')
    const description = patch.description === undefined ? existing.description : cleanText(patch.description, 500)

    await tx.siteTemplate.update({
      where: { id },
      data: {
        name,
        description,
        scope,
        category: patch.category === undefined ? existing.category : cleanText(patch.category, 60),
        favorite: patch.favorite ?? existing.favorite,
        document: document as unknown as Prisma.InputJsonValue,
      },
    })

    const last = await tx.siteTemplateRevision.findFirst({
      where: { templateId: id }, orderBy: { number: 'desc' }, select: { number: true },
    })
    const number = (last?.number ?? 0) + 1
    await tx.siteTemplateRevision.create({
      data: {
        templateId: id,
        number,
        name,
        description,
        scope,
        document: document as unknown as Prisma.InputJsonValue,
        summary: cleanText(summary, 200),
        createdById: actor.userId,
        createdByUsername: actor.username,
      },
    })

    await recordAudit(actor, {
      action: 'site_builder.template_update',
      entity: 'SiteTemplate',
      entityId: id,
      oldValue: { name: existing.name, scope: existing.scope },
      newValue: { name, scope, revision: number, sections: document.sections.length },
      reason: summary ?? null,
    }, tx)

    return { revisionNumber: number }
  })
}

export interface TemplateRevisionSummary {
  number: number
  name: string
  scope: string
  summary: string | null
  createdAt: string
  createdBy: string | null
  sectionCount: number
  isCurrent: boolean
}

export async function getTemplateRevisions(id: string): Promise<TemplateRevisionSummary[]> {
  const [template, rows] = await Promise.all([
    prisma.siteTemplate.findUnique({ where: { id } }),
    prisma.siteTemplateRevision.findMany({
      where: { templateId: id }, orderBy: { number: 'desc' }, take: 50,
    }),
  ])
  if (!template) return []
  const currentJson = JSON.stringify(validateDocument(template.document).value)
  return rows.map((r) => ({
    number: r.number,
    name: r.name,
    scope: r.scope,
    summary: r.summary,
    createdAt: r.createdAt.toISOString(),
    createdBy: r.createdByUsername,
    sectionCount: validateDocument(r.document).value.sections.length,
    isCurrent: r.name === template.name && JSON.stringify(validateDocument(r.document).value) === currentJson,
  }))
}

/**
 * Roll a template back to an earlier revision.
 *
 * Append-only, exactly as a page's rollback is: it writes the old content as a NEW revision rather
 * than deleting the ones after it, so the rollback itself can be rolled back and the history stays
 * unambiguous about what the template said when.
 */
export async function rollbackTemplate(id: string, revisionNumber: number, actor: Actor): Promise<{ revisionNumber: number }> {
  const target = await prisma.siteTemplateRevision.findUnique({
    where: { templateId_number: { templateId: id, number: revisionNumber } },
  })
  if (!target) throw new Error(`Revision ${revisionNumber} does not exist for this template.`)

  return updateTemplate(
    id,
    {
      name: target.name,
      description: target.description,
      scope: target.scope === 'section' ? 'section' : 'page',
      document: validateDocument(target.document).value,
    },
    actor,
    `Rolled back to revision ${revisionNumber}`,
  )
}

export async function duplicateTemplate(id: string, actor: Actor): Promise<{ id: string }> {
  const existing = await prisma.siteTemplate.findUnique({ where: { id } })
  if (!existing) throw new Error('That template no longer exists.')
  return createTemplate({
    name: `${existing.name} copy`.slice(0, 120),
    scope: existing.scope === 'section' ? 'section' : 'page',
    description: existing.description ?? undefined,
    document: validateDocument(existing.document).value,
  }, actor)
}

/**
 * Archive, and un-archive.
 *
 * Archiving is the ordinary way to retire a template: it disappears from the palette and stays
 * available with all its history. Deleting is the second, deliberate act — and only for something
 * nothing depends on.
 */
export async function setTemplateArchived(id: string, archived: boolean, actor: Actor): Promise<void> {
  const existing = await prisma.siteTemplate.findUnique({ where: { id } })
  if (!existing) throw new Error('That template no longer exists.')
  await prisma.siteTemplate.update({
    where: { id },
    data: { archivedAt: archived ? new Date() : null },
  })
  await recordAudit(actor, {
    action: archived ? 'site_builder.template_archive' : 'site_builder.template_restore',
    entity: 'SiteTemplate',
    entityId: id,
    newValue: { name: existing.name },
  })
}

/**
 * Delete a template permanently — only when nothing depends on it.
 *
 * "Depends on it" means a linked reusable module inside its document that pages are currently
 * carrying. The template itself is never depended on: inserting one copies it, so no page holds a
 * reference. The refusal is about the modules it would plant, and about not destroying the only
 * record of a layout somebody may still want.
 */
export async function deleteTemplate(id: string, actor: Actor): Promise<void> {
  const existing = await prisma.siteTemplate.findUnique({ where: { id } })
  if (!existing) throw new Error('That template no longer exists.')

  const usage = await getTemplateUsage(id)
  const inUse = usage.linkedReusables.filter((r) => r.onPages.length > 0)
  if (inUse.length) {
    throw new Error(
      `This template plants ${inUse.length} linked module${inUse.length === 1 ? '' : 's'} that ${inUse.length === 1 ? 'is' : 'are'} live on other pages. Archive it instead, or detach those instances first.`,
    )
  }

  await prisma.siteTemplate.delete({ where: { id } })
  await recordAudit(actor, {
    action: 'site_builder.template_delete',
    entity: 'SiteTemplate',
    entityId: id,
    oldValue: { name: existing.name, scope: existing.scope },
  })
}

/**
 * Where a template's contents already are.
 *
 * Two different questions, deliberately answered separately:
 *
 *   • `linkedReusables` — modules inside the template that stay SYNCED when inserted. Editing one of
 *     those does reach live pages, and this is the impact warning that matters.
 *   • `likelyStartedFrom` — pages carrying a section with the same name and module sequence. A
 *     heuristic, and labelled as one: inserting a template deliberately severs the connection, so
 *     there is nothing exact to report and pretending otherwise would be worse than a guess.
 */
export async function getTemplateUsage(id: string): Promise<TemplateUsage> {
  const template = await prisma.siteTemplate.findUnique({ where: { id } })
  if (!template) return { linkedReusables: [], likelyStartedFrom: [] }

  const document = validateDocument(template.document).value
  const reusableIds = [...new Set(
    walkModules(document).map((m) => m.module.reusableId).filter((r): r is string => !!r),
  )]

  const [reusables, pages] = await Promise.all([
    reusableIds.length
      ? prisma.siteReusableModule.findMany({ where: { id: { in: reusableIds } } })
      : Promise.resolve([]),
    prisma.sitePage.findMany({ include: { draft: true, publishedRevision: true } }),
  ])

  const linkedReusables = reusableIds.map((rid) => {
    const found = reusables.find((r) => r.id === rid)
    const onPages = pages
      .filter((p) => JSON.stringify(p.draft?.document ?? '').includes(`"reusableId":"${rid}"`)
        || JSON.stringify(p.publishedRevision?.document ?? '').includes(`"reusableId":"${rid}"`))
      .map((p) => p.title)
    return { id: rid, name: found?.name ?? '(deleted)', missing: !found, onPages }
  })

  /*
    The heuristic: a section with the same name and the same module types, in the same order.

    Name alone matches too much ("New section"), and module types alone match every page built from
    the same handful of modules. Together they are specific enough to be a useful hint and are never
    presented as more than one.
  */
  const signatures = new Set(document.sections.map(sectionSignature))
  const likelyStartedFrom = signatures.size
    ? pages
      .filter((p) => {
        const doc = validateDocument(p.publishedRevision?.document ?? p.draft?.document ?? EMPTY_DOCUMENT).value
        return doc.sections.some((sec) => signatures.has(sectionSignature(sec)))
      })
      .map((p) => p.title)
    : []

  return { linkedReusables, likelyStartedFrom }
}

function sectionSignature(section: LayoutDocument['sections'][number]): string {
  return `${section.name}::${section.modules.map((m) => m.type).join(',')}`
}

/** A template with something in it, so a new one opens as a page rather than as a void. */
export function blankDocument(scope: TemplateScope): LayoutDocument {
  return {
    version: 1,
    sections: [{
      id: `s-${Math.random().toString(36).slice(2, 10)}`,
      name: scope === 'section' ? 'New section' : 'New page',
      width: 'wide',
      columns: { desktop: [1] },
      style: {},
      visibility: {},
      modules: [],
    }],
  }
}

function cleanName(name: string): string {
  return name.trim().slice(0, 120).replace(/[<>]/g, '')
}

function cleanText(text: string | null | undefined, max: number): string | null {
  if (text === null || text === undefined) return null
  const clean = text.trim().slice(0, max).replace(/[<>]/g, '')
  return clean || null
}

function firstIssues(issues: { path: string; message: string }[]): string {
  return issues.slice(0, 3).map((i) => `${i.path} — ${i.message}`).join('; ')
}
