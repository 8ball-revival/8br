import type { Metadata } from 'next'

import { Wide } from '@/components/primitives'
import { pageMetadata } from '@/lib/site'
import { getExplorer } from '@/lib/stats/ladder-explorer'
import { getYahooEntrantPlayers, getYahooHonorRoll, getYahooSummary, isYahooSeason } from '@/lib/yahoo/archive'
import { getSeasonGroupStage } from '@/lib/seasons/views'
import { seasonPlayoffRounds } from '@/lib/seasons/playoffs'
import { YahooArchive } from '@/components/yahoo/yahoo-archive'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = pageMetadata({
  title: 'Yahoo Pool Archive',
  description:
    'The original Yahoo era of 8BRCAM — every surviving season, its groups and brackets, and a legacy ladder built only from Yahoo results.',
  path: '/yahoo',
})

/**
 * Yahoo Pool Archive.
 *
 * ── Why the selection lives on the server ────────────────────────────────────────────────────────
 * Which season is open, and whether its groups or its bracket are showing, are read from the URL
 * here and the matching data is loaded before anything renders. The alternative — mounting the page
 * and then fetching what the URL asked for — shows the wrong season for a frame on every deep link
 * and every Back, which is exactly what a shareable archive must not do.
 *
 * ── Why the whole page is one route ──────────────────────────────────────────────────────────────
 * The explorer is part of this page rather than a route of its own, so the summary, the ladder and
 * the honour roll stay on screen while a season is being read. That is the difference between an
 * archive you can browse and a directory you keep leaving.
 */
export default async function YahooPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const one = (k: string) => {
    const v = sp[k]
    return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined
  }

  const requested = Number(one('season'))
  /*
   * A season id in the URL is honoured only if it is genuinely part of this archive. A CueVerse id
   * pasted here must not open the current season inside the historical space — it is not what this
   * page is for, and the header would describe it as history.
   */
  const seasonId = Number.isInteger(requested) && requested > 0 && (await isYahooSeason(requested)) ? requested : null
  const view: 'groups' | 'playoffs' = one('view') === 'playoffs' ? 'playoffs' : 'groups'
  const group = one('group') ?? null

  const [summary, honorRoll, ladder] = await Promise.all([
    getYahooSummary(),
    getYahooHonorRoll(),
    // The archive ladder: all-time, and built from the Yahoo replay alone.
    getExplorer('all-time', 'overall', { platform: 'YAHOO' }),
  ])

  const detail = seasonId
    ? await (async () => {
        const entry = honorRoll.find((h) => h.id === seasonId) ?? null
        const [groups, rounds, entrantPlayers] = await Promise.all([
          getSeasonGroupStage(seasonId),
          seasonPlayoffRounds(seasonId),
          getYahooEntrantPlayers(seasonId),
        ])
        /*
         * Entrant -> profile link, resolved through the ladder's own slugs.
         *
         * The ladder is already loaded and already carries the canonical slug for every player in
         * the archive, so reusing it costs nothing and guarantees a standing links to exactly the
         * profile the rankings link to. An entrant with no matching player simply gets no link,
         * which is the honest outcome for a name the archive never tied to anybody.
         */
        const slugByPlayer = new Map(ladder.map((r) => [r.playerId, r.slug]))
        const links: Record<number, string> = {}
        for (const [entrantId, playerId] of entrantPlayers) {
          const slug = slugByPlayer.get(playerId)
          if (slug) links[entrantId] = `/players/${encodeURIComponent(slug)}?platform=yahoo`
        }
        return entry ? { entry, groups, rounds, links } : null
      })()
    : null

  return (
    <Wide name="yahoo" className="px-3 pb-16 pt-4 sm:px-5">
      <YahooArchive
        summary={summary}
        honorRoll={honorRoll}
        ladder={ladder.map((r) => ({
          rank: r.rank, slug: r.slug, label: r.label, preferredName: r.preferredName, cueverseId: r.cueverseId,
          rating: r.rating, peakRating: r.peakRating,
          wins: r.wins, losses: r.losses, draws: r.draws, played: r.played,
          matchWinPct: r.matchWinPct, gameWinPct: r.gameWinPct, gameDiff: r.gameDiff,
          currentStreak: r.currentStreak, seasonsPlayed: r.seasonsPlayed,
        }))}
        selected={detail}
        view={view}
        group={group}
      />
    </Wide>
  )
}
