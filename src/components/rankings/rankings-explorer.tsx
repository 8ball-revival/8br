'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Download, Search, SlidersHorizontal, X } from 'lucide-react'

import type { ExplorerRow, ExplorerFacets } from '@/lib/stats/ladder-explorer'
import type { PlayerDetail } from '@/lib/stats/rankings-detail'
import {
  COLUMN_BY_KEY, filterRows, sortRows, visibleColumnKeys, encodeRankingsState,
  activeChips, removeChip, hasAnyFilter, activeFilterGroups, defaultState,
  type RankingsState, type SortSpec,
} from '@/lib/stats/rankings-columns'
import { loadPlayerDetail } from '@/app/(frontend)/rankings/actions'
import { cn } from '@/lib/utils'

import { FilterDrawer } from './filter-drawer'
import { RankingsTable } from './rankings-table'
import { RatingLegend } from './rating-legend'
import { Methodology } from './methodology'

/**
 * The Rankings page shell.
 *
 * ── What this used to be ─────────────────────────────────────────────────────────────────────────
 * Current/All-Time, Overall/Group/Playoffs/Cups, four density presets, a Columns button, an SC/TC
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
}

export function RankingsExplorer({ rows, facets, state }: RankingsExplorerProps) {
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

  /** Push a new applied state into the URL. The server recomputes and sends new rows back. */
  const navigate = useCallback((next: RankingsState) => {
    const qs = encodeRankingsState(next, now)
    startTransition(() => router.push(qs ? `/rankings?${qs}` : '/rankings', { scroll: false }))
  }, [router, now])

  // Search is a row filter, so it is applied locally at once and written to the URL as it settles —
  // typing that waits for a round trip feels broken however fast the round trip is.
  useEffect(() => {
    if (search === applied.rowFilters.search) return
    const t = setTimeout(() => {
      navigate({ ...applied, rowFilters: { ...applied.rowFilters, search } })
    }, 350)
    return () => clearTimeout(t)
  }, [search, applied, navigate])

  const columns = useMemo(
    () => visibleColumnKeys({ ...applied, sort }).map((k) => COLUMN_BY_KEY[k]).filter(Boolean),
    [applied, sort],
  )

  const visible = useMemo(() => {
    const filtered = filterRows(rows, { ...applied.rowFilters, search })
    return sortRows(filtered, sort)
  }, [rows, applied.rowFilters, search, sort])

  const chips = useMemo(() => activeChips(applied, {
    competition: facets.competitions.find((c) => c.id === applied.competitionSeriesId)?.name,
    season: facets.seasons.find((s) => s.id === applied.seasonId)?.label,
    cup: facets.tournaments.find((t) => t.id === applied.tournamentId)?.label,
  }, now), [applied, facets, now])

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
    <>
      {/* ── Toolbar: search, what the colours mean, filters, and how many players match. */}
      <div className="mb-3 flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a player"
            aria-label="Find a player"
            className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-8 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-2 top-2.5 rounded text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>

        <RatingLegend className="order-last w-full sm:order-none sm:w-auto" />

        <button
          ref={moreFiltersRef}
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={drawerOpen}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm transition-colors hover:border-[var(--gold)]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
        >
          <SlidersHorizontal className="size-4" aria-hidden />
          More Filters
          {groupCount > 0 && (
            <span
              className="grid min-w-5 place-items-center rounded-full bg-[var(--gold)] px-1 text-[0.68rem] font-bold text-black"
              aria-label={`${groupCount} filter ${groupCount === 1 ? 'group' : 'groups'} applied`}
            >
              {groupCount}
            </span>
          )}
        </button>

        <p className="ml-auto self-center text-xs text-muted-foreground" aria-live="polite">
          <span className="tabular-nums">{visible.length.toLocaleString()}</span>{' '}
          {visible.length === 1 ? 'player' : 'players'}
        </p>
      </div>

      {/* ── Applied filters, as chips that remove themselves. */}
      {(chips.length > 0 || hasAnyFilter(applied, now)) && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => navigate(removeChip(applied, c.key, now))}
              aria-label={`Remove filter: ${c.label}`}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs transition-colors hover:border-[var(--gold)]/50"
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

      <div className={cn('transition-opacity', pending && 'opacity-60')}>
        <RankingsTable
          rows={visible}
          columns={columns}
          sort={sort}
          onSort={onSort}
          expanded={expanded}
          onToggleExpand={onToggleExpand}
          details={details}
          minMatches={applied.rowFilters.minMatches}
          topOffset={topOffset}
          emptyMessage={
            hasAnyFilter(applied, now) || search
              ? 'No players match these filters.'
              : 'No ranked players yet.'
          }
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Methodology />
        <a
          href={exportHref}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-[var(--gold)]/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
        >
          <Download className="size-3.5" aria-hidden />
          Export CSV
        </a>
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
          seasons: facets.seasons.map((s) => ({ id: s.id, label: s.label, year: s.year, seriesId: s.competitionSeriesId ?? null })),
          cups: facets.tournaments.map((t) => ({ id: t.id, label: t.label, year: t.year })),
          divisions: facets.divisions,
        }}
      />
    </>
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
