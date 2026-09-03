/**
 * The homepage modules, as configuration.
 *
 * ── Why these live in their own file ────────────────────────────────────────────────────────────
 * `registry-data.tsx` is the general set — panels that could sit on any page. These five are the
 * approved homepage composition: a hero built around whoever is currently first, the ranking rail
 * beneath it, the two forms of the same news, three achievements as plaques, and the totals bar.
 * They obey the same rule as everything in that file — a module stores WHICH figures to show and
 * never the figures themselves — but they are specific enough to a single page that mixing them in
 * would have made the general file hard to read.
 *
 * ── The rule that matters most here ─────────────────────────────────────────────────────────────
 * Every one of these is a data module. What an Owner edits is wording, imagery, links and WHICH
 * record to feature. Nothing an Owner can type becomes a number: the champion, the ratings, the
 * article titles, the achievement holders and the totals are all read at render time from the same
 * canonical services the rest of the site uses. There is deliberately no field anywhere below that
 * could freeze a live figure into stored copy.
 */

import { registerModule, type ModuleRenderProps } from '@/lib/site-builder/registry'
import { ModulePlaceholder } from './content'

import { getHomeNews, type HomeArticle } from '@/lib/home/news'
import { getHomeLeaderboard } from '@/lib/home/leaderboard'
import { getPublicAchievements } from '@/lib/achievements/service'
import { getRegistryStats } from '@/lib/stats/registry-stats'
import { artFor, pictureFor, DEFAULT_ARTICLE_ART, type ArticleArt } from '@/lib/home/article-art'
import { latestBreakPosts, type HomePost } from '@/lib/home/break-news'
import { championImageDecision } from '@/lib/home/champion-image'
import { getSeasonProgress } from '@/lib/home/season-progress'
import { getYahooTopPlayers } from '@/lib/yahoo/ladder'

import { ChampionHero } from '@/components/home/champion-hero'
import { RankingsRail } from '@/components/home/rankings-rail'
import { NewsPlaques } from '@/components/home/news-plaques'
import { AchievementPlaques } from '@/components/home/achievement-plaques'
import { RegistryStatsBar } from '@/components/home/registry-stats-bar'
import { SeasonProgress } from '@/components/home/season-progress'
import { YahooArchives } from '@/components/home/yahoo-archives'

/**
 * The three articles the homepage shows, in the order it shows them.
 *
 * One helper rather than two queries: the hero lists headlines and the plaques list stories, and
 * they are the same three articles. `getHomeNews` is `unstable_cache`d and React dedupes within a
 * render, so the two modules asking for it cost one read — but ordering it in one place is what
 * guarantees they cannot disagree about which article is newest.
 */
async function homeArticles(): Promise<HomeArticle[]> {
  /*
    The Break, newest first - not the legacy `Article` table.

    `getHomeNews` reads `Article`, which has held the same three rows since The Break replaced it.
    Everything published since lives in `BreakPost`, so this surface could never show a new post no
    matter what was written. Ordering is now simply "newest", with no hourly rotation: the panel is
    labelled Latest News and a reader who publishes something expects to see it at the top.
  */
  return latestBreakPosts(3)
}

/** The art list as an Owner has it configured, falling back to the seeded mapping. */
function resolveArt(list: unknown): ArticleArt[] {
  if (!Array.isArray(list) || list.length === 0) return DEFAULT_ARTICLE_ART
  return list as ArticleArt[]
}

// ── The hero ────────────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'home.championHero',
  name: 'Champion hero',
  category: 'competitions',
  icon: 'Crown',
  description: 'The full-width opening band: the registry, the headlines, and whoever is first.',
  configVersion: 1,
  dataDriven: true,
  a11y: { landmark: true, headingLevel: 1 },
  layoutDefaults: { span: 12 },
  fields: {
    eyebrow: { kind: 'text', label: 'Eyebrow', group: 'The registry', default: 'Welcome to 8 Ball Registry', maxLength: 60 },
    heading: { kind: 'text', label: 'Heading', group: 'The registry', default: 'Competition History', maxLength: 60 },
    body: {
      kind: 'text', label: 'Body copy', group: 'The registry', multiline: true, maxLength: 300,
      default: 'Explore seasons, tournaments, champions, and results from across the competitive 8-ball community.',
    },
    tagline: { kind: 'text', label: 'Tagline', group: 'The registry', default: 'Every competition. Every result. One permanent record.', maxLength: 120 },
    ctaLabel: { kind: 'text', label: 'Button label', group: 'The registry', default: 'Rankings', maxLength: 40 },
    ctaHref: { kind: 'url', label: 'Button destination', group: 'The registry', default: '/rankings', internalOnly: true },

    newsLabel: { kind: 'text', label: 'Headlines label', group: 'Headlines', default: 'Latest news', maxLength: 40 },
    newsHref: { kind: 'url', label: 'Article base path', group: 'Headlines', default: '/news', internalOnly: true },

    championLabel: { kind: 'text', label: 'Champion label', group: 'The champion', default: 'Current champion', maxLength: 40 },
    ratingLabel: { kind: 'text', label: 'Rating label', group: 'The champion', default: 'Rating', maxLength: 40 },

    /*
      ── The photograph, and who it is of ────────────────────────────────────────────────────────

      `championHandle` is the whole safety mechanism. The supplied photograph is of a specific
      person, and the panel beside it names whoever is currently first — two facts that are true
      together today and will not be forever. So the image is declared as belonging to a named
      CueVerse ID, and the module compares that to the champion the database reports. When they stop
      matching, the photograph is dropped and a branded ground takes its place. Nobody has to
      remember to do anything on the day the title changes hands.

      Leaving it empty means "this picture is not of anybody", and it is then shown regardless — for
      an arena shot with no identifiable subject, which is the other reasonable thing to put here.
    */
    championHandle: {
      kind: 'text', label: 'Photograph is of (CueVerse ID)', group: 'The photograph', default: 'sixohtwo', maxLength: 60,
      help: 'The photograph is only used while this player is the current champion. Empty means the picture is of nobody in particular and always applies.',
    },
    imageDesktop: {
      kind: 'url', label: 'Photograph (desktop)', group: 'The photograph', default: '/assets/homepage/homepage-champion-sixohtwo-desktop.webp',
      internalOnly: true, help: 'A wide crop, used from 768px up.',
    },
    imageMobile: {
      kind: 'url', label: 'Photograph (mobile)', group: 'The photograph', default: '/assets/homepage/homepage-champion-sixohtwo-mobile.webp',
      internalOnly: true, help: 'An upright crop, used below 768px. The wide one shows a shoulder on a phone.',
    },
    imageAlt: {
      kind: 'text', label: 'Photograph description', group: 'The photograph', maxLength: 160,
      default: 'Kevin, sixohtwo, concentrating as he lines up a pool shot',
      help: 'Describe the picture for somebody who cannot see it. Leave empty if the panel beside it already says everything the picture does.',
    },
    focalDesktop: { kind: 'text', label: 'Focal point (desktop)', group: 'The photograph', default: '72% 50%', maxLength: 24 },
    focalMobile: { kind: 'text', label: 'Focal point (mobile)', group: 'The photograph', default: '58% 56%', maxLength: 24 },
    overlay: {
      kind: 'number', label: 'Darkening', group: 'The photograph', default: 84, min: 0, max: 100, unit: '%',
      help: 'How hard the left side is darkened so the heading stays readable. Lower it for a darker photograph.',
    },
  },
  Render: async function ChampionHeroModule({ config }: ModuleRenderProps<{
    eyebrow: string; heading: string; body: string; tagline: string; ctaLabel: string; ctaHref: string
    newsLabel: string; newsHref: string; championLabel: string; ratingLabel: string
    championHandle: string; imageDesktop: string; imageMobile: string; imageAlt: string
    focalDesktop: string; focalMobile: string; overlay: number
  }>) {
    const [board, articles] = await Promise.all([getHomeLeaderboard(5), homeArticles()])
    const leader = board.rows[0] ?? null

    const champion = leader
      ? {
        rank: leader.rank,
        handle: leader.cueverseId,
        name: leader.preferredName,
        rating: leader.rating,
        href: leader.slug ? `/players/${encodeURIComponent(leader.slug)}` : null,
      }
      : null

    // Does this photograph still belong beside this name? See `lib/home/champion-image.ts`.
    const decision = championImageDecision({
      declaredHandle: config.championHandle,
      championHandle: leader?.cueverseId ?? null,
      hasImage: Boolean(config.imageDesktop.trim() && config.imageMobile.trim()),
    })

    return (
      <ChampionHero
        eyebrow={config.eyebrow}
        heading={config.heading}
        body={config.body}
        tagline={config.tagline}
        ctaLabel={config.ctaLabel}
        ctaHref={config.ctaHref}
        newsLabel={config.newsLabel}
        newsHref={config.newsHref}
        articles={articles}
        championLabel={config.championLabel}
        champion={champion}
        ratingLabel={config.ratingLabel}
        image={decision.use
          ? {
            desktop: config.imageDesktop,
            mobile: config.imageMobile,
            alt: config.imageAlt,
            focalDesktop: config.focalDesktop || '50% 50%',
            focalMobile: config.focalMobile || '50% 50%',
            overlay: Math.max(0, Math.min(100, config.overlay)),
          }
          : null}
      />
    )
  } as never,
})

// ── The ranking rail ────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'rankings.rail',
  name: 'Top five rail',
  category: 'rankings',
  icon: 'TrendingUp',
  description: 'The current top five across the full width, as one line.',
  configVersion: 1,
  dataDriven: true,
  a11y: { landmark: true, headingLevel: 2 },
  layoutDefaults: { span: 12 },
  fields: {
    label: { kind: 'text', label: 'Rail label', default: 'Live rankings', maxLength: 40 },
    ratingLabel: { kind: 'text', label: 'Rating word', default: 'Rating', maxLength: 24, help: 'Used in the spoken label for each link.' },
    limit: { kind: 'number', label: 'Players shown', default: 5, min: 3, max: 8, help: 'Beyond about six the rail stops fitting a desktop width and starts scrolling.' },
    viewAllLabel: { kind: 'text', label: 'Link label', default: 'View full rankings', maxLength: 40 },
    viewAllHref: { kind: 'url', label: 'Link destination', default: '/rankings', internalOnly: true },
  },
  Render: async function RankingsRailModule({ config }: ModuleRenderProps<{
    label: string; ratingLabel: string; limit: number; viewAllLabel: string; viewAllHref: string
  }>) {
    const board = await getHomeLeaderboard(Math.max(3, Math.min(8, config.limit)))
    if (!board.rows.length) {
      return <ModulePlaceholder label="Top five rail" hint="No rated players yet, so there is nothing to rank." />
    }
    return (
      <RankingsRail
        label={config.label}
        platformLabel={board.platform === 'CUEVERSE' ? 'CueVerse' : 'Yahoo archive'}
        rows={board.rows.slice(0, Math.max(3, Math.min(8, config.limit)))}
        ratingLabel={config.ratingLabel}
        viewAllLabel={config.viewAllLabel}
        viewAllHref={config.viewAllHref}
      />
    )
  } as never,
})

// ── News, with pictures ─────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'editorial.newsPlaques',
  name: 'Latest news, illustrated',
  category: 'editorial',
  icon: 'Newspaper',
  description: 'The three latest articles with thumbnails.',
  configVersion: 1,
  dataDriven: true,
  a11y: { landmark: true, headingLevel: 2 },
  fields: {
    label: { kind: 'text', label: 'Panel label', default: 'Latest news', maxLength: 40 },
    // The Break is where these posts live. `/news` still resolves - it 308s here - but sending a
    // reader through a redirect on every headline is a redirect nobody needs.
    basePath: { kind: 'url', label: 'Article base path', default: '/the-break', internalOnly: true },
    viewAllLabel: { kind: 'text', label: 'Link label', default: 'View all news', maxLength: 40 },
    viewAllHref: { kind: 'url', label: 'Link destination', default: '/the-break', internalOnly: true },
    /*
      ── Thumbnails, keyed by article slug ───────────────────────────────────────────────────────

      These are homepage art direction, not article content. See the long note in
      `lib/home/article-art.ts` for why they are not written onto the articles themselves — briefly:
      `Article.coverMediaId` is a filename inside the Payload media store, these crops are chosen for
      one composition on one page, and no author's article should be edited to make a homepage look
      right.

      A list rather than three fixed slots, because the articles rotate and the mapping has to follow
      the article rather than the position it happens to occupy today.
    */
    art: {
      kind: 'list', label: 'Article thumbnails', itemLabel: 'Thumbnail', max: 12,
      default: DEFAULT_ARTICLE_ART as unknown as Record<string, unknown>[],
      help: 'Matched to an article by its slug. An article with nothing here gets the branded fallback.',
      of: {
        slug: { kind: 'text', label: 'Article slug', default: '', maxLength: 200, help: 'The part of the article URL after /news/.' },
        src: { kind: 'url', label: 'Image', default: '', internalOnly: true, help: 'A file already on the site, such as /assets/homepage/article-mlp-tribute.webp.' },
        alt: { kind: 'text', label: 'Image description', default: '', maxLength: 160, help: 'Leave empty when the headline beside it already says what the picture shows.' },
        focal: { kind: 'text', label: 'Focal point', default: '50% 50%', maxLength: 24 },
      },
    },
  },
  Render: async function NewsPlaquesModule({ config }: ModuleRenderProps<{
    label: string; basePath: string; viewAllLabel: string; viewAllHref: string; art: unknown
  }>) {
    const posts = await latestBreakPosts(3)
    const art = resolveArt(config.art)
    return (
      <NewsPlaques
        label={config.label}
        articles={posts}
        art={posts.map((p, i) => pictureFor(p, art, i))}
        viewAllLabel={config.viewAllLabel}
        viewAllHref={config.viewAllHref}
        basePath={config.basePath}
      />
    )
  } as never,
})

// ── Three achievements ──────────────────────────────────────────────────────────────────────────

/**
 * The three the homepage leads with, by the engine's own stable ids.
 *
 * Ids rather than titles: a title is editable copy and an id is identity, so renaming "THE CHOKER"
 * does not silently empty a homepage slot.
 */
const DEFAULT_ACHIEVEMENTS = ['best-win-rate', 'longest-streak', 'the-choker']

registerModule({
  type: 'rankings.achievementPlaques',
  name: 'Achievement plaques',
  category: 'rankings',
  icon: 'Award',
  description: 'Three chosen achievements, with their current holders.',
  configVersion: 1,
  dataDriven: true,
  a11y: { landmark: true, headingLevel: 2 },
  fields: {
    heading: { kind: 'text', label: 'Panel heading', default: 'Achievements', maxLength: 40 },
    caption: { kind: 'text', label: 'Caption', default: 'Celebrating outstanding feats in 8-ball', maxLength: 120 },
    viewAllLabel: { kind: 'text', label: 'Link label', default: 'View all', maxLength: 40 },
    viewAllHref: { kind: 'url', label: 'Link destination', default: '/achievements', internalOnly: true },
    /*
      Three slots, each naming an achievement rather than a person.

      What an Owner picks is WHICH award to show. Who holds it, what the figure is and how it was
      arrived at are all computed by the achievement engine at render time, so choosing a different
      award here changes the whole card without a line of code — and a record changing hands changes
      the homepage without anybody touching it.
    */
    slotOne: { kind: 'text', label: 'First achievement', group: 'Which three', default: DEFAULT_ACHIEVEMENTS[0], maxLength: 60, help: 'The achievement id, as used on the Achievements page.' },
    slotTwo: { kind: 'text', label: 'Second achievement', group: 'Which three', default: DEFAULT_ACHIEVEMENTS[1], maxLength: 60 },
    slotThree: { kind: 'text', label: 'Third achievement', group: 'Which three', default: DEFAULT_ACHIEVEMENTS[2], maxLength: 60 },
  },
  Render: async function AchievementPlaquesModule({ config }: ModuleRenderProps<{
    heading: string; caption: string; viewAllLabel: string; viewAllHref: string
    slotOne: string; slotTwo: string; slotThree: string
  }>) {
    const all = await getPublicAchievements()
    /*
      Site-wide awards are excluded before anything is chosen.

      Those describe the archive rather than a person -- "nobody has done this yet" -- and a plaque
      with a medal and no holder reads as a bug. The totals that belong in that register are in the
      bar at the foot of the page instead.
    */
    const eligible = all.filter((a) => !a.siteWide && a.winners.length > 0)
    const byId = new Map(eligible.map((a) => [a.id, a]))

    const wanted = [config.slotOne, config.slotTwo, config.slotThree]
      .map((id) => id.trim())
      .filter(Boolean)

    // A slot naming an award that no longer exists falls through to the next eligible one rather
    // than leaving a hole, so the row is always three wide.
    const chosen = wanted.map((id) => byId.get(id)).filter((a) => a != null)
    const used = new Set(chosen.map((a) => a.id))
    for (const a of eligible) {
      if (chosen.length >= 3) break
      if (!used.has(a.id)) { chosen.push(a); used.add(a.id) }
    }

    if (!chosen.length) {
      return <ModulePlaceholder label="Achievements" hint="No achievement currently has a holder." />
    }
    return (
      <AchievementPlaques
        heading={config.heading}
        caption={config.caption}
        achievements={chosen.slice(0, 3)}
        viewAllLabel={config.viewAllLabel}
        viewAllHref={config.viewAllHref}
      />
    )
  } as never,
})

// ── The totals bar ──────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'rankings.statsBar',
  name: 'Registry totals bar',
  category: 'rankings',
  icon: 'Activity',
  description: 'The thin bar at the foot: players, matches and Seasons on record.',
  configVersion: 1,
  dataDriven: true,
  a11y: {},
  layoutDefaults: { span: 12 },
  fields: {
    playersLabel: { kind: 'text', label: 'Players label', default: 'Players', maxLength: 40 },
    matchesLabel: { kind: 'text', label: 'Matches label', default: 'Matches recorded', maxLength: 40 },
    seasonsLabel: { kind: 'text', label: 'Seasons label', default: 'Seasons', maxLength: 40 },
    tagline: { kind: 'text', label: 'Centre tagline', default: 'Building the definitive archive of competitive 8-ball', maxLength: 120 },
    liveLabel: { kind: 'text', label: 'Indicator label', default: 'Registry data', maxLength: 40 },
    liveState: { kind: 'text', label: 'Indicator state', default: 'Live', maxLength: 24 },
  },
  Render: async function StatsBarModule({ config }: ModuleRenderProps<{
    playersLabel: string; matchesLabel: string; seasonsLabel: string
    tagline: string; liveLabel: string; liveState: string
  }>) {
    const stats = await getRegistryStats()
    return (
      <RegistryStatsBar
        players={stats.players}
        matches={stats.matchesPlayed}
        seasons={stats.seasons}
        playersLabel={config.playersLabel}
        matchesLabel={config.matchesLabel}
        seasonsLabel={config.seasonsLabel}
        tagline={config.tagline}
        liveLabel={config.liveLabel}
        liveState={config.liveState}
      />
    )
  } as never,
})

// ── Season Progress ─────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'seasons.progress',
  name: 'Season progress',
  category: 'seasons',
  icon: 'ListOrdered',
  description: 'One Season’s group stage as a single live standings table, across every group.',
  configVersion: 1,
  dataDriven: true,
  // A long table inside a bounded tile — the builder needs to know the scroll is intentional.
  ownsScroll: true,
  a11y: { landmark: true, headingLevel: 2 },
  layoutDefaults: { span: 12 },
  fields: {
    heading: { kind: 'text', label: 'Panel heading', default: 'Season progress', maxLength: 40 },
    /*
      ── Which Season, and why it takes four fields to say ──────────────────────────────────────

      An Owner can pin an id, and an id is unambiguous. But leaving the id at zero is the more
      useful setting: the competition slug, the season number and the year identify "8BRCAM Season
      2" through the RELATION rather than through a name, so the panel keeps working when the
      season is retitled and it cannot accidentally match Season 2 of 2013.

      A single "season title" field would have been one control instead of four, and it would break
      the first time somebody edited the title it matched on — silently, by showing nothing.
    */
    seasonId: {
      kind: 'number', label: 'Season id', group: 'Which season', default: 0, min: 0, max: 999999,
      help: 'Zero resolves the Season from the competition, number and year below. Set an id only to pin one exact Season.',
    },
    seriesSlug: { kind: 'text', label: 'Competition slug', group: 'Which season', default: '8brcam', maxLength: 60 },
    number: { kind: 'number', label: 'Season number', group: 'Which season', default: 2, min: 0, max: 999 },
    year: { kind: 'number', label: 'Competition year', group: 'Which season', default: 2026, min: 0, max: 2999, help: 'Zero takes the most recent running of that season number.' },
    viewAllLabel: { kind: 'text', label: 'Footer link label', default: 'View full season', maxLength: 40 },
    emptyText: {
      kind: 'text', label: 'When there is nothing to show',
      default: 'This Season has no entrants yet.', maxLength: 200,
    },
  },
  Render: async function SeasonProgressModule({ config }: ModuleRenderProps<{
    heading: string; seasonId: number; seriesSlug: string; number: number; year: number
    viewAllLabel: string; emptyText: string
  }>) {
    const view = await getSeasonProgress({
      seasonId: config.seasonId || undefined,
      seriesSlug: config.seriesSlug || undefined,
      number: config.number || undefined,
      year: config.year || undefined,
    })
    return (
      <SeasonProgress
        view={view}
        heading={config.heading}
        emptyText={config.emptyText}
        viewAllLabel={config.viewAllLabel}
      />
    )
  } as never,
})

// ── Yahoo Archives ──────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'rankings.yahooArchives',
  name: 'Yahoo archives',
  category: 'rankings',
  icon: 'Library',
  description: 'A doorway into the Yahoo era, with the top five of the archive ladder.',
  configVersion: 1,
  dataDriven: true,
  a11y: { landmark: true, headingLevel: 2 },
  layoutDefaults: { span: 12 },
  fields: {
    eyebrow: { kind: 'text', label: 'Eyebrow', default: 'Yahoo archives', maxLength: 40 },
    heading: { kind: 'text', label: 'Heading', default: 'The original era', maxLength: 60 },
    blurb: {
      kind: 'text', label: 'Blurb',
      default: 'Explore the complete record of competitive 8-ball from the Yahoo era—seasons, champions, matches, records and lasting legacies.',
      maxLength: 240,
    },
    listLabel: { kind: 'text', label: 'List label', default: 'All-time top 5', maxLength: 40 },
    /*
      How many, but never WHO.

      There is no field here that could name a player or type a rating. The five rows are the top of
      the archive ladder as `/yahoo` computes it, so when the archive ranking changes this tile
      changes with it — which is the entire reason it is a data module rather than five text fields.
    */
    limit: { kind: 'number', label: 'How many players', default: 5, min: 1, max: 10 },
    ctaLabel: { kind: 'text', label: 'Footer link label', default: 'Explore Yahoo archives', maxLength: 40 },
    href: { kind: 'url', label: 'Link destination', default: '/yahoo', internalOnly: true },
  },
  Render: async function YahooArchivesModule({ config }: ModuleRenderProps<{
    eyebrow: string; heading: string; blurb: string; listLabel: string
    limit: number; ctaLabel: string; href: string
  }>) {
    const rows = await getYahooTopPlayers(config.limit)
    return (
      <YahooArchives
        rows={rows}
        eyebrow={config.eyebrow}
        heading={config.heading}
        blurb={config.blurb}
        listLabel={config.listLabel}
        ctaLabel={config.ctaLabel}
        href={config.href}
      />
    )
  } as never,
})
