import 'server-only'

/**
 * Everything the control centre shows, gathered in one place.
 *
 * ── Why the health check re-validates rather than trusting a stored flag ─────────────────────────
 * A page can become invalid without anybody editing it: a module is renamed, a field's range is
 * tightened, a module is removed from the registry. Nothing writes to `site_page` when that happens,
 * so a stored "healthy" flag would keep saying healthy while the page had quietly fallen back to an
 * older revision. Validating on read is the only way the health page can be trusted, and it is cheap
 * — a handful of small JSON documents.
 */

import { prisma } from '@/lib/prisma'
import { validateDocument } from './document'
import { getModule } from './registry'
import { FACTORY_PAGES } from './factory'
import '@/components/site-builder/modules'

export interface PageOverview {
  key: string
  title: string
  kind: 'STATIC' | 'TEMPLATE' | 'GLOBAL'
  description: string | null
  /** Null until the page has been bootstrapped. */
  publishedRevision: number | null
  publishedAt: string | null
  publishedBy: string | null
  hasDraft: boolean
  draftDirty: boolean
  lastEditor: string | null
  lastEditedAt: string | null
  revisionCount: number
  scheduled: { number: number; at: string; expires: string | null }[]
  /** Problems found by re-validating the published document right now. */
  issues: string[]
  unknownTypes: string[]
  moduleCount: number
  sectionCount: number
  /** Where an administrator goes to edit it. */
  editHref: string | null
}

export interface BuilderOverview {
  bootstrapped: boolean
  pages: PageOverview[]
  reusables: { id: string; name: string; moduleType: string; updatedAt: string; missing: boolean }[]
  templates: { id: string; name: string; scope: string; updatedAt: string }[]
  themes: { id: string; name: string; active: boolean }[]
  trash: { id: string; kind: string; label: string; deletedAt: string; deletedBy: string | null; purgeAfter: string | null }[]
  /** Registry inventory, so the health panel can report what modules exist. */
  registry: { total: number; byCategory: { category: string; count: number }[] }
}

export async function getBuilderOverview(): Promise<BuilderOverview> {
  const [pages, reusables, templates, themes, trash] = await Promise.all([
    prisma.sitePage.findMany({
      include: {
        publishedRevision: true,
        draft: true,
        _count: { select: { revisions: true } },
        revisions: {
          where: { state: 'SCHEDULED' },
          orderBy: { scheduledFor: 'asc' },
          select: { number: true, scheduledFor: true, expiresAt: true },
        },
      },
      orderBy: [{ kind: 'asc' }, { key: 'asc' }],
    }),
    prisma.siteReusableModule.findMany({ where: { archivedAt: null }, orderBy: { updatedAt: 'desc' } }),
    prisma.siteTemplate.findMany({ where: { archivedAt: null }, orderBy: { updatedAt: 'desc' } }),
    prisma.siteThemeProfile.findMany({ orderBy: { name: 'asc' } }),
    prisma.siteTrashItem.findMany({ orderBy: { deletedAt: 'desc' }, take: 100 }),
  ])

  const overview: PageOverview[] = pages.map((page) => {
    const doc = page.publishedRevision?.document ?? null
    const check = doc ? validateDocument(doc) : null
    return {
      key: page.key,
      title: page.title,
      kind: page.kind,
      description: page.description,
      publishedRevision: page.publishedRevision?.number ?? null,
      publishedAt: page.publishedRevision?.publishedAt.toISOString() ?? null,
      publishedBy: page.publishedRevision?.publishedByUsername ?? null,
      hasDraft: !!page.draft,
      draftDirty: page.draft?.dirty ?? false,
      lastEditor: page.draft?.lastEditorUsername ?? null,
      lastEditedAt: page.draft?.updatedAt.toISOString() ?? null,
      revisionCount: page._count.revisions,
      scheduled: page.revisions
        .filter((r) => r.scheduledFor)
        .map((r) => ({
          number: r.number,
          at: r.scheduledFor!.toISOString(),
          expires: r.expiresAt?.toISOString() ?? null,
        })),
      issues: check && !check.ok ? check.issues.slice(0, 5).map((i) => `${i.path}: ${i.message}`) : [],
      unknownTypes: check?.unknownTypes ?? [],
      moduleCount: check ? check.value.sections.reduce((n, s) => n + s.modules.length, 0) : 0,
      sectionCount: check ? check.value.sections.length : 0,
      // Only a concrete route can be opened in Edit Mode. A template governs many routes and has no
      // single page to stand on, so the control centre says so rather than offering a broken link.
      editHref: page.kind === 'STATIC' ? `${page.key}${page.key.includes('?') ? '&' : '?'}edit=1` : null,
    }
  })

  const byCategory = new Map<string, number>()
  for (const def of (await import('./registry')).allModules()) {
    byCategory.set(def.category, (byCategory.get(def.category) ?? 0) + 1)
  }

  return {
    bootstrapped: pages.length > 0,
    pages: overview,
    reusables: reusables.map((r) => ({
      id: r.id,
      name: r.name,
      moduleType: r.moduleType,
      updatedAt: r.updatedAt.toISOString(),
      // A reusable module whose type no longer exists cannot be inserted. Saying so here is the
      // difference between "nothing happens when I click it" and a clear explanation.
      missing: !getModule(r.moduleType),
    })),
    templates: templates.map((t) => ({ id: t.id, name: t.name, scope: t.scope, updatedAt: t.updatedAt.toISOString() })),
    themes: themes.map((t) => ({ id: t.id, name: t.name, active: t.active })),
    trash: trash.map((t) => ({
      id: t.id,
      kind: t.kind,
      label: t.label,
      deletedAt: t.deletedAt.toISOString(),
      deletedBy: t.deletedByUsername,
      purgeAfter: t.purgeAfter?.toISOString() ?? null,
    })),
    registry: {
      total: [...byCategory.values()].reduce((a, b) => a + b, 0),
      byCategory: [...byCategory.entries()].map(([category, count]) => ({ category, count })),
    },
  }
}

/** Pages defined in code that have not been bootstrapped yet. */
export function missingPages(overview: BuilderOverview): { key: string; title: string }[] {
  const have = new Set(overview.pages.map((p) => p.key))
  return FACTORY_PAGES.filter((p) => !have.has(p.key)).map((p) => ({ key: p.key, title: p.title }))
}

/** Revision history for one page, for the history panel. */
export async function getRevisions(key: string, limit = 40) {
  const page = await prisma.sitePage.findUnique({ where: { key } })
  if (!page) return []
  const revisions = await prisma.sitePageRevision.findMany({
    where: { pageId: page.id },
    orderBy: { number: 'desc' },
    take: limit,
  })
  return revisions.map((r) => ({
    number: r.number,
    state: r.state,
    summary: r.summary,
    publishedAt: r.publishedAt.toISOString(),
    publishedBy: r.publishedByUsername,
    isLive: r.id === page.publishedRevisionId,
    scheduledFor: r.scheduledFor?.toISOString() ?? null,
  }))
}
