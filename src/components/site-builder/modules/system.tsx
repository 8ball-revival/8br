/**
 * System modules: the real functional surfaces of the site, made placeable.
 *
 * ── What these are, and what they are not ────────────────────────────────────────────────────────
 * Each one renders the ACTUAL page body — the rankings explorer with its filters and its URL
 * contract, the Yahoo workspace with its tabs and year snapshots, the seasons browser, the bracket.
 * Not a copy, not a simplified version, not a screenshot of one. The component was moved out of the
 * route unchanged and is called here with the same props the route gave it.
 *
 * That is the difference between a site builder and a page builder. An administrator can move the
 * rankings table, put an announcement above it, change its section width or hide it on phones — and
 * it is still the rankings table, reading the same services, answering the same query string, with
 * every filter and sort intact.
 *
 * ── Why they are marked `essential` ──────────────────────────────────────────────────────────────
 * A page whose system module has been deleted is a page that no longer does its job: /rankings with
 * no rankings on it. The flag makes the editor demand a typed confirmation before hiding or deleting
 * one, and makes the publish validator refuse silently shipping such a page. It is a guardrail, not
 * a prohibition — an administrator who genuinely means it can still do it.
 *
 * ── Configuration ────────────────────────────────────────────────────────────────────────────────
 * Deliberately thin. These modules own behaviour that is not the builder's to reinterpret, so what
 * is offered is presentation: the frame around them, and whether the surrounding page furniture
 * appears. Anything that would change what the data MEANS belongs in the page's own controls.
 */

import { registerModule, type ModuleRenderProps } from '@/lib/site-builder/registry'
import { cn } from '@/lib/utils'

import { RankingsBody } from '@/components/system/rankings-body'
import { TournamentsBody } from '@/components/system/tournaments-body'
import { YahooBody } from '@/components/system/yahoo-body'
import { AchievementsBody } from '@/components/system/achievements-body'
import { TheBreakBody } from '@/components/system/the-break-body'
import { SeasonDetailBody } from '@/components/system/season-detail-body'
import { TournamentDetailBody } from '@/components/system/tournament-detail-body'
import { ArticleDetailBody } from '@/components/system/article-detail-body'
import { PlayerDetailBody } from '@/components/system/player-detail-body'

/** The query string, as the route's own `searchParams` promise shape. */
function asSearchParams(context: { searchParams?: Record<string, string | string[] | undefined> }) {
  return Promise.resolve(context.searchParams ?? {})
}

/**
 * A frame that can add breathing room without touching the wrapped component.
 *
 * `display: contents` when nothing is configured, so the wrapper contributes no box at all and the
 * page's own layout is exactly what it was. A wrapper that always rendered a div would change the
 * grid the page body sits in, which is precisely the kind of invisible drift this whole design is
 * trying to avoid.
 */
const SPACING = ['', 'pt-2', 'pt-4', 'pt-6', 'pt-8', 'pt-12'] as const
const SPACING_BOTTOM = ['', 'pb-2', 'pb-4', 'pb-6', 'pb-8', 'pb-12'] as const

function SystemFrame({ top, bottom, children }: { top: number; bottom: number; children: React.ReactNode }) {
  if (!top && !bottom) return <>{children}</>
  return (
    <div className={cn(SPACING[Math.min(top, 5)], SPACING_BOTTOM[Math.min(bottom, 5)])}>
      {children}
    </div>
  )
}

/** Every system module shares these, so the inspector is consistent across them. */
const FRAME_FIELDS = {
  spaceAbove: {
    kind: 'number' as const, label: 'Space above', default: 0, min: 0, max: 5, unit: 'steps',
    help: 'Zero leaves the page exactly as it renders on its own.',
  },
  spaceBelow: {
    kind: 'number' as const, label: 'Space below', default: 0, min: 0, max: 5, unit: 'steps',
  },
}

// ── Rankings ────────────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'system.rankings',
  name: 'Rankings explorer',
  category: 'rankings',
  icon: 'Table2',
  description: 'The full rankings table with its filters, sorting and column controls.',
  configVersion: 1,
  dataDriven: true,
  urlDriven: true,
  ownsScroll: true,
  essential: 'This IS the rankings table. Without it, /rankings has no rankings on it.',
  a11y: { landmark: true, headingLevel: 2 },
  layoutDefaults: { span: 12 },
  fields: FRAME_FIELDS,
  Render: async function RankingsSystem({ config, context }: ModuleRenderProps<{ spaceAbove: number; spaceBelow: number }>) {
    return (
      <SystemFrame top={config.spaceAbove} bottom={config.spaceBelow}>
        <RankingsBody searchParams={asSearchParams(context)} />
      </SystemFrame>
    )
  } as never,
})

// ── Tournaments ─────────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'system.tournaments',
  name: 'Tournaments browser',
  category: 'seasons',
  icon: 'Trophy',
  description: 'Active, upcoming and archived tournaments.',
  configVersion: 1,
  dataDriven: true,
  essential: 'This IS the tournaments browser. Without it, /tournaments lists nothing.',
  a11y: { landmark: true, headingLevel: 2 },
  layoutDefaults: { span: 12 },
  fields: FRAME_FIELDS,
  Render: async function TournamentsSystem({ config }: ModuleRenderProps<{ spaceAbove: number; spaceBelow: number }>) {
    return (
      <SystemFrame top={config.spaceAbove} bottom={config.spaceBelow}>
        <TournamentsBody />
      </SystemFrame>
    )
  } as never,
})

// ── Yahoo archive ───────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'system.yahoo',
  name: 'Yahoo archive workspace',
  category: 'rankings',
  icon: 'Archive',
  description: 'The legacy ladder with its Home, Groups and Playoffs views and year filters.',
  configVersion: 1,
  dataDriven: true,
  urlDriven: true,
  ownsScroll: true,
  essential: 'This IS the Yahoo archive. Without it, /yahoo shows no archive.',
  a11y: { landmark: true, headingLevel: 2 },
  layoutDefaults: { span: 12 },
  fields: FRAME_FIELDS,
  Render: async function YahooSystem({ config, context }: ModuleRenderProps<{ spaceAbove: number; spaceBelow: number }>) {
    return (
      <SystemFrame top={config.spaceAbove} bottom={config.spaceBelow}>
        <YahooBody searchParams={asSearchParams(context)} />
      </SystemFrame>
    )
  } as never,
})

// ── Achievements ────────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'system.achievements',
  name: 'Achievements grid',
  category: 'rankings',
  icon: 'Award',
  description: 'Every achievement, with the staff editor for administrators.',
  configVersion: 1,
  dataDriven: true,
  essential: 'This IS the achievements grid. Without it, /achievements shows nothing.',
  a11y: { landmark: true, headingLevel: 2 },
  layoutDefaults: { span: 12 },
  fields: FRAME_FIELDS,
  Render: async function AchievementsSystem({ config }: ModuleRenderProps<{ spaceAbove: number; spaceBelow: number }>) {
    return (
      <SystemFrame top={config.spaceAbove} bottom={config.spaceBelow}>
        <AchievementsBody />
      </SystemFrame>
    )
  } as never,
})

// ── The Break ───────────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'system.theBreak',
  name: 'The Break feed',
  category: 'editorial',
  icon: 'Newspaper',
  description: 'The editorial feed with its sort, search and posting controls.',
  configVersion: 1,
  dataDriven: true,
  urlDriven: true,
  essential: 'This IS The Break. Without it, /the-break shows no articles.',
  a11y: { landmark: true, headingLevel: 2 },
  layoutDefaults: { span: 12 },
  fields: FRAME_FIELDS,
  Render: async function TheBreakSystem({ config, context }: ModuleRenderProps<{ spaceAbove: number; spaceBelow: number }>) {
    return (
      <SystemFrame top={config.spaceAbove} bottom={config.spaceBelow}>
        <TheBreakBody searchParams={asSearchParams(context)} />
      </SystemFrame>
    )
  } as never,
})

// ── Dynamic detail pages ────────────────────────────────────────────────────────────────────────
//
// These are what the dynamic TEMPLATES govern. One template describes every Season page, so the
// module has to be told which Season it is drawing — `routeParams` carries the route's own params
// through unchanged, so the body reads exactly what it read when the route called it directly.

/** Route params, in the promise shape each body already expects. */
function asRouteParams<T>(context: { routeParams?: Record<string, string> }): Promise<T> {
  return Promise.resolve((context.routeParams ?? {}) as T)
}

registerModule({
  type: 'system.seasonDetail',
  name: 'Season page',
  category: 'seasons',
  icon: 'LayoutList',
  description: 'The Season itself: masthead, group tables, playoff bracket and its view controls.',
  configVersion: 1,
  dataDriven: true,
  urlDriven: true,
  ownsScroll: true,
  essential: 'This IS the Season page. Without it, every Season shows only whatever you place around it.',
  a11y: { landmark: true, headingLevel: 1 },
  layoutDefaults: { span: 12 },
  fields: FRAME_FIELDS,
  Render: async function SeasonDetailSystem({ config, context }: ModuleRenderProps<{ spaceAbove: number; spaceBelow: number }>) {
    return (
      <SystemFrame top={config.spaceAbove} bottom={config.spaceBelow}>
        <SeasonDetailBody
          params={asRouteParams<{ seasonId: string }>(context)}
          searchParams={asSearchParams(context) as never}
        />
      </SystemFrame>
    )
  } as never,
})

registerModule({
  type: 'system.tournamentDetail',
  name: 'Tournament page',
  category: 'seasons',
  icon: 'Swords',
  description: 'The Tournament itself: entrants, groups, bracket and its view controls.',
  configVersion: 1,
  dataDriven: true,
  urlDriven: true,
  ownsScroll: true,
  essential: 'This IS the Tournament page.',
  a11y: { landmark: true, headingLevel: 1 },
  layoutDefaults: { span: 12 },
  fields: FRAME_FIELDS,
  Render: async function TournamentDetailSystem({ config, context }: ModuleRenderProps<{ spaceAbove: number; spaceBelow: number }>) {
    return (
      <SystemFrame top={config.spaceAbove} bottom={config.spaceBelow}>
        <TournamentDetailBody
          params={asRouteParams<{ number: string }>(context)}
          searchParams={asSearchParams(context) as never}
        />
      </SystemFrame>
    )
  } as never,
})

registerModule({
  type: 'system.articleDetail',
  name: 'Article',
  category: 'editorial',
  icon: 'FileText',
  description: 'The article itself: body, author, comments and voting.',
  configVersion: 1,
  dataDriven: true,
  urlDriven: true,
  essential: 'This IS the article.',
  a11y: { landmark: true, headingLevel: 1 },
  layoutDefaults: { span: 12 },
  fields: FRAME_FIELDS,
  Render: async function ArticleDetailSystem({ config, context }: ModuleRenderProps<{ spaceAbove: number; spaceBelow: number }>) {
    return (
      <SystemFrame top={config.spaceAbove} bottom={config.spaceBelow}>
        <ArticleDetailBody
          params={asRouteParams<{ slug: string }>(context)}
          searchParams={asSearchParams(context) as never}
        />
      </SystemFrame>
    )
  } as never,
})

registerModule({
  type: 'system.playerDetail',
  name: 'Player profile',
  category: 'rankings',
  icon: 'User',
  description: 'The profile itself: career record, ratings, achievements and match history.',
  configVersion: 1,
  dataDriven: true,
  urlDriven: true,
  essential: 'This IS the player profile.',
  a11y: { landmark: true, headingLevel: 1 },
  layoutDefaults: { span: 12 },
  fields: FRAME_FIELDS,
  Render: async function PlayerDetailSystem({ config, context }: ModuleRenderProps<{ spaceAbove: number; spaceBelow: number }>) {
    return (
      <SystemFrame top={config.spaceAbove} bottom={config.spaceBelow}>
        <PlayerDetailBody
          params={asRouteParams<{ cueverse: string }>(context)}
          searchParams={asSearchParams(context) as never}
        />
      </SystemFrame>
    )
  } as never,
})
