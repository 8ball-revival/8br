import type { Metadata } from 'next'

import { Wide } from '@/components/primitives'
import { pageMetadata, brandName } from '@/lib/site'

import { getRegistryStats } from '@/lib/stats/registry-stats'
import { getHomeNews } from '@/lib/home/news'
import { getHomeLeaderboard } from '@/lib/home/leaderboard'
import { getPublicAchievements } from '@/lib/achievements/service'
import { shuffleAchievements } from '@/lib/achievements/shuffle'

import { CompetitionHistory } from '@/components/home/competition-history'
import { LiveRankings } from '@/components/home/live-rankings'
import { AchievementsCarousel } from '@/components/home/achievements-carousel'
import { CompetitionMarquee } from '@/components/home/competition-marquee'
import { BreakFeature } from '@/components/home/break-feature'
import { ArchiveNotice } from '@/components/home/archive-notice'
import { StatusRail } from '@/components/cyber/status-rail'

/**
 * `/` — the registry dashboard.
 *
 * ── What this replaced, and why ──────────────────────────────────────────────────────────────────
 * The homepage opened with a full-bleed 2.2MB photographic banner, and everything else lived
 * underneath it: a Competition Center, a By the Numbers block, an On This Day almanac, a news panel
 * and a recent-matches list. The banner was the site's identity on arrival, and it said nothing —
 * you had to scroll past a picture to reach a single fact about the archive.
 *
 * Every module here answers a question instead. What is this site (Competition History), who is
 * winning (Live Rankings), what is amusing about the record (Achievements), who won each Season
 * (Season Results), the standings (Top 10), what has been written (The Break), and how much of this
 * to trust (the archive notice). The banner, and the components that only existed to sit beneath it,
 * are gone rather than hidden.
 *
 * ── Layout ───────────────────────────────────────────────────────────────────────────────────────
 * Four rows, full-bleed, each a two-column grid that collapses to one on a narrow screen. The
 * proportions are deliberate: 58/42, then full width, then 48/52, then 55/45 — the widths follow
 * what each panel contains rather than a single repeated split, which is what stops a dashboard
 * looking like a spreadsheet of boxes.
 *
 * ── Data ─────────────────────────────────────────────────────────────────────────────────────────
 * Everything is real, and everything comes from a service that already existed or from a thin query
 * over canonical tables. Nothing on this page computes a ranking, a champion or a statistic of its
 * own — the homepage is a presentation layer, and the moment it starts deriving figures it can
 * disagree with the page it links to.
 */

/*
 * Per-request rather than cached at build.
 *
 * The individual services are each cached with their own revalidation, so this is not a licence to
 * re-query everything on every hit — it is what lets an admin publish an article or close a Season
 * and see it on the homepage without a redeploy.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = pageMetadata({
  title: brandName,
  description:
    '8 Ball Registry — seasons, tournaments, champions and results from across the competitive '
    + '8-ball community. Every competition. Every result. One permanent record.',
  path: '/',
})

export default async function HomePage() {
  /*
   * One await for the whole page.
   *
   * Eight independently cached reads, issued together rather than in sequence, so the slowest one
   * sets the page's latency instead of the sum of all of them.
   */
  /*
   * The leaderboard resolves the era, and the Live Rankings panel is what reports it.
   *
   * It decides whether this deployment's homepage is describing CueVerse or the Yahoo archive. The
   * champions list used to be read for the same platform for the same reason — a CueVerse ladder
   * above a list of Yahoo champions would present two separate competitive histories as one — and
   * that panel has since been replaced by the competition marquee, which announces what is coming
   * rather than reporting what has been, and so belongs to no era.
   */
  const leaderboard = await getHomeLeaderboard(10)

  const [news, achievements, stats] = await Promise.all([
    getHomeNews(),
    getPublicAchievements(),
    getRegistryStats(),
  ])

  return (
    <div className="w-full pb-0 pt-4">
      {/* ── 1. Competition History + Live Rankings ────────────────────────────────────────────── */}
      <Wide>
        <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,58fr)_minmax(0,42fr)]">
          <CompetitionHistory news={news} />
          <LiveRankings rows={leaderboard.rows} platform={leaderboard.platform} />
        </div>
      </Wide>

      {/* ── 3. The competition marquee ────────────────────────────────────────────────────────────
          One announcement panel across the width the Season Results and Top 10 pair used to hold.
          Both are still reachable in full — the seasons browser and /rankings — and both remain on
          their own pages; the homepage says what is COMING instead of repeating what has been. */}
      <Wide className="mt-4">
        <CompetitionMarquee />
      </Wide>

      {/* ── 4. The Break + the archive notice ─────────────────────────────────────────────────── */}
      <Wide className="mt-4">
        <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,55fr)_minmax(0,45fr)]">
          <BreakFeature news={news} />
          <ArchiveNotice />
        </div>
      </Wide>

      {/*
        Achievements, last.
        Moved down from directly under the top row: they are a diversion rather than a headline, and
        putting them above the standings pushed the competition data below the fold.
      */}
      <Wide className="mt-4">
        <AchievementsCarousel achievements={shuffleAchievements(achievements)} />
      </Wide>

      {/* ── 5. The status rail ────────────────────────────────────────────────────────────────── */}
      <Wide>
        <StatusRail
          players={stats.players}
          matches={stats.matchesPlayed}
          seasons={stats.seasons}
        />
      </Wide>
    </div>
  )
}
