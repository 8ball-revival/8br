/**
 * Data modules: the panels that show what the registry actually knows.
 *
 * ── The rule these all obey ──────────────────────────────────────────────────────────────────────
 * A module stores WHICH figures to show. It never stores the figures, and it never computes them.
 * Every one of these calls the same canonical service the hand-written page called — the same
 * cached `getHomeLeaderboard`, `getSeasonResults`, `getPublicAchievements`, `getExplorer`. That is
 * what makes it impossible for the builder to disagree with the record: there is no second
 * calculation to disagree with.
 *
 * It also means configuration is a set of ARGUMENTS to an existing service, which is why every data
 * option here is an enumerated select rather than a free field. "Platform" offers CueVerse and
 * Yahoo because those are the two the service accepts; there is no text box that could become a
 * query.
 *
 * ── Caching ──────────────────────────────────────────────────────────────────────────────────────
 * The services are individually `unstable_cache`d and React dedupes within a render, so two modules
 * asking for the same leaderboard cost one read. No module opens its own connection or writes its
 * own SQL.
 */

import { registerModule, type ModuleRenderProps } from '@/lib/site-builder/registry'
import { ModulePlaceholder } from './content'

import { getHomeNews } from '@/lib/home/news'
import { getHomeLeaderboard } from '@/lib/home/leaderboard'
import { getPublicAchievements } from '@/lib/achievements/service'
import { shuffleAchievements } from '@/lib/achievements/shuffle'
import { getRegistryStats } from '@/lib/stats/registry-stats'
import { getSeasonResults } from '@/lib/home/season-results'

import { CompetitionHistory } from '@/components/home/competition-history'
import { LiveRankings } from '@/components/home/live-rankings'
import { AchievementsCarousel } from '@/components/home/achievements-carousel'
import { BreakFeature } from '@/components/home/break-feature'
import { ArchiveNotice } from '@/components/home/archive-notice'
import { SeasonResults } from '@/components/home/season-results'
import { StatusRail } from '@/components/cyber/status-rail'

const PLATFORM_OPTIONS = [
  { value: 'auto', label: 'Follow the site (recommended)' },
  { value: 'CUEVERSE', label: 'CueVerse' },
  { value: 'YAHOO', label: 'Yahoo archive' },
]

// ── Live rankings ───────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'rankings.live',
  name: 'Live Rankings',
  category: 'rankings',
  icon: 'Trophy',
  description: 'The current champion and the players immediately behind them.',
  configVersion: 1,
  dataDriven: true,
  a11y: { landmark: true, headingLevel: 2 },
  fields: {
    platform: {
      kind: 'select', label: 'Platform', default: 'auto', options: PLATFORM_OPTIONS,
      help: 'Following the site means this panel reports whichever era the registry is currently presenting.',
    },
    limit: {
      kind: 'number', label: 'Players shown', default: 5, min: 3, max: 25,
      help: 'The leader is always shown as the champion; this is the total including them.',
    },
  },
  Render: async function LiveRankingsModule({ config }: ModuleRenderProps<{ platform: string; limit: number }>) {
    const board = await getHomeLeaderboard(Math.max(config.limit, 10))
    if (!board.rows.length) {
      return <ModulePlaceholder label="Live Rankings" hint="No rated players yet, so there is nothing to rank." />
    }
    // A forced platform still goes through the same service; only which era is asked for changes.
    const platform = config.platform === 'auto'
      ? board.platform
      : (config.platform as 'CUEVERSE' | 'YAHOO')
    return <LiveRankings rows={board.rows.slice(0, config.limit)} platform={platform} />
  } as never,
})

// ── Season results ──────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'competitions.seasonResults',
  name: 'Season Results',
  category: 'competitions',
  icon: 'ListOrdered',
  description: 'Every Season with its champion, newest first.',
  configVersion: 1,
  dataDriven: true,
  a11y: { landmark: true, headingLevel: 2 },
  fields: {
    platform: {
      kind: 'select', label: 'Platform', default: 'CUEVERSE',
      options: [{ value: 'CUEVERSE', label: 'CueVerse' }, { value: 'YAHOO', label: 'Yahoo archive' }],
    },
    limit: { kind: 'number', label: 'Rows shown', default: 12, min: 3, max: 60 },
    snap: {
      kind: 'boolean', label: 'End on a whole row', default: true,
      help: 'Stops the panel cutting a row in half at the bottom.',
    },
  },
  ownsScroll: true,
  Render: async function SeasonResultsModule({ config }: ModuleRenderProps<{ platform: string; limit: number; snap: boolean }>) {
    const results = await getSeasonResults(config.platform as 'CUEVERSE' | 'YAHOO')
    if (!results?.length) {
      return <ModulePlaceholder label="Season Results" hint="No completed Seasons on this platform yet." />
    }
    return <SeasonResults rows={results.slice(0, config.limit)} snap={config.snap} />
  } as never,
})

// ── Competition history + latest news ───────────────────────────────────────────────────────────

registerModule({
  type: 'competitions.history',
  name: 'Competition History',
  category: 'competitions',
  icon: 'BookOpen',
  description: 'The registry introduction, with the latest headlines beside it.',
  configVersion: 1,
  dataDriven: true,
  a11y: { landmark: true, headingLevel: 2 },
  fields: {},
  Render: async function CompetitionHistoryModule() {
    const news = await getHomeNews()
    return <CompetitionHistory news={news} />
  } as never,
})

// ── The Break feature ───────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'editorial.breakFeature',
  name: 'Featured Break article',
  category: 'editorial',
  icon: 'Newspaper',
  description: 'The rotating featured article, with two more beside it.',
  configVersion: 1,
  dataDriven: true,
  a11y: { landmark: true, headingLevel: 2 },
  fields: {},
  Render: async function BreakFeatureModule() {
    const news = await getHomeNews()
    return <BreakFeature news={news} />
  } as never,
})

// ── Achievements ────────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'rankings.achievements',
  name: 'Achievements carousel',
  category: 'rankings',
  icon: 'Award',
  description: 'A rotating strip of achievements.',
  configVersion: 1,
  dataDriven: true,
  a11y: { landmark: true, headingLevel: 2 },
  fields: {
    shuffle: {
      kind: 'boolean', label: 'Rotate the order', default: true,
      help: 'Off shows them in the order they are configured, which is useful when a specific few should lead.',
    },
  },
  Render: async function AchievementsModule({ config }: ModuleRenderProps<{ shuffle: boolean }>) {
    const achievements = await getPublicAchievements()
    if (!achievements.length) {
      return <ModulePlaceholder label="Achievements" hint="No active achievements are configured." />
    }
    return <AchievementsCarousel achievements={config.shuffle ? shuffleAchievements(achievements) : achievements} />
  } as never,
})

// ── Archive notice ──────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'content.archiveNotice',
  name: 'Archive disclaimer',
  category: 'content',
  icon: 'ShieldAlert',
  description: 'The standing note about how the historical Seasons were reconstructed.',
  configVersion: 1,
  a11y: { landmark: true },
  fields: {},
  Render: function ArchiveNoticeModule() {
    return <ArchiveNotice />
  } as never,
})

// ── Status rail ─────────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'rankings.statusRail',
  name: 'Registry status rail',
  category: 'rankings',
  icon: 'Activity',
  description: 'The totals strip: players, matches and Seasons on record.',
  configVersion: 1,
  dataDriven: true,
  a11y: {},
  fields: {},
  Render: async function StatusRailModule() {
    const stats = await getRegistryStats()
    return <StatusRail players={stats.players} matches={stats.matchesPlayed} seasons={stats.seasons} />
  } as never,
})
