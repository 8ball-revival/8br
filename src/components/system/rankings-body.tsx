import 'server-only'

/**
 * Rankings -- the real page body, extracted so the site builder can place it.
 *
 * Moved here VERBATIM from the route: the same imports, the same reads, the same markup. The builder
 * wraps this as a system module, so a builder-composed page runs the genuine surface -- the same
 * services, the same URL contract, the same behaviour -- rather than a copy that would drift from it.
 *
 * The route is now a shell that supplies metadata and hands the page to the builder.
 */

import type { Metadata } from 'next'

import { getExplorer, getFacets, getFreshness } from '@/lib/stats/ladder-explorer'
import { RankingsExplorer } from '@/components/rankings/rankings-explorer'
import { decodeRankingsState, aggregateFilters } from '@/lib/stats/rankings-columns'
import { SCOPE_SERIES_SLUG, scopeOverlay } from '@/lib/stats/rankings-scope'
import { Wide } from '@/components/primitives'
import { pageMetadata } from '@/lib/site'
import { prisma } from '@/lib/prisma'






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

export async function RankingsBody({
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

  /*
   * This page is the CURRENT rankings, and nothing can widen it.
   *
   * It used to fall back to the Yahoo ladder when CueVerse had no rated matches — so a reader
   * arriving from the navigation was shown forty-eight archived seasons under a heading that said
   * "Rankings", with 2014 results reading as current form. The archive has its own page now, the
   * fallback is gone, and an empty scope says so in words instead.
   *
   * The scope is applied ON TOP of the reader's own filters rather than beside them, because it is
   * not one of them: it decides which results exist for this table at all.
   */
  const seriesSlug = SCOPE_SERIES_SLUG[state.scope]
  const series = seriesSlug
    ? await prisma.competitionSeries.findUnique({ where: { slug: seriesSlug }, select: { id: true } })
    : null
  const overlay = scopeOverlay(state.scope, series?.id ?? null)

  const [rows, facets, freshness] = await Promise.all([
    // Permanently the official all-time overall table — see the note in RankingsExplorer.
    getExplorer('all-time', 'overall', { ...aggregateFilters(state), ...overlay }),
    getFacets(),
    getFreshness(),
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
        The registry rail is gone from this page.
        
        It carried registry-wide totals -- 525 players, 8,228 matches, 50 seasons -- and almost all of
        them are Yahoo. Under a current ladder that legitimately has no rows yet, three large numbers
        with no other figures on the page to compare them against read as the ladder's own, which is
        the one thing this split exists to prevent. The homepage still carries it, where it describes
        the whole registry and says so.
      */}
    </Wide>
  )
}
