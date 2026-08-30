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
 * A page built around its real functional surface.
 *
 * The earlier version of this gave such pages editable regions ABOVE and BELOW an untouchable body,
 * which was a limitation rather than a design: the body could not be moved, restyled, spaced or
 * placed beside anything. Now the surface is a MODULE like any other — selectable, movable,
 * styleable, and able to have content placed around it in any arrangement.
 *
 * What stops an administrator publishing a rankings page with no rankings on it is not that the
 * module is unmovable; it is that the module is marked `essential`, so hiding or deleting one
 * requires a typed confirmation and the publish validator reports it. A guardrail rather than a
 * prohibition.
 */
function aroundSystem(systemType: string, label: string): LayoutDocument {
  return {
    version: DOCUMENT_VERSION,
    sections: [
      section('page-intro', 'Above the page', [1], []),
      section('page-body', label, [1], [mod(`page-${systemType.replace(/\W/g, '-')}`, systemType, {}, 12)]),
      section('page-outro', 'Below the page', [1], []),
    ],
  }
}

/**
 * A dynamic template's default shape.
 *
 * The entity's own body — a Season's group tables, a bracket, an article — is rendered by its route
 * and is not a module, because those routes carry per-entity state the builder has no business
 * reinterpreting. What a template governs is everything AROUND that body, applied to every entity of
 * its kind at once.
 */
function templateShell(label: string, systemType: string): LayoutDocument {
  return {
    version: DOCUMENT_VERSION,
    sections: [
      section('template-intro', `Above the ${label}`, [1], []),
      section('template-body', label, [1], [mod(`template-${systemType.replace(/\W/g, '-')}`, systemType, {}, 12)]),
      section('template-outro', `Below the ${label}`, [1], []),
    ],
  }
}

export interface FactoryPage {
  key: string
  title: string
  kind: 'STATIC' | 'TEMPLATE' | 'GLOBAL'
  description: string
  document: () => LayoutDocument
}

/**
 * Every page the builder manages.
 *
 * Adding one here and re-running the bootstrap is all it takes to make a route editable — the
 * bootstrap is idempotent and only creates what is missing.
 */
/**
 * A global: the navigation, the footer or the theme.
 *
 * Modelled as a page so it inherits draft, revision history, atomic publish, scheduling, rollback
 * and audit rather than needing all of that written a second time.
 */
function globalShell(label: string, moduleTypes: string[]): LayoutDocument {
  return {
    version: DOCUMENT_VERSION,
    sections: [section('global', label, [1], moduleTypes.map((t, i) => mod(`global-${t.replace(/\W/g, '-')}-${i}`, t, {}, 12)))],
  }
}

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
    description: 'The rankings explorer, placed as a module, with editable content around it.',
    document: () => aroundSystem('system.rankings', 'Rankings'),
  },
  {
    key: '/tournaments',
    title: 'Tournaments listing',
    kind: 'STATIC',
    description: 'The tournaments browser, placed as a module, with editable content around it.',
    document: () => aroundSystem('system.tournaments', 'Tournaments'),
  },
  {
    key: '/yahoo',
    title: 'Yahoo archive',
    kind: 'STATIC',
    description: 'The Yahoo workspace, placed as a module, with editable content around it.',
    document: () => aroundSystem('system.yahoo', 'Yahoo archive'),
  },
  {
    key: '/achievements',
    title: 'Achievements',
    kind: 'STATIC',
    description: 'The achievements grid, placed as a module, with editable content around it.',
    document: () => aroundSystem('system.achievements', 'Achievements'),
  },
  {
    key: '/the-break',
    title: 'The Break',
    kind: 'STATIC',
    description: 'The Break feed, placed as a module, with editable content around it.',
    document: () => aroundSystem('system.theBreak', 'The Break'),
  },
  {
    key: 'nav',
    title: 'Navigation & header',
    kind: 'GLOBAL',
    description: 'The links in the header, the mobile menu, the logo, and the site-wide banner.',
    document: () => globalShell('Header', ['global.navigation', 'global.siteBanner']),
  },
  {
    key: 'footer',
    title: 'Footer',
    kind: 'GLOBAL',
    description: 'Footer columns, legal line and social links.',
    document: () => globalShell('Footer', ['global.footer']),
  },
  {
    key: 'theme',
    title: 'Theme',
    kind: 'GLOBAL',
    description: 'Colours, type and spacing for every public page.',
    document: () => globalShell('Theme', ['global.theme']),
  },
  {
    key: 'season',
    title: 'Season template',
    kind: 'TEMPLATE',
    description: 'Governs every Season page that has no override of its own.',
    document: () => templateShell('Season', 'system.seasonDetail'),
  },
  {
    key: 'tournament',
    title: 'Tournament template',
    kind: 'TEMPLATE',
    description: 'Governs every Tournament page that has no override of its own.',
    document: () => templateShell('Tournament', 'system.tournamentDetail'),
  },
  {
    key: 'article',
    title: 'Article template',
    kind: 'TEMPLATE',
    description: 'Governs every Break article page.',
    document: () => templateShell('Article', 'system.articleDetail'),
  },
  {
    key: 'player',
    title: 'Player profile template',
    kind: 'TEMPLATE',
    description: 'Governs every player profile.',
    document: () => templateShell('Player profile', 'system.playerDetail'),
  },
]

/** The code-defined layout for a page key, or an empty document if it is not a known page. */
export function factoryDocument(key: string): LayoutDocument {
  const page = FACTORY_PAGES.find((p) => p.key === key)
  return page ? page.document() : { version: DOCUMENT_VERSION, sections: [] }
}
