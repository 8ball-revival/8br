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
      /*
        Row 1 — full width. One photograph, three columns of information.

        Full width and no columns declared, because the hero arranges its own three columns ON the
        photograph. Handing it to the section grid would have put borders between them and turned
        one cinematic band back into the three separate cards this replaced.
      */
      section('home-hero', 'Champion hero', [1], [
        mod('home-hero-module', 'home.championHero'),
      ]),
      // Row 2 — full width. The top five, as one line beneath the hero.
      section('home-rail', 'Top five rail', [1], [
        mod('home-rail-module', 'rankings.rail'),
      ]),
      /*
        Row 3 — 68/32. Everything below the rail, in two columns.

        The marquee, the Yahoo doorway and the record are one column; the Season standings are the
        other. They are ONE section rather than two stacked rows because the approved composition
        runs the narrow column alongside the marquee as well as alongside the record — which is also
        what makes the two columns end on the same line instead of leaving a third of a screen of
        empty page under whichever one is shorter, and what gives the standings table its height.
      */
      section('home-body', 'Marquee, record & reading column', [68, 32], [
        {
          ...mod('home-main-stack', 'layout.stack', { gap: 3 }),
          children: [
            /*
              Sized for the column it now sits in, not for the full width it used to have.

              The marquee moved from a full-width row into a two-thirds column, and three of its
              defaults were tuned for the old width: a 192px crest ate the room the WCC copy needed,
              a 6% seam pushed the button past the diagonal and clipped it, and 440px of height left
              the panel mostly empty. A narrower panel is a different design problem, and these are
              the three numbers that answer it.
            */
            mod('home-marquee-module', 'competitions.marquee', {
              angle: 4,
              minHeight: 380,
              panels: [
                /*
                  The two halves, spelled out here rather than left to the module defaults.

                  A default is what a NEW panel gets; this is what the homepage has. Writing it out
                  means the 8BRCAM photograph, the focal point and the copy travel with the layout,
                  so a site bootstrapped tomorrow gets the approved composition rather than two
                  empty panels.
                */
                {
                  theme: 'wcc', weight: 50,
                  logoMediaId: null, logoPath: '/assets/branding/wcc-logo.png', logoHeight: 140,
                  wordmark: '',
                  kicker: 'World Cue Championships', title: 'Season 1', status: 'Starting soon',
                  body: 'The inaugural season begins soon.',
                  ctaLabel: 'Visit WCC website', ctaHref: 'https://www.worldcuechampionships.com/', newTab: true,
                  bgPath: '', bgFocal: '50% 50%', bgOpacity: 0,
                },
                {
                  theme: 'brcam', weight: 50,
                  logoMediaId: null, logoPath: '', logoHeight: 192,
                  wordmark: '8BRCAM',
                  kicker: '', title: 'Season 2', status: 'Coming soon',
                  body: 'Keep track of the action here on 8 Ball Registry.',
                  ctaLabel: 'View Season 2 here', ctaHref: '/seasons', newTab: false,
                  bgPath: '/assets/homepage/homepage-8brcam-camera.webp', bgFocal: '78% 50%', bgOpacity: 55,
                },
              ],
            }),
            {
              /*
                The archive doorway and the record, side by side.

                ── Why the narrow column is on the LEFT ────────────────────────────────────────
                It was on the right, holding the latest Break article. The ratio flipped from 66/34
                to 34/66 and the two children swapped places; NEITHER footprint changed. The record
                keeps the two thirds it needs for a 16:9 video and the figure beside it, and the
                narrow column keeps the one third a short measure reads best in — the Yahoo tile
                simply inherits the column the article had.

                The article itself is not gone from the site: The Break is still a full section, a
                nav entry and a homepage module. What changed is which panel occupies this one slot.
              */
              ...mod('home-record-row', 'layout.columns', { ratio: '34-66', gap: 3, align: 'stretch', stackBelow: 'lg' }),
              children: [
                mod('home-yahoo-archives', 'rankings.yahooArchives'),
                // The play label names the holder and the time: "Play" alone tells a screen-reader
                // user that something will play and nothing whatsoever about what.
                mod('home-record-feature', 'competitions.recordFeature', {
                  playLabel: "Play Kevin's 58.7-second record run",
                  poster: '/assets/homepage/table-clear-58-7-poster.webp',
                  posterAlt: '',
                  posterFocal: '62% 50%',
                  scoreboard: '8 Ball Registry',
                }),
              ],
            },
          ],
        },
        /*
          The narrow column: one live standings table, full height.

          It held a news panel stacked above an achievements panel. Both still exist as modules and
          both still have their own pages — what changed is that this column now runs the current
          Season, which is the thing on the homepage most likely to be different from one visit to
          the next.

          Placed DIRECTLY in the column rather than inside a `layout.stack`, because a stack sizes
          itself to its children and the panel needs the column's full height to be worth having:
          the section grid is `items-stretch`, so a module placed here stretches beside the marquee
          and the record together, and the table gets the room for fifteen rows.
        */
        mod('home-season-progress', 'seasons.progress'),
      ]),
      // Row 5 — full width. The totals, in the register of a status line rather than an award.
      section('home-stats', 'Registry totals', [1], [
        mod('home-stats-module', 'rankings.statsBar'),
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
