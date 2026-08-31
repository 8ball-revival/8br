'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Download, Search, SlidersHorizontal, X } from 'lucide-react'

/*
 * TYPE-ONLY from the server module, on purpose.
 *
 * `ladder-explorer` is `server-only`. A type import is erased at compile time and costs nothing; a
 * VALUE import from it puts Prisma, Payload and `pg` in the browser bundle, which is what happened
 * when RECORD_VIEWS was briefly imported from here.
 */
import type { ExplorerRow, ExplorerFacets, RecordView } from '@/lib/stats/ladder-explorer'
import type { PlayerDetail } from '@/lib/stats/rankings-detail'
import {
  RECORD_VIEWS, columnsForView, filterRows, sortRows, visibleColumnKeys, encodeRankingsState,
  activeChips, removeChip, hasAnyFilter, activeFilterGroups, defaultState,
  type RankingsState, type SortSpec,
} from '@/lib/stats/rankings-columns'
import { loadPlayerDetail } from '@/app/(frontend)/rankings/actions'
import { cn } from '@/lib/utils'
import { CommandDeck } from '@/components/command-deck'
import { FilterCommandBar, FilterField, SegmentedSwitch, filterControl } from '@/components/cyber/filter-bar'
import { scopePinsCompetition, type RankingScope } from '@/lib/stats/rankings-scope'
import { RankingsRail } from './rankings-rail'
import { ARCHIVE_PLAYER_COL_WIDTH } from './rankings-table'
import { ScopeEmpty, ScopeTabs } from './scope-tabs'

import { FilterDrawer } from './filter-drawer'
import { RankingsTable } from './rankings-table'
import { RatingLegend } from './rating-legend'
import { Methodology } from './methodology'

/**
 * The Rankings page shell.
 *
 * ── What this used to be ─────────────────────────────────────────────────────────────────────────
 * Current/All-Time, Overall/Group/Playoffs/Tournaments, four density presets, a Columns button, an SC/TC
 * switch, saved views, a pin gutter and a permanently open row of eleven filters — roughly a
 * screenful of controls above the table they configured. Every one of them answered a question, but
 * collectively they answered nobody's: the page opened on a configuration screen rather than on the
 * rankings.
 *
 * It is now permanently the official all-time overall table. Search stays in the toolbar because
 * "where is this player" is the single most common thing anyone wants; everything else moved behind
 * More Filters, where it can be set as one decision instead of one twitch of the table per click.
 *
 * ── Where state lives ────────────────────────────────────────────────────────────────────────────
 * The URL is the truth. Filters that change WHICH MATCHES COUNT are applied by navigating, because
 * the aggregate has to be recomputed on the server; sorting, search and column visibility are
 * applied to the rows already in hand, because they cannot change the population. Both end up in
 * the query string, so a shared link reproduces exactly what the sender saw.
 */

export interface RankingsExplorerProps {
  rows: ExplorerRow[]
  facets: ExplorerFacets
  state: RankingsState
  /**
   * The masthead line, rendered here rather than by the page.
   *
   * The result count belongs beside the title — "Rankings · 60 players" is one statement — and the
   * count is a function of the filters, which only this component knows. Rendering the heading on
   * the server and the count in the client would have put them in different rows.
   */
  heading: React.ReactNode
  /**
   * Whether to offer the CSV export.
   *
   * Resolved on the server and handed down. The route refuses non-staff regardless; this only avoids
   * showing a control that would answer 403.
   */
  canExport?: boolean
  /**
   * Where this table lives, and how its parameters are named there.
   *
   * The archive renders THIS component -- the same filters, the same rail, the same columns -- over
   * Yahoo rows at /yahoo. It is the same table, so it is the same code; only the URL it writes back
   * to differs. `keepParams` carries the parameters the host page owns (which season is open, which
   * view) through a filter change, so filtering the ladder never closes the season beside it.
   */
  basePath?: string
  paramPrefix?: string
  keepParams?: Record<string, string>
  /** The four current-ranking scopes belong to the current ladder, and only to it. */
  showScopes?: boolean
  eyebrow?: string
  title?: string
  /** Rendered in the deck's top-right — the archive puts its Minimize control there. */
  action?: React.ReactNode
  /**
   * Fill the height given by the parent, and scroll the table rather than the page.
   *
   * Off by default, which is the Rankings page: there the table is the page, and it scrolls with it.
   * The archive turns it on, because its expanded ladder lives inside a frame that reaches the bottom
   * of the window — and in that frame the rating legend has to stay put while five hundred players
   * move past above it, exactly as it does in the compact view.
   *
   * When off, the extra wrappers are `display: contents`, so the DOM shape is the same in both modes
   * and the Rankings page lays out exactly as it did before this prop existed.
   */
  fillHeight?: boolean
}

export function RankingsExplorer({
  rows, facets, state, heading, canExport = false,
  basePath = '/rankings', paramPrefix = '', keepParams, showScopes = true,
  eyebrow = 'Ranking Ladder', title = 'Rankings', action, fillHeight = false,
}: RankingsExplorerProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const topOffset = useHeaderOffset()
  const now = useMemo(() => new Date(), [])

  /*
   * The applied state IS the prop.
   *
   * Deliberately not copied into local state. The server renders from the URL, so a local mirror
   * would be a second source of truth that has to be resynced on every navigation — and would show
   * the reader a stale view for one frame after Back or Forward.
   */
  const applied = state

  const [search, setSearch] = useState(state.rowFilters.search)
  const [sort, setSort] = useState<SortSpec[]>(state.sort)
  const [expanded, setExpanded] = useState<string | null>(state.expanded)
  const [details, setDetails] = useState<Record<string, PlayerDetail | 'loading'>>({})
  const [drawerOpen, setDrawerOpen] = useState(false)
  const moreFiltersRef = useRef<HTMLButtonElement | null>(null)

  /*
   * Which record the table's Record and Win% columns describe.
   *
   * Local rather than in the URL because it changes what is DISPLAYED, not which players are
   * ranked: the ladder, the order and the ratings are identical whichever is selected. Putting it
   * in the URL would make two links that return the same standing look like different queries.
   *
   * The splits it switches between are already on every row - the aggregate carries group, playoff
   * and tournament wins and losses separately - so nothing is recomputed or re-fetched.
   */
  const [recordScope, setRecordScope] = useState<RecordView>('overall')

  /*
   * The time-range preset, derived from the applied bounds rather than stored beside them.
   *
   * A second copy would drift the moment somebody set exact years in More Filters: the select would
   * still read "Last 5 years" over a range that was no longer five years. Deriving it means the bar
   * always describes what is actually applied, and falls back to showing the span when the bounds
   * match no preset.
   */
  const yearPreset = useMemo(() => {
    const max = facets.years.length ? Math.max(...facets.years) : applied.toYear
    const min = facets.years.length ? Math.min(...facets.years) : applied.fromYear
    if (applied.fromYear <= min && applied.toYear >= max) return 'all'
    const span = applied.toYear - applied.fromYear + 1
    return applied.toYear === max && [1, 3, 5, 10].includes(span) ? String(span) : 'custom'
  }, [applied.fromYear, applied.toYear, facets.years])

  /** Push a new applied state into the URL. The server recomputes and sends new rows back. */
  const navigate = useCallback((next: RankingsState) => {
    const p = new URLSearchParams(encodeRankingsState(next, now, paramPrefix))
    // The host page's own parameters survive a filter change; without this, narrowing the archive
    // ladder would close the season open beside it.
    for (const [k, v] of Object.entries(keepParams ?? {})) p.set(k, v)
    const qs = p.toString()
    startTransition(() => router.push(qs ? `${basePath}?${qs}` : basePath, { scroll: false }))
  }, [router, now, basePath, paramPrefix, keepParams])

  // Search is a row filter, so it is applied locally at once and written to the URL as it settles —
  // typing that waits for a round trip feels broken however fast the round trip is.
  useEffect(() => {
    if (search === applied.rowFilters.search) return
    const t = setTimeout(() => {
      navigate({ ...applied, rowFilters: { ...applied.rowFilters, search } })
    }, 350)
    return () => clearTimeout(t)
  }, [search, applied, navigate])

  /*
   * The columns for the chosen record view.
   *
   * `columnsForView` already existed and already knew which columns belong to which stage; the
   * segmented switch simply drives it. Intersecting with the reader's chosen visible columns keeps
   * both preferences: switching to Playoffs does not silently re-enable a column they hid.
   */
  const columns = useMemo(() => {
    /*
      Ordered by `visibleColumnKeys`, not by the order the columns happen to be DECLARED in.

      Those two agreed for as long as there was one column set, so filtering the declaration list
      was indistinguishable from ordering by the key list — until the archive wanted its
      championship column somewhere other than where its definition sits, and the reorder silently
      did nothing. `visibleColumnKeys` is documented as "the keys actually rendered, in canonical
      order"; this now honours that rather than approximating it.
    */
    const forView = new Map(columnsForView(recordScope, applied.profile ?? 'rankings').map((c) => [c.key, c]))
    return visibleColumnKeys({ ...applied, sort })
      .map((key) => forView.get(key))
      .filter((c): c is NonNullable<typeof c> => c != null)
  }, [applied, sort, recordScope])

  const visible = useMemo(() => {
    const filtered = filterRows(rows, { ...applied.rowFilters, search })
    return sortRows(filtered, sort)
  }, [rows, applied.rowFilters, search, sort])

  /** The years this table spans, so a chip describes a narrowing rather than the table itself. */
  const yearBounds = useMemo(() => (facets.years.length
    ? { min: Math.min(...facets.years), max: Math.max(...facets.years) }
    : undefined), [facets.years])

  /*
    A year filter is only a question where there is more than one year to choose between.

    With a single year of results every setting returns the same rows, so the control is withheld
    and — because it cannot be set — the state's year bounds are never a narrowing. Comparing them
    against the data's single year would report a filter nobody applied: a "Years: 2005–2026" chip
    and a "More 1" badge on an untouched ladder, which is what taught readers to ignore both.
  */
  /*
    The archive opens a panel under the row; the live ladder links the name to a profile.

    Handed to the table as an expander or not at all, so the table never has to interpret which
    kind of ladder it is drawing. Yahoo behaves exactly as it did.
  */
  const isArchive = applied.profile === 'archive'

  /*
    The archive always offers it; the live ladder only once there is a second year to choose.

    Keyed on the profile rather than on the facet count, because the archive does not always report
    year facets and the count alone withdrew a control Yahoo has always had.
  */
  const spansMultipleYears = isArchive || facets.years.length > 1
  const narrowingBounds = spansMultipleYears ? yearBounds : undefined

  const chips = useMemo(() => activeChips(applied, {
    competition: facets.competitions.find((c) => c.id === applied.competitionSeriesId)?.name,
    season: facets.seasons.find((s) => s.id === applied.seasonId)?.label,
    cup: facets.tournaments.find((t) => t.id === applied.tournamentId)?.label,
  }, now, narrowingBounds), [applied, facets, now, narrowingBounds])

  const groupCount = activeFilterGroups(applied, now).length

  const onSort = useCallback((key: string, additive: boolean) => {
    setSort((prev) => {
      const existing = prev.find((s) => s.key === key)
      const next: SortSpec = existing
        ? { key, dir: existing.dir === 'desc' ? 'asc' : 'desc' }
        : { key, dir: 'desc' }
      return additive ? [...prev.filter((s) => s.key !== key), next] : [next]
    })
  }, [])

  // One request per player, ever. A second click on the same row reads what is already here.
  const inFlight = useRef(new Set<string>())
  const onToggleExpand = useCallback((row: ExplorerRow) => {
    setExpanded((cur) => (cur === row.playerId ? null : row.playerId))
    if (details[row.playerId] || inFlight.current.has(row.playerId)) return
    inFlight.current.add(row.playerId)
    setDetails((d) => ({ ...d, [row.playerId]: 'loading' }))
    void loadPlayerDetail(row.playerId, 'all-time')
      .then((detail) => setDetails((d) => {
        // A null answer means there is nothing to show. Leaving 'loading' in place would spin for
        // ever; removing the key lets a later click try again.
        if (!detail) { const next = { ...d }; delete next[row.playerId]; return next }
        return { ...d, [row.playerId]: detail }
      }))
      .catch(() => setDetails((d) => { const next = { ...d }; delete next[row.playerId]; return next }))
      .finally(() => inFlight.current.delete(row.playerId))
  }, [details])

  const exportHref = useMemo(() => {
    const qs = encodeRankingsState({ ...applied, sort, rowFilters: { ...applied.rowFilters, search } }, now)
    return qs ? `/rankings/export?${qs}` : '/rankings/export'
  }, [applied, sort, search, now])

  return (
    /*
     * `contents` when not filling, so this wrapper is invisible to layout and the Rankings page is
     * untouched. A conditional COMPONENT here would be a different element type on each render and
     * would remount the table -- losing the search box, the sort and the open row -- so the element
     * stays and only its class changes.
     */
    <div className={fillHeight ? 'flex min-h-0 flex-1 flex-col' : 'contents'}>
      <CommandDeck
        eyebrow={eyebrow}
        title={title}
        meta={heading}
        stats={[{ label: 'Ranked players', value: visible.length.toLocaleString() }]}
      >
        <p className="sr-only" aria-live="polite">
          {visible.length.toLocaleString()} {visible.length === 1 ? 'player' : 'players'}
        </p>
        {action}
      </CommandDeck>

      {/*
        ── The scope ─────────────────────────────────────────────────────────────────────────────
        Which ladder, chosen before anything that narrows it. Changing scope abandons the
        competition, season and tournament selections: they were chosen inside the previous scope
        and carrying them across would silently return nothing.
      */}
      {showScopes && (
      <ScopeTabs
        scope={applied.scope}
        pending={pending}
        onSelect={(next: RankingScope) => navigate({
          ...applied,
          scope: next,
          competitionSeriesId: null,
          seasonId: null,
          tournamentId: null,
          division: null,
          eventType: 'all',
        })}
      />
      )}

      {/*
        ── The filter command bar ────────────────────────────────────────────────────────────────
        Every control that narrows the ladder, in one acid strip, each with a visible label.

        These map onto state that already exists rather than onto new concepts: Platform is the
        ranking universe, Competition is the series, Time range is the inclusive year bounds, and
        Record type is the event kind. The segmented switch on the right chooses WHICH record the
        table shows, which the row data already carries split by stage.
      */}
      {/*
        The filter bar is withheld when the scope has no results at all. Controls that narrow
        nothing invite the reader to conclude they have filtered the table empty, when in fact the
        competition has not finished yet -- which is what the panel below says instead.
      */}
      {rows.length > 0 && (
      <FilterCommandBar
        actions={
          <>
            <SegmentedSwitch
              label="Record shown"
              value={recordScope}
              onChange={setRecordScope}
              options={RECORD_VIEWS.map((v) => ({ value: v.id, label: v.label }))}
            />
            <button
              ref={moreFiltersRef}
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={drawerOpen}
              className="cyber-clip-sm inline-flex items-center gap-2 border border-[var(--acid-ink)]/30 bg-[var(--void)] px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-[var(--acid)] transition-colors hover:bg-[var(--graphite-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cyan)]"
            >
              <SlidersHorizontal className="size-3.5" aria-hidden />
              More
              {groupCount > 0 && (
                <span
                  className="grid min-w-4 place-items-center bg-[var(--acid)] px-1 text-[0.66rem] font-bold text-[var(--acid-ink)]"
                  aria-label={`${groupCount} filter ${groupCount === 1 ? 'group' : 'groups'} applied`}
                >
                  {groupCount}
                </span>
              )}
            </button>
          </>
        }
      >
        {/*
          Platform used to be the first control here, offering CueVerse or Yahoo. The archive is its
          own page now, so this table is permanently the current CueVerse ladder and there is nothing
          left to choose. Competition and Record type are hidden under the three narrow scopes for
          the same reason: the scope has already decided them, and a control that cannot change
          anything is worse than no control at all.
        */}
        {!scopePinsCompetition(applied.scope) && (
        <FilterField label="Competition" htmlFor="rk-competition" className="w-[11rem]">
          <select
            id="rk-competition"
            className={filterControl}
            value={applied.competitionSeriesId ?? ''}
            onChange={(e) => navigate({
              ...applied,
              competitionSeriesId: e.target.value === '' ? null : Number(e.target.value),
              // A season chosen inside another competition cannot survive the competition changing.
              seasonId: null,
            })}
          >
            <option value="">All competitions</option>
            {facets.competitions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </FilterField>
        )}

        {/*
          ── Offered on the archive, withheld on the live ladder ─────────────────────────────
          The Yahoo archive spans 2005 to 2014, so narrowing it by year is a real question. The
          live ladder holds one year of results and will until the next one begins: every setting
          of this control returns the same table, and the only thing it can do is make an
          unfiltered ladder look filtered. It comes back when there is a second year to choose.
        */}
        {spansMultipleYears && (
        <FilterField label="Time range" htmlFor="rk-years" className="w-[9.5rem]">
          {/*
            Presets rather than two year pickers. The bar has room for one control, and "since 2020"
            is what somebody actually wants; the exact bounds stay available in More Filters.
          */}
          <select
            id="rk-years"
            className={filterControl}
            value={yearPreset}
            onChange={(e) => {
              const v = e.target.value
              const max = facets.years.length ? Math.max(...facets.years) : applied.toYear
              const min = facets.years.length ? Math.min(...facets.years) : applied.fromYear
              const from = v === 'all' ? min : max - Number(v) + 1
              navigate({ ...applied, fromYear: from, toYear: max })
            }}
          >
            {/* Present only while it applies, so the control never displays a preset that is not in force. */}
            {yearPreset === 'custom' && (
              <option value="custom">{applied.fromYear}-{applied.toYear}</option>
            )}
            <option value="all">All time</option>
            <option value="1">This year</option>
            <option value="3">Last 3 years</option>
            <option value="5">Last 5 years</option>
            <option value="10">Last 10 years</option>
          </select>
        </FilterField>
        )}

        {!scopePinsCompetition(applied.scope) && (
        <FilterField label="Record type" htmlFor="rk-event" className="w-[9.5rem]">
          <select
            id="rk-event"
            className={filterControl}
            value={applied.eventType}
            onChange={(e) => navigate({ ...applied, eventType: e.target.value as typeof applied.eventType })}
          >
            <option value="all">All events</option>
            <option value="seasons">Seasons only</option>
            <option value="cups">Tournaments only</option>
          </select>
        </FilterField>
        )}

        <FilterField label="Player search" htmlFor="rk-search" className="min-w-[11rem] flex-1 sm:max-w-xs">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" aria-hidden />
            <input
              id="rk-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="CueVerse ID or name"
              className={cn(filterControl, 'pl-8 pr-7')}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-2 top-2 text-muted-foreground hover:text-[var(--cyan)]"
              >
                <X className="size-4" aria-hidden />
              </button>
            )}
          </div>
        </FilterField>
      </FilterCommandBar>
      )}

      {/* ── Applied filters, as chips that remove themselves. */}
      {(chips.length > 0 || hasAnyFilter(applied, now)) && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => navigate(removeChip(applied, c.key, now, yearBounds))}
              aria-label={`Remove filter: ${c.label}`}
              className="inline-flex items-center gap-1 cyber-clip-sm border border-border bg-card px-2.5 py-1 text-xs transition-colors hover:border-[var(--gold)]/50"
            >
              {c.label}
              <X className="size-3 text-muted-foreground" aria-hidden />
            </button>
          ))}
          <button
            type="button"
            onClick={() => { setSearch(''); navigate(defaultState(now)) }}
            className="rounded px-2 py-1 text-xs text-[var(--gold)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
          >
            Clear All
          </button>
        </div>
      )}

      {/*
        ── The leaderboard and its analysis ──────────────────────────────────────────────────────
        The rail is a SECOND COLUMN on a wide screen and a block BENEATH the table on a narrow one,
        which is the whole reason it is a grid rather than a float: on a phone the leaderboard is
        what somebody came for, and analysis of it belongs after it rather than above it.

        The rail is handed the rows the table is rendering. It cannot disagree with the table
        because it is looking at the same array.
      */}
      {/* The rows are the only part that scrolls when this table is filling a frame. */}
      <div className={fillHeight ? 'scrollbar-themed min-h-0 flex-1 overflow-y-auto pr-1' : 'contents'}>
      <div id="rk-scope-panel" role="tabpanel" aria-labelledby={`rk-scope-${applied.scope}`} tabIndex={-1}>
      {rows.length === 0 ? (
        <ScopeEmpty scope={applied.scope} />
      ) : (
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
        <div className={cn('min-w-0 transition-opacity', pending && 'opacity-60')}>
          <RankingsTable
            rows={visible}
            columns={columns}
            sort={sort}
            onSort={onSort}
            {...(isArchive ? { expanded, onToggleExpand, details } : {})}
            minMatches={applied.rowFilters.minMatches}
            topOffset={topOffset}
            /*
              The archive carries one more statistic column than the live ladder, and the width has
              to come from somewhere. It comes from the Player column, which is the widest thing on
              the table and the one with the most slack: both identity lines still fit at a normal
              desktop width, and each already carries its full value in a `title` for the rare case
              a long name has to be clipped.
            */
            playerColumnWidth={applied.profile === 'archive' ? ARCHIVE_PLAYER_COL_WIDTH : undefined}
            emptyMessage={
              hasAnyFilter(applied, now) || search
                ? 'No players match these filters.'
                : 'No ranked players yet.'
            }
          />
        </div>

        {/* The rail's championship panel must count what the column counts. See `championshipsOf`. */}
        <RankingsRail rows={visible} profile={applied.profile} />
      </div>
      )}
      </div>
      </div>

      {/*
        The legend is a footer of the frame, not the last row of the table.
        Outside the scroller and after it, so it stays visible while the rows move, and it never
        overlays one -- it occupies its own space rather than floating above.
      */}
      <div className={cn('mt-3 flex flex-wrap items-center gap-3', fillHeight && 'shrink-0')}>
        {/* The colour key sits with the table it explains, not up in the filter bar. */}
        <RatingLegend className="min-w-0" />
        <Methodology />
        {/*
          Staff only, and the route refuses everybody else regardless.
          Hiding this alone would be decorative: the export is a plain GET with query parameters, so
          anybody who had seen the URL once could keep fetching it. The gate is on the route; this
          just avoids offering a control that would answer 403.
        */}
        {canExport && (
          <a
            href={exportHref}
            className="cyber-clip-sm inline-flex items-center gap-1.5 border border-[var(--line-strong)] px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-[var(--cyan)] hover:text-[var(--cyan)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <Download className="size-3.5" aria-hidden />
            Export CSV
          </a>
        )}
      </div>

      <FilterDrawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false)
          // Focus goes back where it came from, or a keyboard reader is dropped at the top of the
          // document with no idea what just closed.
          moreFiltersRef.current?.focus()
        }}
        applied={applied}
        onApply={navigate}
        facets={{
          competitions: facets.competitions,
          years: facets.years,
          seasons: facets.seasons.map((s) => ({ id: s.id, label: s.label, year: s.year, seriesId: s.competitionSeriesId ?? null })),
          cups: facets.tournaments.map((t) => ({ id: t.id, label: t.label, year: t.year })),
          divisions: facets.divisions,
        }}
      />
    </div>
  )
}

/**
 * How far down the page the sticky table header must sit.
 *
 * Measured from the rendered navigation rather than assumed, because a hardcoded offset is wrong
 * the first time the header wraps — and wrong in a way that only shows up while scrolling.
 */
function useHeaderOffset(): number {
  const [offset, setOffset] = useState(64)
  useEffect(() => {
    const header = document.querySelector('header')
    if (!header) return
    const measure = () => setOffset(Math.round(header.getBoundingClientRect().height))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(header)
    return () => ro.disconnect()
  }, [])
  return offset
}
