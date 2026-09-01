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
import { latestBreakPosts } from '@/lib/home/break-news'
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
import { RecordFeature } from '@/components/home/record-feature'
import { resolveRecordHolder } from '@/lib/home/record-holder'
import { youtubeVideoId } from '@/lib/media/youtube'
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
  fields: {
    variant: {
      kind: 'select', label: 'Shape', default: 'panel',
      options: [
        { value: 'panel', label: 'Wide panel — with the latest headlines beside it' },
        { value: 'card', label: 'Editorial card — one article, for a narrow column' },
      ],
      help: 'The card is what stands beside the record feature. Both read the same article.',
    },
  },
  /*
    The DATA is the same in both shapes.

    `getHomeNews` chooses the article, applies its visibility rules and supplies the byline; the
    variant decides only how much room the result is given. A second module would have been a second
    place for those rules to drift — and the shape somebody wants is a layout decision, which is
    exactly the kind of thing a field is for.
  */
  Render: async function BreakFeatureModule({ config }: ModuleRenderProps<{ variant: 'panel' | 'card' }>) {
    /*
      Also The Break rather than `getHomeNews`, for the same reason the plaques changed: that service
      reads the frozen legacy `Article` table. This card led with a June post while five newer ones
      existed. `featured` is simply the newest here - there is no separate featured flag on a Break
      post, and inventing a rotation for a single card would only make the homepage disagree with
      itself about what is newest.
    */
    const posts = await latestBreakPosts(3)
    const [featured, latest, second] = posts
    return (
      <BreakFeature
        news={{
          featured: featured ?? null,
          latest: latest ?? null,
          second: second ?? null,
          eligibleCount: posts.length,
          // Nothing is reused: these are three distinct posts taken newest-first.
          reusedForFeatured: false,
        }}
        variant={config.variant}
      />
    )
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
    surface: {
      kind: 'select', label: 'Section background', default: 'acid',
      options: [
        { value: 'acid', label: 'Acid — the yellow strip' },
        { value: 'dark', label: 'Dark — charcoal, with light cards' },
      ],
      help: 'Only the section behind the cards changes. The cards stay light either way, so they are always separated from what is behind them.',
    },
  },
  Render: async function AchievementsModule({ config }: ModuleRenderProps<{ shuffle: boolean; surface: 'acid' | 'dark' }>) {
    const achievements = await getPublicAchievements()
    if (!achievements.length) {
      return <ModulePlaceholder label="Achievements" hint="No active achievements are configured." />
    }
    return (
      <AchievementsCarousel
        achievements={config.shuffle ? shuffleAchievements(achievements) : achievements}
        surface={config.surface}
      />
    )
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
  fields: {
    variant: {
      kind: 'select', label: 'How much to show', default: 'full',
      options: [
        { value: 'full', label: 'The full disclaimer' },
        { value: 'compact', label: 'A one-line strip with the report link' },
      ],
      help: 'Both link to the same place and start the same report. The full text belongs wherever somebody is about to read reconstructed data.',
    },
  },
  Render: function ArchiveNoticeModule({ config }: ModuleRenderProps<{ variant: 'full' | 'compact' }>) {
    return <ArchiveNotice variant={config.variant} />
  } as never,
})

// ── The record feature ──────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'competitions.recordFeature',
  name: 'Record feature',
  category: 'competitions',
  icon: 'Timer',
  description: 'A headline record — the time, who holds it, and the run on video.',
  configVersion: 1,
  dataDriven: true,
  a11y: { landmark: true, headingLevel: 2 },
  layoutDefaults: { span: 7 },
  fields: {
    eyebrowLead: {
      kind: 'text', label: 'Eyebrow', group: 'The record', default: 'Table Clear', maxLength: 40,
      help: 'The first half, in cyan.',
    },
    eyebrowTrail: {
      kind: 'text', label: 'Eyebrow, second half', group: 'The record', default: 'Challenge', maxLength: 40,
      help: 'Rendered in red, so the eyebrow carries both accents.',
    },
    time: {
      kind: 'text', label: 'The figure', group: 'The record', default: '58.7', maxLength: 12,
      help: 'Shown as large as the panel allows. Kept short: this is the number people remember.',
    },
    unit: { kind: 'text', label: 'Unit', group: 'The record', default: 'Seconds', maxLength: 24 },
    status: {
      kind: 'text', label: 'Status', group: 'The record', default: 'Current world record', maxLength: 60,
      help: 'The red line beneath the figure.',
    },
    description: {
      kind: 'text', label: 'A sentence about it (optional)', group: 'The record', default: '',
      maxLength: 200, multiline: true,
    },

    holderLabel: {
      kind: 'text', label: 'Label above the holder', group: 'Who holds it', default: 'Record holder', maxLength: 40,
    },
    holderPlayerId: {
      kind: 'player', label: 'Player', group: 'Who holds it', default: '',
      help: 'Search by name, CueVerse ID or an old handle. While a player is linked, the two fields below are ignored — the name and CueVerse ID shown follow the player, so a change to their identity reaches this panel like it reaches everything else.',
    },
    holderCueverseId: {
      kind: 'text', label: 'CueVerse ID (fallback)', group: 'Who holds it', default: 'sixohtwo', maxLength: 60,
      help: 'Ignored while a player is linked above. Used only when nobody is linked, or if that player is ever removed.',
    },
    holderDisplayName: {
      kind: 'text', label: 'Display name (fallback)', group: 'Who holds it', default: 'Kevin', maxLength: 60,
      help: 'Ignored while a player is linked above.',
    },

    videoUrl: {
      kind: 'url', label: 'YouTube link', group: 'The video', video: 'youtube',
      // Stored as the id: the validator normalises whatever shape was pasted.
      default: 'xpUXNXdEhBI',
      help: 'A watch, share, embed or Shorts link — or the id on its own. Only YouTube is accepted, and only the video id is ever stored or rendered.',
    },
    playLabel: {
      kind: 'text', label: 'Play button label', group: 'The video',
      default: 'Play the record run', maxLength: 120,
      help: 'Read aloud instead of "play". Say whose run and how long: "Play Kevin\u2019s 58.7-second record run".',
    },

    /*
      ── The poster, and what must never be printed on it ────────────────────────────────────────

      A supplied still shown in place of YouTube's own thumbnail. Empty falls back to YouTube, which
      is what this did before any art existed, so a record pointed at a different video still gets a
      picture rather than a black rectangle.

      The figure is NOT on it. `58.7` is set once, in the HTML beside the video, where it can be
      edited, selected, translated and read aloud. Baking it into the photograph would put the same
      number on the page twice and make the editable one a lie the moment somebody changed it.
    */
    poster: {
      kind: 'url', label: 'Video poster', group: 'The video', default: '', internalOnly: true,
      help: 'A file already on the site, such as /assets/homepage/table-clear-58-7-poster.webp. Empty uses the video\u2019s own thumbnail.',
    },
    posterAlt: {
      kind: 'text', label: 'Poster description', group: 'The video', default: '', maxLength: 160,
      help: 'Usually empty: the record and the holder are already stated beside the video, so the picture adds nothing a reader needs described.',
    },
    posterFocal: {
      kind: 'text', label: 'Poster focal point', group: 'The video', default: '50% 50%', maxLength: 24,
      help: 'Which part survives the crop, as a CSS object-position.',
    },
    scoreboard: {
      kind: 'text', label: 'Strip across the poster', group: 'The video', default: '', maxLength: 60,
      help: 'Drawn as text over the poster rather than baked into it, so it stays sharp and can be changed. Empty draws nothing.',
    },
  },
  /*
    The video is a facade, not an embed.

    Nothing from YouTube loads until somebody presses Play — see `YoutubeFacade`. And what is stored
    is the video ID, extracted and validated here: there is no path by which a pasted value becomes
    an arbitrary iframe, because the embed URL is built from eleven validated characters rather than
    from anything a field contained.
  */
  Render: async function RecordFeatureModule({ config }: ModuleRenderProps<{
    eyebrowLead: string; eyebrowTrail: string; time: string; unit: string; status: string
    description: string; holderLabel: string; holderPlayerId: string
    holderCueverseId: string; holderDisplayName: string; videoUrl: string; playLabel: string
    poster: string; posterAlt: string; posterFocal: string; scoreboard: string
  }>) {
    const holder = await resolveRecordHolder({
      playerId: config.holderPlayerId || null,
      fallbackCueverseId: config.holderCueverseId,
      fallbackDisplayName: config.holderDisplayName,
    })
    return (
      <RecordFeature
        eyebrowLead={config.eyebrowLead}
        eyebrowTrail={config.eyebrowTrail}
        time={config.time}
        unit={config.unit}
        status={config.status}
        description={config.description || undefined}
        holderLabel={config.holderLabel}
        holder={holder}
        videoId={youtubeVideoId(config.videoUrl)}
        playLabel={config.playLabel}
        poster={config.poster}
        posterAlt={config.posterAlt}
        posterFocal={config.posterFocal}
        scoreboard={config.scoreboard}
      />
    )
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
