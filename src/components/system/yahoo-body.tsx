import 'server-only'

/**
 * Yahoo archive -- the real page body, extracted so the site builder can place it.
 *
 * Moved here VERBATIM from the route: the same imports, the same reads, the same markup. The builder
 * wraps this as a system module, so a builder-composed page runs the genuine surface -- the same
 * services, the same URL contract, the same behaviour -- rather than a copy that would drift from it.
 *
 * The route is now a shell that supplies metadata and hands the page to the builder.
 */


import { Wide } from '@/components/primitives'
import { getExplorer, getFacets } from '@/lib/stats/ladder-explorer'
import { aggregateFilters, decodeRankingsState } from '@/lib/stats/rankings-columns'
import {
  getYahooSeasonOrder, getYahooSummary, isYahooSeason, yahooNeighbours,
} from '@/lib/yahoo/archive'
import { getSeasonResults } from '@/lib/home/season-results'
import { SeasonResults } from '@/components/home/season-results'
import { YahooWorkspace, type YahooView } from '@/components/yahoo/yahoo-workspace'
import { YAHOO_PARAM_PREFIX } from '@/lib/yahoo/params'
import { YahooSummary } from '@/components/yahoo/yahoo-summary'
import { YahooSeasonPanel } from '@/components/yahoo/yahoo-season-panel'





/**
 * The Yahoo Pool Archive.
 *
 * ── Why the whole experience is one route ────────────────────────────────────────────────────────
 * Home, Groups and Playoffs are views of this page, resolved here from the URL before anything
 * renders. The alternative — mounting the page and then fetching what the URL asked for — shows the
 * wrong season for a frame on every deep link and every Back, which is exactly what a shareable
 * archive must not do. Keeping them on one route also keeps the archive's own header on screen, so a
 * reader looking at a 2007 bracket can still see which era they are in.
 *
 * ── How a Yahoo record is identified ─────────────────────────────────────────────────────────────
 * By the `platform` column, and only by that column. 8BRCAM is the SAME competition on both sides of
 * the cutover, so a rule based on the name, the year or who played would file the current season as
 * history the moment somebody reconstructed an old one.
 */

export async function YahooBody({
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

  const one = (k: string) => params.get(k) ?? undefined
  const requestedView = one('view')
  const requested = Number(one('season'))
  /*
   * A season id in the URL is honoured only if it is genuinely part of this archive.
   *
   * A CueVerse id pasted here must not open the current season inside the historical space — the
   * page would then describe a live competition as history, which is the worst thing it could do.
   */
  const seasonId = Number.isInteger(requested) && requested > 0 && (await isYahooSeason(requested))
    ? requested
    : null

  const wanted: YahooView = requestedView === 'groups' || requestedView === 'playoffs' ? requestedView : 'home'
  /*
   * Groups and Playoffs need a season, and choosing one for the reader would be an invention.
   *
   * So the page stays on Home and says what to do, rather than opening whichever season happened to
   * come first — which would look like an answer to a question nobody asked.
   */
  const needsSeason = wanted !== 'home' && seasonId == null
  const view: YahooView = needsSeason ? 'home' : wanted

  const state = decodeRankingsState(params, new Date(), YAHOO_PARAM_PREFIX)

  const [summary, order, results, facets, rows] = await Promise.all([
    getYahooSummary(),
    getYahooSeasonOrder(),
    getSeasonResults('YAHOO'),
    getFacets('YAHOO'),
    /*
     * The archive ladder: all-time, built from the Yahoo replay alone, narrowed by whatever the
     * reader has filtered. A narrowed period is REPLAYED from the standard initial rating rather
     * than carried in from earlier years — see `isPeriodScoped` in the ladder engine.
     */
    getExplorer('all-time', 'overall', { ...aggregateFilters(state), platform: 'YAHOO' }),
  ])

  const { previous, next } = seasonId != null
    ? yahooNeighbours(order, seasonId)
    : { previous: null, next: null }

  return (
    /*
     * A column, but not a full-height one.
     *
     * The height that matters is applied to the workspace panel, which measures what is left of the
     * window — see the note there. `h-full` here would resolve against `main`, whose height is
     * driven by its own content, and would therefore constrain nothing.
     */
    <Wide name="yahoo" className="ya-frame flex flex-col pb-6 pt-4">
      <YahooWorkspace
        view={view}
        rows={rows}
        facets={facets}
        state={state}
        needsSeason={needsSeason}
        selectedSeasonId={seasonId}
        previous={previous ? { id: previous.id, label: previous.label } : null}
        next={next ? { id: next.id, label: next.label } : null}
        summary={<YahooSummary summary={summary} />}
        seasonResults={
          <SeasonResults
            rows={results}
            /*
             * A row opens the season INSIDE the archive: clicking one switches this page to Groups
             * rather than navigating to /seasons/<id>, so the ladder and the summary stay put.
             */
            hrefFor={(r) => `/yahoo?season=${r.seasonId}&view=groups`}
            selectedId={seasonId}
            allHref="/seasons?platform=yahoo"
            /*
             * Sized by its rows, on every screen.
             *
             * `snap` ends the frame on a row boundary so there is no sliced row and no strip of
             * empty panel beneath the last one, and `self-start` keeps the panel at the top of its
             * column rather than being stretched to the ladder's height.
             */
            snap
            /*
             * Full width, and no `self-start` here.
             *
             * The column it sits in is already top-aligned in the grid. Repeating `self-start` on
             * the panel set align-self on a COLUMN flex container, where the cross axis is
             * horizontal — so instead of pinning the panel to the top it shrank it to the width of
             * its own content, and the box stopped three hundred pixels short of the summary above
             * it.
             */
            panelClassName="w-full"
            frameClassName=""
          />
        }
        seasonPanel={
          seasonId != null && view !== 'home'
            ? <YahooSeasonPanel seasonId={seasonId} view={view} group={one('group') ?? null} />
            : null
        }
      />
    </Wide>
  )
}
