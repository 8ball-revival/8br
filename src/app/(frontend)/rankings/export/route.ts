import { NextResponse, type NextRequest } from 'next/server'

import { computeExplorer, computeFacets } from '@/lib/stats/ladder-explorer'
import { decodeRankingsState, aggregateFilters, activeChips } from '@/lib/stats/rankings-columns'
import { UNASSIGNED_DIVISION } from '@/lib/stats/rankings-facts'
import { buildRankingsCsv, csvFilename } from '@/lib/stats/rankings-csv'

export const dynamic = 'force-dynamic'

/**
 * CSV export of the current Rankings view.
 *
 * Built from the SAME canonical aggregate the page renders, driven by the same query string — so
 * the export is the table, not a picture of it. Scraping the rendered rows would have exported
 * formatted strings, would have missed any column the reader had switched off, and would have
 * silently truncated to whatever was on screen.
 *
 * Only public ranking statistics leave here. Email, credentials, moderation state and staff-only
 * fields are not part of the row type at all, so no future column can leak them by accident.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const state = decodeRankingsState(params)

  const [rows, facets] = await Promise.all([
    computeExplorer(state.scope, state.view, aggregateFilters(state)),
    computeFacets(),
  ])

  const chips = activeChips(state, {
    competition: facets.competitions.find((c) => c.id === state.competitionSeriesId)?.name,
    season: facets.seasons.find((s) => s.id === state.seasonId)?.label,
    tournament: facets.tournaments.find((t) => t.id === state.tournamentId)?.label,
  })
  const filterSummary = chips.length
    ? chips.map((c) => c.label).join('; ')
    : state.division === UNASSIGNED_DIVISION ? 'Division unassigned' : 'None'

  const csv = buildRankingsCsv({ rows, state, filterSummary })

  // A UTF-8 BOM so Excel opens accented handles correctly instead of as mojibake. Every other
  // consumer ignores it.
  const body = `﻿${csv}`
  const stamp = new Date().toISOString().slice(0, 10)

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csvFilename(state, stamp)}"`,
      'Cache-Control': 'no-store',
    },
  })
}
