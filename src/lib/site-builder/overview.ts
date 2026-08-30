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
  /** A TEMPLATE with no live instance to preview against, edited on its own surface instead. */
  editingWithoutExample: boolean
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

  /*
    Where a TEMPLATE is edited.

    A template has no page of its own — it governs every Season, or every article — so it is edited
    while standing on a real one. `/seasons/16426?edit=1` already edits the `season` template rather
    than that Season's own copy, because the route renders through the template; the only thing
    missing was somewhere to click.

    Picking a REAL example matters more than it sounds. Editing a template against a placeholder
    means the modules that read live data have nothing to draw, so the layout being designed looks
    nothing like the pages it governs — which is exactly the mistake a visual builder exists to stop.

    A template with no instance yet (no article has been published, say) gets no link and the control
    centre says why, rather than offering one that leads to a 404.
  */
  const [exampleSeason, exampleTournament, exampleArticle, examplePlayer] = await Promise.all([
    prisma.season.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }),
    prisma.tournament.findFirst({ orderBy: { id: 'desc' }, select: { number: true } }),
    prisma.article.findFirst({ where: { state: 'PUBLISHED' }, orderBy: { publishAt: 'desc' }, select: { slug: true } }),
    prisma.player.findFirst({ where: { cueverseId: { not: null } }, orderBy: { id: 'asc' }, select: { cueverseId: true } }),
  ])
  const templateExample: Record<string, string | null> = {
    season: exampleSeason ? `/seasons/${exampleSeason.id}?edit=1` : null,
    tournament: exampleTournament ? `/tournaments/${exampleTournament.number}?edit=1` : null,
    article: exampleArticle ? `/the-break/${exampleArticle.slug}?edit=1` : null,
    player: examplePlayer ? `/players/${examplePlayer.cueverseId}?edit=1` : null,
  }

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
      /*
        Where this page is edited.

        A STATIC page is edited in place, on itself. A GLOBAL has no page of its own — the navigation
        appears on all of them — so it gets a surface under the control centre. A TEMPLATE is edited
        while standing on a real instance of what it governs, which is the only way to see what the
        layout actually does to live data.

        And when there is no instance — no article written yet, no Season created — the template
        falls back to that same surface rather than to nothing. Being unable to edit the layout that
        governs every future article until somebody writes an article is exactly backwards, and
        "no edit link" was not an explanation anybody could act on.
      */
      editHref: page.kind === 'STATIC'
        ? `${page.key}${page.key.includes('?') ? '&' : '?'}edit=1`
        : page.kind === 'GLOBAL'
          ? `/staff/site-builder/global/${page.key}`
          : templateExample[page.key] ?? `/staff/site-builder/global/${page.key}`,
      /** True when a TEMPLATE is being edited without a live example to stand on. */
      editingWithoutExample: page.kind === 'TEMPLATE' && !templateExample[page.key],
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
