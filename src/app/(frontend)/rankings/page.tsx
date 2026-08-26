import type { Metadata } from 'next'

import { getExplorer, getFacets, getFreshness } from '@/lib/stats/ladder-explorer'
import { RankingsExplorer } from '@/components/rankings/rankings-explorer'
import { decodeRankingsState, aggregateFilters } from '@/lib/stats/rankings-columns'
import { Wide } from '@/components/primitives'
import { pageMetadata } from '@/lib/site'
import { getRegistryStats } from '@/lib/stats/registry-stats'
import { StatusRail } from '@/components/cyber/status-rail'

export const dynamic = 'force-dynamic' // rankings reflect the latest completed competitions

export const metadata: Metadata = pageMetadata({
  title: 'Rankings',
  description: 'The 8 Ball Registry rankings — a standard Elo rating over every completed competition match, with full career records, championships and head-to-head.',
  path: '/rankings',
})

/**
 * The Rankings page.
 *
 * The whole table configuration lives in the query string, so this page is a pure function of the
 * URL and a configured table can be linked, refreshed and navigated back to. Only the filters that
 * change WHICH MATCHES COUNT reach the aggregate; the rest are applied client-side, which is why
 * they do not appear here.
 *
 * The frame is the shared site container, the same component the navigation uses — so the table's
 * left and right edges are the navigation's edges by construction rather than by coincidence.
 */
export default async function RankingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === 'string') params.set(k, v)
    else if (Array.isArray(v) && v[0] != null) params.set(k, v[0])
  }

  const state = decodeRankingsState(params)

  const [rows, facets, freshness, stats] = await Promise.all([
    // Permanently the official all-time overall table — see the note in RankingsExplorer.
    getExplorer('all-time', 'overall', aggregateFilters(state)),
    getFacets(),
    getFreshness(),
    getRegistryStats(),
  ])

  return (
    <Wide name="rankings" className="py-6">
      <RankingsExplorer
        rows={rows}
        facets={facets}
        state={state}
        // Derived from the newest canonical result, never from the clock — a "last updated" that
        // reports the page load says only that somebody opened the page.
        heading={freshness.lastResultAt ? (
          <p className="text-xs text-muted-foreground">
            Last updated{' '}
            <time dateTime={freshness.lastResultAt}>
              {new Date(freshness.lastResultAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })}
            </time>
            {freshness.source && <> — most recent result from {freshness.source.label}</>}
            {' · '}
            <span className="tabular-nums">{freshness.rankedMatches.toLocaleString()}</span> ranked matches
          </p>
        ) : null}
      />

      {/*
        The same closing rail the homepage carries, from the same registry service, so the two pages
        cannot print different totals for the same archive.
      */}
      <StatusRail players={stats.players} matches={stats.matchesPlayed} seasons={stats.seasons} />
    </Wide>
  )
}
