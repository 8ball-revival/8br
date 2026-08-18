import type { Metadata } from 'next'

import { getExplorer, getFacets } from '@/lib/stats/ladder-explorer'
import { LadderExplorer } from '@/components/rankings/ladder-explorer'
import { HowRankingsWork } from '@/components/rankings/how-rankings-work'
import { decodeExplorerState } from '@/lib/stats/ladder-columns'
import { pageMetadata } from '@/lib/site'

export const dynamic = 'force-dynamic' // the ladder reflects the latest completed competitions

export const metadata: Metadata = pageMetadata({
  title: 'Rankings',
  description: 'The 8 Ball Registry Rating ladder — a standard Elo system over every completed competition match.',
  path: '/rankings',
})

/**
 * The Ladder.
 *
 * The whole table configuration lives in the query string, so this page is a pure function of the URL
 * and a configured table can be linked. Only the filters that change WHICH MATCHES COUNT reach the
 * aggregate; the rest are applied in the client, which is why they do not appear here.
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

  const state = decodeExplorerState(params)

  const [rows, facets] = await Promise.all([
    getExplorer(state.scope, state.view, {
      competitionSeriesId: state.competitionSeriesId,
      year: state.year,
      seasonId: state.seasonId,
      tournamentId: state.tournamentId,
    }),
    getFacets(),
  ])

  return (
    <div className="mx-auto w-full max-w-[110rem] px-4 py-6 sm:px-6">
      <h1 className="mb-3 font-display text-2xl font-bold tracking-tight sm:text-3xl">Rankings</h1>

      <LadderExplorer rows={rows} facets={facets} state={state} />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <HowRankingsWork />
        <span className="ml-auto text-xs text-muted-foreground">
          {state.scope === 'current' ? 'Rolling 365-day ladder' : 'Every completed competition'}
        </span>
      </div>
    </div>
  )
}
