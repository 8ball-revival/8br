import 'server-only'

/**
 * The factory layouts: what each page is, in code, before anybody edits it.
 *
 * ── Why these exist even though layouts live in the database ─────────────────────────────────────
 * Three jobs, and only the first is obvious:
 *
 *   1. BOOTSTRAP. The first publish of each page is generated from here, which is how enabling the
 *      builder leaves the site looking exactly as it did. Nothing is redesigned on activation.
 *   2. LAST RESORT. If a published document fails validation and there is no earlier valid revision
 *      to fall back to, the page renders from here. The public site cannot be taken down by a bad
 *      layout, because there is always a layout in the code.
 *   3. RECOVERY. "Restore the original layout" in the control centre resets a page to this.
 *
 * ── Why the homepage definition looks so specific ────────────────────────────────────────────────
 * Because it is a transcription, not a design. The hand-written homepage is five `Wide` rows at
 * 58/42, full, 55/45, full and full, in that order, with those exact modules. Reproducing it means
 * copying those numbers, not choosing new ones — if a ratio here were 60/40 the first published
 * homepage would be subtly wrong and it would be nobody's fault but this file's.
 */

import { DOCUMENT_VERSION, type LayoutDocument, type ModuleInstance, type Section } from './document'
import { getModule } from './registry'
import { defaultsFor } from './fields'

/** Build an instance with the registry's defaults, so a factory layout cannot drift from a schema. */
function mod(id: string, type: string, config: Record<string, unknown> = {}, span = 1): ModuleInstance {
  const def = getModule(type)
  return {
    id,
    type,
    configVersion: def?.configVersion ?? 1,
    // Defaults first so a field added later is present here without this file being touched.
    config: def ? { ...defaultsFor(def.fields), ...config } : config,
    layout: { desktop: { span, ...(def?.layoutDefaults ?? {}) } },
    style: {},
    visibility: {},
    reusableId: null,
  }
}

function section(id: string, name: string, columns: number[], modules: ModuleInstance[]): Section {
  return {
    id,
    name,
    width: 'wide',
    columns: { desktop: columns },
    style: {},
    visibility: {},
    modules,
  }
}

// ── Homepage ────────────────────────────────────────────────────────────────────────────────────

function homepage(): LayoutDocument {
  return {
    version: DOCUMENT_VERSION,
    sections: [
      // Row 1 — 58/42. The introduction beside the standings.
      section('home-intro', 'Introduction & Rankings', [58, 42], [
        mod('home-history', 'competitions.history'),
        mod('home-live-rankings', 'rankings.live', { platform: 'auto', limit: 5 }),
      ]),
      // Row 2 — full width. The announcement.
      section('home-marquee', 'Competition marquee', [1], [
        mod('home-marquee-module', 'competitions.marquee'),
      ]),
      // Row 3 — 55/45. The feature beside the disclaimer.
      section('home-editorial', 'The Break & archive notice', [55, 45], [
        mod('home-break', 'editorial.breakFeature'),
        mod('home-archive-notice', 'content.archiveNotice'),
      ]),
      // Row 4 — full width. A diversion, deliberately below the competition data.
      section('home-achievements', 'Achievements', [1], [
        mod('home-achievements-module', 'rankings.achievements'),
      ]),
      // Row 5 — full width. The totals.
      section('home-status', 'Status rail', [1], [
        mod('home-status-module', 'rankings.statusRail'),
      ]),
    ],
  }
}

// ── Other pages ─────────────────────────────────────────────────────────────────────────────────

/**
 * Pages whose body is still a code-owned route.
 *
 * These get a layout with editable content ABOVE and BELOW the existing page body rather than a
 * transcription of it. That is deliberate: /rankings, a Season page and a bracket are functional
 * surfaces with their own filters, state and URL contract, and turning them into arbitrary module
 * trees would mean an administrator could publish a rankings page with no rankings on it. What is
 * editable is what surrounds them — an announcement, an explanation, a call to action.
 */
function surround(intro: string): LayoutDocument {
  return {
    version: DOCUMENT_VERSION,
    sections: [
      { ...section('page-intro', 'Above the page', [1], []), style: {}, visibility: { hidden: false } },
      { ...section('page-outro', 'Below the page', [1], []) },
    ].map((s, i) => (i === 0 ? { ...s, name: intro } : s)),
  }
}

export interface FactoryPage {
  key: string
  title: string
  kind: 'STATIC' | 'TEMPLATE'
  description: string
  document: () => LayoutDocument
}

/**
 * Every page the builder manages.
 *
 * Adding one here and re-running the bootstrap is all it takes to make a route editable — the
 * bootstrap is idempotent and only creates what is missing.
 */
export const FACTORY_PAGES: FactoryPage[] = [
  {
    key: '/',
    title: 'Homepage',
    kind: 'STATIC',
    description: 'The registry dashboard. Fully composed of modules.',
    document: homepage,
  },
  {
    key: '/rankings',
    title: 'Rankings',
    kind: 'STATIC',
    description: 'Editable content around the rankings explorer, which stays code-owned.',
    document: () => surround('Above the rankings'),
  },
  {
    key: '/seasons',
    title: 'Seasons listing',
    kind: 'STATIC',
    description: 'Editable content around the seasons browser.',
    document: () => surround('Above the seasons list'),
  },
  {
    key: '/tournaments',
    title: 'Tournaments listing',
    kind: 'STATIC',
    description: 'Editable content around the tournaments browser.',
    document: () => surround('Above the tournaments list'),
  },
  {
    key: '/yahoo',
    title: 'Yahoo archive',
    kind: 'STATIC',
    description: 'Editable content around the Yahoo workspace.',
    document: () => surround('Above the Yahoo archive'),
  },
  {
    key: '/achievements',
    title: 'Achievements',
    kind: 'STATIC',
    description: 'Editable content around the achievements grid.',
    document: () => surround('Above the achievements'),
  },
  {
    key: '/the-break',
    title: 'The Break',
    kind: 'STATIC',
    description: 'Editable content around the editorial index.',
    document: () => surround('Above The Break'),
  },
  {
    key: 'season',
    title: 'Season template',
    kind: 'TEMPLATE',
    description: 'Governs every Season page that has no override of its own.',
    document: () => surround('Above the Season'),
  },
  {
    key: 'tournament',
    title: 'Tournament template',
    kind: 'TEMPLATE',
    description: 'Governs every Tournament page that has no override of its own.',
    document: () => surround('Above the Tournament'),
  },
  {
    key: 'article',
    title: 'Article template',
    kind: 'TEMPLATE',
    description: 'Governs every Break article page.',
    document: () => surround('Above the article'),
  },
  {
    key: 'player',
    title: 'Player profile template',
    kind: 'TEMPLATE',
    description: 'Governs every player profile.',
    document: () => surround('Above the profile'),
  },
]

/** The code-defined layout for a page key, or an empty document if it is not a known page. */
export function factoryDocument(key: string): LayoutDocument {
  const page = FACTORY_PAGES.find((p) => p.key === key)
  return page ? page.document() : { version: DOCUMENT_VERSION, sections: [] }
}
