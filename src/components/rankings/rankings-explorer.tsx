'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Columns3, Download, Gem, Loader2, RotateCcw, Search, Trophy, X } from 'lucide-react'

import type { ExplorerRow, ExplorerFacets, RecordView } from '@/lib/stats/ladder-explorer'
import type { PlayerDetail, HeadToHeadPair } from '@/lib/stats/rankings-detail'
import {
  COLUMNS, COLUMN_GROUPS, COLUMN_BY_KEY, columnsForView, visibleKeys, keysForDensity,
  cycleSort, sortRows, filterRows, activeChips, hasAnyFilter,
  encodeRankingsState, availableSavedViews, applySavedView, partitionPinned,
  DENSITIES, MAX_COMPARE, UNASSIGNED_DIVISION,
  type ChampionshipMode, type Density, type RankingsState, type SortSpec,
} from '@/lib/stats/rankings-columns'
import { usePins, useDevicePrefs } from '@/lib/stats/rankings-device-store'
import { loadPlayerDetail, loadHeadToHead } from '@/app/(frontend)/rankings/actions'
import { cn } from '@/lib/utils'

import { ComparePanel } from './compare-panel'
import { Methodology } from './methodology'
import { RankingsTable } from './rankings-table'
import { Tip } from './tooltip'

/**
 * The Rankings explorer.
 *
 * ── Two kinds of control, and why the difference matters ─────────────────────────────────────────
 *
 *  - Controls that change WHICH MATCHES COUNT — scope, record view, and every competition filter
 *    including division and the year range — must re-run the aggregate, so they navigate. Narrowing
 *    to one Season has to recompute every record from that Season alone; hiding rows client-side
 *    would leave career figures on screen under a Season heading, which would be a lie.
 *
 *  - Controls that only change WHAT IS SHOWN — SC/TC, sorting, density and columns, the search box,
 *    the minimum-match threshold, champions-only, singles/teams, active-only, pins and the
 *    comparison — are local state. They never navigate, so nothing reloads and no other choice is
 *    reset by touching them.
 *
 * Both kinds end up in the URL so a configured table can be shared, but the local ones are written
 * with `history.replaceState`, which updates the address bar without asking Next for a new render.
 */

/** Stable identity, so the derived "no pairs" value does not change on every render. */
const EMPTY_PAIRS: HeadToHeadPair[] = []

const SCOPES: { id: 'current' | 'all-time'; label: string; hint: string }[] = [
  { id: 'current', label: 'Current', hint: 'Rolling 365-day window. Official ranks are authoritative here.' },
  { id: 'all-time', label: 'All Time', hint: 'Every completed competition on record' },
]

const VIEW_TABS: { id: RecordView; label: string; hint: string }[] = [
  { id: 'overall', label: 'Overall', hint: 'Every recorded match, Seasons and Cups together' },
  { id: 'group', label: 'Group Play', hint: 'Season group stages only' },
  { id: 'playoff', label: 'Playoffs', hint: 'Season playoff brackets only' },
  { id: 'tournament', label: 'Cups', hint: 'Standalone Cups only' },
]

/**
 * Where the sticky table pane parks, measured from the REAL rendered site header.
 *
 * The header is `sticky top-0` and 64px tall today, but it wraps at some widths and its height is a
 * layout outcome rather than a constant. Reading it means the offset cannot drift out of step with
 * it, and there is no unexplained number in the stylesheet.
 */
function useHeaderOffset(): number {
  const [offset, setOffset] = useState(64)
  useLayoutEffect(() => {
    const el = document.querySelector('[data-site-header]')
    if (!el) return
    const measure = () => setOffset(Math.round(el.getBoundingClientRect().height))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return offset
}

export interface RankingsExplorerProps {
  rows: ExplorerRow[]
  facets: ExplorerFacets
  state: RankingsState
}

export function RankingsExplorer({ rows, facets, state }: RankingsExplorerProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const topOffset = useHeaderOffset()

  // ── Local, display-only state.
  const [mode, setMode] = useState<ChampionshipMode>(state.mode)
  const [sort, setSort] = useState<SortSpec[]>(state.sort)
  const [rowFilters, setRowFilters] = useState(state.rowFilters)
  const [densityOverride, setDensityOverride] = useState<Density | null>(null)
  const [columnsOverride, setColumnsOverride] = useState<string[] | null | undefined>(undefined)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(state.expanded)
  const [details, setDetails] = useState<Record<string, PlayerDetail | 'loading'>>({})
  const [pins, togglePin] = usePins()
  const [devicePrefs, writeDevicePrefs] = useDevicePrefs()
  const [compare, setCompare] = useState<string[]>(state.compare)
  const [headToHead, setHeadToHead] = useState<HeadToHeadPair[]>([])
  const [h2hLoading, setH2hLoading] = useState(false)

  /**
   * Which column layout is in force, DERIVED rather than copied into state on mount.
   *
   * The precedence, in order:
   *   1. what the reader has changed during this visit;
   *   2. what the URL asked for — a shared link has to reproduce what the sender saw, so someone
   *      else's saved Compact preference must not quietly reshape a link that asked for Full;
   *   3. this device's saved preference.
   *
   * Deriving it means there is no effect copying storage into state, so no render happens without
   * the reader's preference and then again with it.
   */
  const urlSpecifiedLayout = state.columns != null || state.density !== 'standard'
  const density: Density = densityOverride
    ?? (urlSpecifiedLayout ? state.density : devicePrefs.density)
  const customColumns: string[] | null = columnsOverride !== undefined
    ? columnsOverride
    : urlSpecifiedLayout ? state.columns : devicePrefs.columns

  /** Change the layout, and remember it on this device. */
  const setLayout = useCallback((next: { density: Density; columns: string[] | null }) => {
    setDensityOverride(next.density)
    setColumnsOverride(next.columns)
    writeDevicePrefs(next)
  }, [writeDevicePrefs])

  // ── Columns
  const available = useMemo(() => columnsForView(state.view), [state.view])
  const shownKeys = useMemo(
    () => visibleKeys(density, state.view, customColumns),
    [density, state.view, customColumns])
  const shown = useMemo(
    () => shownKeys.map((k) => COLUMN_BY_KEY[k]).filter(Boolean),
    [shownKeys])

  // ── Rows
  const filtered = useMemo(() => filterRows(rows, rowFilters, mode), [rows, rowFilters, mode])
  const ordered = useMemo(() => sortRows(filtered, sort, mode), [filtered, sort, mode])
  const { pinned, rest } = useMemo(() => partitionPinned(ordered, pins), [ordered, pins])
  const compareRows = useMemo(
    () => compare.map((id) => rows.find((r) => r.playerId === id)).filter((r): r is ExplorerRow => !!r),
    [compare, rows])

  // ── Address bar, kept in step without triggering a refetch.
  const currentState: RankingsState = useMemo(() => ({
    ...state, mode, sort, rowFilters, density,
    columns: density === 'custom' ? customColumns : null,
    expanded, compare,
  }), [state, mode, sort, rowFilters, density, customColumns, expanded, compare])

  useEffect(() => {
    const qs = encodeRankingsState(currentState)
    window.history.replaceState(null, '', qs ? `/rankings?${qs}` : '/rankings')
  }, [currentState])

  /** Controls that change the aggregate: navigate so the server recomputes. */
  const navigate = useCallback((patch: Partial<RankingsState>) => {
    const qs = encodeRankingsState({ ...currentState, ...patch })
    startTransition(() => router.push(qs ? `/rankings?${qs}` : '/rankings', { scroll: false }))
  }, [currentState, router])

  /**
   * Fetch a player's history.
   *
   * The in-flight set is a ref rather than state on purpose: it exists only to stop the same
   * request going out twice, and writing it must not schedule a render. `details[id] === undefined`
   * already means "loading" to the panel, so there is no placeholder to write synchronously either
   * — which is what keeps this callable from an effect.
   */
  const inFlight = useRef(new Set<string>())
  const fetchDetail = useCallback((playerId: string) => {
    if (inFlight.current.has(playerId)) return
    inFlight.current.add(playerId)
    void loadPlayerDetail(playerId, state.scope)
      .then((detail) => { if (detail) setDetails((d) => ({ ...d, [playerId]: detail })) })
      .finally(() => { inFlight.current.delete(playerId) })
  }, [state.scope])

  const toggleExpand = useCallback((row: ExplorerRow) => {
    const next = expanded === row.playerId ? null : row.playerId
    setExpanded(next)
    if (next && !details[next]) fetchDetail(next)
  }, [expanded, details, fetchDetail])

  // An expanded player named in the URL is opened on arrival, so a shared link lands on the row.
  useEffect(() => {
    if (state.expanded && !details[state.expanded]) fetchDetail(state.expanded)
  }, [state.expanded, details, fetchDetail])

  // ── Comparison
  const toggleCompare = useCallback((playerId: string) => {
    setCompare((c) => {
      const next = c.includes(playerId)
        ? c.filter((id) => id !== playerId)
        : c.length >= MAX_COMPARE ? c : [...c, playerId]
      // Set from the event, not from an effect: the click is what starts the lookup.
      if (next.length >= 2) { setHeadToHead([]); setH2hLoading(true) }
      return next
    })
  }, [])

  useEffect(() => {
    // Fewer than two players is not a fetch and not a state change: the derived value below is
    // simply empty. Clearing the state here would be a synchronous setState inside an effect, and
    // would render the previous pair for one frame on the way to showing nothing.
    if (compare.length < 2) return
    let cancelled = false
    void loadHeadToHead(compare).then((pairs) => {
      if (!cancelled) { setHeadToHead(pairs); setH2hLoading(false) }
    })
    return () => { cancelled = true }
  }, [compare])

  const pairs = compare.length < 2 ? EMPTY_PAIRS : headToHead

  // ── Filters
  const seasonOptions = facets.seasons.filter((s) =>
    (state.competitionSeriesId == null || s.competitionSeriesId === state.competitionSeriesId)
    && (state.year == null || s.year === state.year))
  const tournamentOptions = facets.tournaments.filter((t) => state.year == null || t.year === state.year)

  const chips = activeChips(currentState, {
    competition: facets.competitions.find((c) => c.id === state.competitionSeriesId)?.name,
    season: facets.seasons.find((s) => s.id === state.seasonId)?.label,
    tournament: facets.tournaments.find((t) => t.id === state.tournamentId)?.label,
  })
  const anyFilter = hasAnyFilter(currentState) || chips.length > 0

  const clearChip = (key: string) => {
    switch (key) {
      case 'comp': return navigate({ competitionSeriesId: null })
      case 'year': return navigate({ year: null })
      case 'season': return navigate({ seasonId: null })
      case 'tournament': return navigate({ tournamentId: null })
      case 'division': return navigate({ division: null })
      case 'range': return navigate({ fromYear: null, toYear: null })
      case 'q': return setRowFilters((f) => ({ ...f, search: '' }))
      case 'min': return setRowFilters((f) => ({ ...f, minMatches: 0 }))
      case 'champs': return setRowFilters((f) => ({ ...f, championsOnly: false }))
      case 'type': return setRowFilters((f) => ({ ...f, entrantType: 'all' }))
      case 'active': return setRowFilters((f) => ({ ...f, activeOnly: false }))
    }
  }

  const resetFilters = () => {
    setRowFilters({ search: '', minMatches: 0, championsOnly: false, entrantType: 'all', activeOnly: false })
    navigate({
      competitionSeriesId: null, year: null, seasonId: null, tournamentId: null,
      division: null, fromYear: null, toYear: null, savedView: null,
    })
  }

  const savedViews = availableSavedViews(facets.divisions)

  const csvHref = `/rankings/export?${encodeRankingsState(currentState)}`

  const sortLabel = sort.length
    ? sort.map((s) => `${COLUMN_BY_KEY[s.key]?.label ?? s.key}${s.dir === 'asc' ? ' (ascending)' : ''}`).join(', ')
    : null

  return (
    <div className="w-full">
      {/* ── Scope, record view, championship type ───────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          label="Ranking scope"
          options={SCOPES.map((s) => ({ id: s.id, label: s.label, hint: s.hint }))}
          value={state.scope}
          onChange={(v) => navigate({ scope: v as 'current' | 'all-time' })}
        />
        <Segmented
          label="Record view"
          options={VIEW_TABS.map((v) => ({ id: v.id, label: v.label, hint: v.hint }))}
          value={state.view}
          onChange={(v) => navigate({ view: v as RecordView })}
        />

        {/* SC | TC — a display choice, so it never navigates and never resets the sort. */}
        <div className="inline-flex items-center gap-1 rounded-md border border-border bg-card/40 p-0.5 text-xs" role="group" aria-label="Championship type">
          {(['SC', 'TC'] as const).map((m) => (
            <Tip
              key={m}
              text={m === 'SC'
                ? 'Season Championships — Seasons won. Shown with the gold diamond used for a Season title everywhere on the site.'
                : 'Cup Titles — standalone Cups won. Shown with the trophy.'}
            >
              <span
                role="button"
                tabIndex={-1}
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMode(m) } }}
                className={cn('inline-flex items-center gap-1 rounded px-2 py-1 font-semibold transition-colors',
                  mode === m ? 'bg-[var(--gold)] text-[var(--primary-foreground)]' : 'text-muted-foreground hover:text-foreground')}
              >
                {m === 'SC' ? <Gem className="size-3" aria-hidden /> : <Trophy className="size-3" aria-hidden />}
                {m}
              </span>
            </Tip>
          ))}
        </div>

        {/* `ml-auto` only once there is room for it: at 390px this group pushed Export CSV off the
            right edge, which is page-level horizontal overflow rather than a table that scrolls. */}
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {pending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />}
          <DensityControl
            density={density}
            onChange={(d) => setLayout({
              density: d,
              // Switching to Custom starts from what is on screen, so nothing disappears at the
              // moment the reader takes control of the columns.
              columns: d === 'custom' ? (customColumns ?? shownKeys) : customColumns,
            })}
          />
          <ColumnPicker
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            available={available}
            visible={shownKeys}
            onChange={(next) => setLayout({ density: 'custom', columns: next })}
            onReset={() => setLayout({ density: 'standard', columns: null })}
          />
          <a
            href={csvHref}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:border-[var(--gold)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
          >
            <Download className="size-3.5" aria-hidden />
            <span>Export CSV</span>
          </a>
        </div>
      </div>

      {/* ── Saved views ─────────────────────────────────────────────────────── */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">Saved views</span>
        {savedViews.map((v) => (
          <Tip key={v.id} text={v.hint}>
            <span
              role="button"
              tabIndex={-1}
              aria-pressed={state.savedView === v.id}
              onClick={() => {
                const next = applySavedView(v)
                setRowFilters(next.rowFilters)
                setSort(next.sort)
                navigate(next)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  const next = applySavedView(v)
                  setRowFilters(next.rowFilters); setSort(next.sort); navigate(next)
                }
              }}
              className={cn('rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                state.savedView === v.id
                  ? 'border-[var(--gold)] bg-white/[0.06] text-[var(--gold)]'
                  : 'border-border text-muted-foreground hover:border-[var(--gold)]/40 hover:text-foreground')}
            >
              {v.label}
            </span>
          </Tip>
        ))}
      </div>

      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card/30 px-2.5 py-2">
        <label className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={rowFilters.search}
            onChange={(e) => setRowFilters((f) => ({ ...f, search: e.target.value }))}
            placeholder="Find a player"
            aria-label="Find a player by preferred name, CueVerse ID, or a historical alias"
            className="w-48 rounded border border-input bg-card py-1 pl-7 pr-2 text-xs outline-none focus-visible:border-[var(--gold)] focus-visible:ring-2 focus-visible:ring-[var(--gold)]/25"
          />
        </label>

        <Select label="Competition" value={state.competitionSeriesId}
          onChange={(v) => navigate({ competitionSeriesId: v, seasonId: null })}
          options={facets.competitions.map((c) => ({ value: String(c.id), label: c.name }))} />
        <Select label="Year" value={state.year}
          onChange={(v) => navigate({ year: v, seasonId: null, tournamentId: null })}
          options={facets.years.map((y) => ({ value: String(y), label: String(y) }))} />
        <Select label="Season" value={state.seasonId}
          onChange={(v) => navigate({ seasonId: v, tournamentId: null })}
          options={seasonOptions.map((s) => ({ value: String(s.id), label: s.label }))} />
        <Select label="Cup" value={state.tournamentId}
          onChange={(v) => navigate({ tournamentId: v, seasonId: null })}
          options={tournamentOptions.map((t) => ({ value: String(t.id), label: t.label }))} />

        {/* Division. Offered whatever the data says, so its absence is visible rather than looking
            like a missing feature — with no divisions recorded the only choice is Unassigned. */}
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="sr-only sm:not-sr-only">Division</span>
          <select
            value={state.division ?? ''}
            onChange={(e) => navigate({ division: e.target.value || null })}
            aria-label="Division"
            className="rounded border border-input bg-card px-1.5 py-1 text-xs text-foreground outline-none focus-visible:border-[var(--gold)]"
          >
            <option value="">All divisions</option>
            {facets.divisions.map((d) => <option key={d} value={d}>Division {d}</option>)}
            {facets.hasUnassignedDivision && <option value={UNASSIGNED_DIVISION}>Unassigned</option>}
          </select>
        </label>

        {/* Year range. This is what narrows by time — there is no era metadata to filter on, so no
            era control is offered rather than one built on invented boundaries. */}
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>Years</span>
          <input
            type="number" inputMode="numeric" placeholder={facets.yearRange ? String(facets.yearRange.min) : 'from'}
            value={state.fromYear ?? ''} aria-label="From year"
            onChange={(e) => navigate({ fromYear: e.target.value ? Number(e.target.value) : null })}
            className="w-16 rounded border border-input bg-card px-1.5 py-1 text-xs tabular-nums outline-none focus-visible:border-[var(--gold)]"
          />
          <span aria-hidden>–</span>
          <input
            type="number" inputMode="numeric" placeholder={facets.yearRange ? String(facets.yearRange.max) : 'to'}
            value={state.toYear ?? ''} aria-label="To year"
            onChange={(e) => navigate({ toYear: e.target.value ? Number(e.target.value) : null })}
            className="w-16 rounded border border-input bg-card px-1.5 py-1 text-xs tabular-nums outline-none focus-visible:border-[var(--gold)]"
          />
        </span>

        <Tip text="Players with fewer than this many matches are shown but marked, and are not ranked against the threshold. A 1–0 record is a record, not a position.">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>Min matches</span>
            <input
              type="number" min={0} value={rowFilters.minMatches || ''} aria-label="Minimum matches to qualify"
              onChange={(e) => setRowFilters((f) => ({ ...f, minMatches: Math.max(0, Number(e.target.value) || 0) }))}
              className="w-14 rounded border border-input bg-card px-1.5 py-1 text-xs tabular-nums outline-none focus-visible:border-[var(--gold)]"
            />
          </span>
        </Tip>

        <Toggle label="Champions" title="Only players with at least one championship of the selected type"
          on={rowFilters.championsOnly}
          onClick={() => setRowFilters((f) => ({ ...f, championsOnly: !f.championsOnly }))} />
        <Toggle label="Active" title="Only players whose profile is marked active"
          on={rowFilters.activeOnly}
          onClick={() => setRowFilters((f) => ({ ...f, activeOnly: !f.activeOnly }))} />

        <div className="inline-flex overflow-hidden rounded border border-border text-xs" role="group" aria-label="Entrant type">
          {(['all', 'singles', 'teams'] as const).map((t) => (
            <button
              key={t} type="button" aria-pressed={rowFilters.entrantType === t}
              onClick={() => setRowFilters((f) => ({ ...f, entrantType: t }))}
              className={cn('px-2 py-1 capitalize transition-colors',
                rowFilters.entrantType === t ? 'bg-[var(--gold)] text-[var(--primary-foreground)]' : 'text-muted-foreground hover:text-foreground')}
            >
              {t}
            </button>
          ))}
        </div>

        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {ordered.length === rows.length
            ? `${rows.length} player${rows.length === 1 ? '' : 's'}`
            : `${ordered.length} of ${rows.length}`}
        </span>
      </div>

      {/* Chips: what is narrowing the table, each individually clearable. */}
      {anyFilter && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button
              key={c.key} type="button" onClick={() => clearChip(c.key)}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--gold)]/40 bg-white/[0.05] px-2 py-0.5 text-xs text-foreground hover:border-[var(--gold)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
              aria-label={`Remove filter: ${c.label}`}
            >
              {c.label}<X className="size-3" aria-hidden />
            </button>
          ))}
          <button
            type="button" onClick={resetFilters}
            className="ml-1 inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
          >
            <RotateCcw className="size-3" aria-hidden />Reset filters
          </button>
        </div>
      )}

      {/* Sorting notice: the one thing a reader must not misread about this table. */}
      {sortLabel && (
        <p role="status" className="mb-2 rounded border border-[var(--gold)]/30 bg-white/[0.04] px-2.5 py-1 text-xs">
          Sorted by <span className="font-semibold text-[var(--gold)]">{sortLabel}</span> — official ranks preserved.{' '}
          <button
            type="button" onClick={() => setSort([])}
            className="underline hover:text-[var(--gold)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
          >
            Back to official order
          </button>
        </p>
      )}

      <ComparePanel
        rows={compareRows}
        mode={mode}
        headToHead={pairs}
        loading={h2hLoading && compare.length >= 2 && headToHead.length === 0}
        onRemove={(id) => setCompare((c) => c.filter((x) => x !== id))}
        onClear={() => setCompare([])}
      />

      <RankingsTable
        rows={rest}
        pinnedRows={pinned}
        columns={shown}
        mode={mode}
        sort={sort}
        onSort={(key, additive) => setSort((cur) => cycleSort(cur, key, additive))}
        expanded={expanded}
        onToggleExpand={toggleExpand}
        details={details}
        pins={pins}
        onTogglePin={togglePin}
        compare={compare}
        onToggleCompare={toggleCompare}
        compareFull={compare.length >= MAX_COMPARE}
        minMatches={rowFilters.minMatches}
        topOffset={topOffset}
        emptyMessage={anyFilter
          ? 'No players match these filters.'
          : 'No ranked matches yet.'}
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Methodology />
        <span className="text-xs text-muted-foreground">
          {state.scope === 'current'
            ? 'Current Rankings — rolling 365-day window'
            : 'All-Time Rankings — every completed competition'}
        </span>
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------- small controls

function Segmented({ label, options, value, onChange }: {
  label: string
  options: { id: string; label: string; hint: string }[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div className="inline-flex rounded-md border border-border bg-card/40 p-0.5 text-xs" role="tablist" aria-label={label}>
      {options.map((o) => (
        <Tip key={o.id} text={o.hint}>
          <span
            role="tab"
            tabIndex={-1}
            aria-selected={value === o.id}
            onClick={() => onChange(o.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(o.id) } }}
            className={cn('rounded px-2.5 py-1 font-medium transition-colors',
              value === o.id ? 'bg-[var(--gold)] text-[var(--primary-foreground)]' : 'text-muted-foreground hover:text-foreground')}
          >
            {o.label}
          </span>
        </Tip>
      ))}
    </div>
  )
}

function DensityControl({ density, onChange }: { density: Density; onChange: (d: Density) => void }) {
  return (
    <div className="inline-flex rounded-md border border-border bg-card/40 p-0.5 text-xs" role="group" aria-label="Column density">
      {DENSITIES.map((d) => (
        <Tip key={d.id} text={d.hint}>
          <span
            role="button"
            tabIndex={-1}
            aria-pressed={density === d.id}
            onClick={() => onChange(d.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(d.id) } }}
            className={cn('rounded px-2 py-1 font-medium transition-colors',
              density === d.id ? 'bg-[var(--gold)] text-[var(--primary-foreground)]' : 'text-muted-foreground hover:text-foreground')}
          >
            {d.label}
          </span>
        </Tip>
      ))}
    </div>
  )
}

function Toggle({ label, title, on, onClick }: { label: string; title: string; on: boolean; onClick: () => void }) {
  return (
    <Tip text={title}>
      <span
        role="button"
        tabIndex={-1}
        aria-pressed={on}
        onClick={onClick}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
        className={cn('rounded border px-2 py-1 text-xs transition-colors',
          on ? 'border-[var(--gold)] bg-white/[0.06] text-[var(--gold)]' : 'border-border text-muted-foreground hover:text-foreground')}
      >
        {label}
      </span>
    </Tip>
  )
}

function Select({ label, value, onChange, options }: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  options: { value: string; label: string }[]
}) {
  // An empty dimension is DISABLED rather than hidden, so the absence of data is visible instead of
  // looking like a missing feature.
  return (
    <label className="flex items-center gap-1 text-xs text-muted-foreground">
      <span className="sr-only sm:not-sr-only">{label}</span>
      <select
        value={value ?? ''}
        disabled={options.length === 0}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        aria-label={label}
        className="max-w-[11rem] rounded border border-input bg-card px-1.5 py-1 text-xs text-foreground outline-none focus-visible:border-[var(--gold)] disabled:opacity-40"
      >
        <option value="">{options.length === 0 ? `No ${label.toLowerCase()}s` : `All ${label.toLowerCase()}s`}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

/** Every column, grouped, with a reset back to Standard. Keyboard reachable throughout. */
function ColumnPicker({ open, onOpenChange, available, visible, onChange, onReset }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  available: typeof COLUMNS
  visible: string[]
  onChange: (next: string[]) => void
  onReset: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onOpenChange])

  const toggle = (key: string) => {
    onChange(visible.includes(key) ? visible.filter((k) => k !== key) : [...visible, key])
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:border-[var(--gold)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
      >
        <Columns3 className="size-3.5" aria-hidden />Columns
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 max-h-[70vh] w-72 overflow-y-auto rounded-md border border-border bg-card p-2 shadow-xl">
          {COLUMN_GROUPS.map((g) => {
            const cols = available.filter((c) => c.group === g.id && !c.locked)
            if (cols.length === 0) return null
            return (
              <fieldset key={g.id} className="mb-2">
                <legend className="mb-1 px-1 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.label}
                </legend>
                {cols.map((c) => (
                  <label key={c.key} className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-xs hover:bg-white/[0.05]">
                    <input
                      type="checkbox"
                      checked={visible.includes(c.key)}
                      onChange={() => toggle(c.key)}
                      className="mt-0.5 accent-[var(--gold)]"
                    />
                    <span>
                      <span className="block">{c.label}</span>
                      <span className="block text-[0.65rem] leading-snug text-muted-foreground">{c.tooltip}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )
          })}
          <button
            type="button" onClick={onReset}
            className="w-full rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
          >
            Reset to Standard
          </button>
        </div>
      )}
    </div>
  )
}

export { keysForDensity }
