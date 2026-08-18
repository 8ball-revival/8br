'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowDown, ArrowUp, ChevronDown, ChevronRight, Columns3, Flame, Snowflake,
  Trophy, X, Loader2, Search,
} from 'lucide-react'

import type { ExplorerRow, ExplorerFacets, RecordView, PlayerDetail } from '@/lib/stats/ladder-explorer'
import {
  COLUMNS, COLUMN_GROUPS, columnsForView, defaultVisibleKeys,
  cycleSort, sortRows, filterRows, hasActiveRowFilters, activeChips,
  encodeExplorerState, type ChampionshipMode, type ExplorerState, type SortSpec,
} from '@/lib/stats/ladder-columns'
import { loadPlayerDetail } from '@/app/(frontend)/rankings/actions'
import { cn } from '@/lib/utils'

/**
 * The Ladder as a statistics explorer.
 *
 * Two kinds of control, and the difference decides how each one behaves:
 *
 *  - Controls that change WHICH MATCHES COUNT — scope, record view, and the competition filters — must
 *    re-run the aggregate, so they navigate. Narrowing to one Season has to recompute every record from
 *    that Season alone; hiding rows would leave career figures on screen under a Season heading.
 *
 *  - Controls that only change WHAT IS SHOWN — the SC/TC championship control, sorting, column choice,
 *    the name search, minimum matches, champions-only, singles/teams, active-only — are local state.
 *    They never navigate, so nothing reloads and no sort or filter is reset by touching them.
 *
 * Both kinds end up in the URL so a configured table can be shared, but the local ones are written with
 * `history.replaceState`, which updates the address bar without asking Next for a new render.
 */

export interface LadderExplorerProps {
  rows: ExplorerRow[]
  facets: ExplorerFacets
  state: ExplorerState
}

const SCOPES: { id: 'current' | 'all-time'; label: string; hint: string }[] = [
  { id: 'current', label: 'Current', hint: 'Rolling 365-day window' },
  { id: 'all-time', label: 'All Time', hint: 'Every completed competition' },
]

const VIEW_TABS: { id: RecordView; label: string; hint: string }[] = [
  { id: 'overall', label: 'Overall', hint: 'Every recorded match' },
  { id: 'group', label: 'Group Play', hint: 'Season group stages only' },
  { id: 'playoff', label: 'Playoffs', hint: 'Season playoff brackets only' },
  { id: 'tournament', label: 'Tournaments', hint: 'Standalone Tournaments only' },
]

/** Signed streak with the established icons: fire on a long win run, snowflake on a long losing one. */
function StreakCell({ streak }: { streak: number }) {
  if (streak === 0) return <span className="tabular text-muted-foreground">—</span>
  const win = streak > 0
  const mag = Math.abs(streak)
  return (
    <span
      className={cn('inline-flex items-center gap-1 tabular', win ? 'text-[var(--win)]' : 'text-[var(--loss)]')}
      title={`${mag}-match ${win ? 'winning' : 'losing'} streak`}
    >
      {mag >= 6 && (win
        ? <Flame className="size-3.5" aria-hidden />
        : <Snowflake className="size-3.5" aria-hidden />)}
      {win ? 'W' : 'L'}{mag}
    </span>
  )
}

export function LadderExplorer({ rows, facets, state }: LadderExplorerProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  // ── Local, display-only state.
  const [mode, setMode] = useState<ChampionshipMode>(state.mode)
  const [sort, setSort] = useState<SortSpec[]>(state.sort)
  const [rowFilters, setRowFilters] = useState(state.rowFilters)
  const [visible, setVisible] = useState<string[]>(
    state.columns ?? defaultVisibleKeys(state.view))
  const [pickerOpen, setPickerOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, PlayerDetail | 'loading'>>({})

  // Which columns exist in this view, and which of those are switched on.
  const available = useMemo(() => columnsForView(state.view), [state.view])
  const shown = useMemo(
    () => available.filter((c) => c.locked || visible.includes(c.key)),
    [available, visible])

  // A column can go out of scope when the view changes — the group-play figures mean nothing on the
  // Playoffs tab. Nothing is pruned for that: `shown` above already intersects the selection with the
  // view, so an out-of-scope column simply does not render, and switching back restores it. Deriving
  // this beats storing it, and avoids a state write during an effect.

  const filtered = useMemo(() => filterRows(rows, rowFilters, mode), [rows, rowFilters, mode])
  const ordered = useMemo(() => sortRows(filtered, sort, mode), [filtered, sort, mode])

  // ── Keep the address bar in step with local state, without triggering a refetch.
  const currentState: ExplorerState = useMemo(() => ({
    ...state, mode, sort, rowFilters,
    columns: visible.join(',') === defaultVisibleKeys(state.view).join(',') ? null : visible,
  }), [state, mode, sort, rowFilters, visible])

  useEffect(() => {
    const qs = encodeExplorerState(currentState)
    window.history.replaceState(null, '', qs ? `/rankings?${qs}` : '/rankings')
  }, [currentState])

  /** Controls that change the aggregate: navigate so the server recomputes. */
  const navigate = useCallback((patch: Partial<ExplorerState>) => {
    const qs = encodeExplorerState({ ...currentState, ...patch })
    startTransition(() => router.push(qs ? `/rankings?${qs}` : '/rankings', { scroll: false }))
  }, [currentState, router])

  const toggleExpand = useCallback((row: ExplorerRow) => {
    const next = expanded === row.playerId ? null : row.playerId
    setExpanded(next)
    if (next && !details[next]) {
      setDetails((d) => ({ ...d, [next]: 'loading' }))
      void loadPlayerDetail(next, state.scope).then((detail) => {
        setDetails((d) => ({ ...d, [next]: detail ?? { playerId: next, competitions: [], recentForm: [], groupRecord: { wins: 0, losses: 0, draws: 0 }, playoffRecord: { wins: 0, losses: 0, draws: 0 } } }))
      })
    }
  }, [expanded, details, state.scope])

  const clearChip = (key: string) => {
    switch (key) {
      case 'comp': return navigate({ competitionSeriesId: null })
      case 'year': return navigate({ year: null })
      case 'season': return navigate({ seasonId: null })
      case 'tournament': return navigate({ tournamentId: null })
      case 'q': return setRowFilters((f) => ({ ...f, search: '' }))
      case 'min': return setRowFilters((f) => ({ ...f, minMatches: 0 }))
      case 'champs': return setRowFilters((f) => ({ ...f, championsOnly: false }))
      case 'type': return setRowFilters((f) => ({ ...f, entrantType: 'all' }))
      case 'active': return setRowFilters((f) => ({ ...f, activeOnly: false }))
    }
  }

  // Season options narrow to the chosen Competition and Year, so the list stays usable.
  const seasonOptions = facets.seasons.filter((s) =>
    (state.competitionSeriesId == null || s.competitionSeriesId === state.competitionSeriesId)
    && (state.year == null || s.year === state.year))
  const tournamentOptions = facets.tournaments.filter((t) =>
    state.year == null || t.year === state.year)

  const chips = activeChips(currentState, {
    competition: facets.competitions.find((c) => c.id === state.competitionSeriesId)?.name,
    season: facets.seasons.find((s) => s.id === state.seasonId)?.label,
    tournament: facets.tournaments.find((t) => t.id === state.tournamentId)?.label,
  })

  const anyFilter = chips.length > 0
  const resetAll = () => {
    setRowFilters({ search: '', minMatches: 0, championsOnly: false, entrantType: 'all', activeOnly: false })
    navigate({ competitionSeriesId: null, year: null, seasonId: null, tournamentId: null })
  }

  const sortFor = (key: string) => sort.find((s) => s.key === key)

  return (
    <div className="w-full">
      {/* ── Scope and record view ───────────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-border bg-card/40 p-0.5 text-xs" role="tablist" aria-label="Ladder scope">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={state.scope === s.id}
              title={s.hint}
              onClick={() => navigate({ scope: s.id })}
              className={cn('rounded px-2.5 py-1 font-medium transition-colors',
                state.scope === s.id ? 'bg-brand text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="inline-flex rounded-md border border-border bg-card/40 p-0.5 text-xs" role="tablist" aria-label="Record view">
          {VIEW_TABS.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={state.view === v.id}
              title={v.hint}
              onClick={() => navigate({ view: v.id })}
              className={cn('rounded px-2.5 py-1 font-medium transition-colors',
                state.view === v.id ? 'bg-brand text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {v.label}
            </button>
          ))}
        </div>

        {/* SC | TC — purely a display choice, so it never navigates and never resets the sort. */}
        <div className="inline-flex items-center gap-1 rounded-md border border-border bg-card/40 p-0.5 text-xs" role="group" aria-label="Championship type">
          <Trophy className="ml-1 size-3.5" style={{ color: 'var(--gold)' }} aria-hidden />
          {(['SC', 'TC'] as const).map((m) => (
            <button
              key={m}
              aria-pressed={mode === m}
              title={m === 'SC' ? 'Season Championships' : 'Tournament Championships'}
              onClick={() => setMode(m)}
              className={cn('rounded px-2 py-1 font-semibold transition-colors',
                mode === m ? 'bg-brand text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {pending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />}
          <ColumnPicker
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            available={available}
            visible={visible}
            onChange={setVisible}
            onReset={() => setVisible(defaultVisibleKeys(state.view))}
          />
        </div>
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
            aria-label="Find a player by CueVerse ID or preferred name"
            className="w-44 rounded border border-input bg-card py-1 pl-7 pr-2 text-xs outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
          />
        </label>

        <Select
          label="Competition"
          value={state.competitionSeriesId}
          onChange={(v) => navigate({ competitionSeriesId: v, seasonId: null })}
          options={facets.competitions.map((c) => ({ value: c.id, label: c.name }))}
        />
        <Select
          label="Year"
          value={state.year}
          onChange={(v) => navigate({ year: v, seasonId: null, tournamentId: null })}
          options={facets.years.map((y) => ({ value: y, label: String(y) }))}
        />
        <Select
          label="Season"
          value={state.seasonId}
          onChange={(v) => navigate({ seasonId: v, tournamentId: null })}
          options={seasonOptions.map((s) => ({ value: s.id, label: s.label }))}
        />
        <Select
          label="Tournament"
          value={state.tournamentId}
          onChange={(v) => navigate({ tournamentId: v, seasonId: null })}
          options={tournamentOptions.map((t) => ({ value: t.id, label: t.label }))}
        />

        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Min matches
          <input
            type="number"
            min={0}
            value={rowFilters.minMatches || ''}
            onChange={(e) => setRowFilters((f) => ({ ...f, minMatches: Math.max(0, Number(e.target.value) || 0) }))}
            className="w-14 rounded border border-input bg-card px-1.5 py-1 text-xs tabular outline-none focus-visible:border-brand"
          />
        </label>

        <Toggle
          label="Champions"
          title="Only players with at least one championship of the selected type"
          on={rowFilters.championsOnly}
          onClick={() => setRowFilters((f) => ({ ...f, championsOnly: !f.championsOnly }))}
        />
        <Toggle
          label="Active"
          title="Only players whose profile is active"
          on={rowFilters.activeOnly}
          onClick={() => setRowFilters((f) => ({ ...f, activeOnly: !f.activeOnly }))}
        />

        <div className="inline-flex rounded border border-border text-xs" role="group" aria-label="Entrant type">
          {(['all', 'singles', 'teams'] as const).map((t) => (
            <button
              key={t}
              aria-pressed={rowFilters.entrantType === t}
              onClick={() => setRowFilters((f) => ({ ...f, entrantType: t }))}
              className={cn('px-2 py-1 capitalize transition-colors',
                rowFilters.entrantType === t ? 'bg-brand text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {t}
            </button>
          ))}
        </div>

        <span className="ml-auto text-xs tabular text-muted-foreground">
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
              key={c.key}
              onClick={() => clearChip(c.key)}
              className="inline-flex items-center gap-1 rounded-full border border-brand/40 bg-brand/10 px-2 py-0.5 text-xs text-foreground hover:border-brand"
              aria-label={`Remove filter: ${c.label}`}
            >
              {c.label}<X className="size-3" aria-hidden />
            </button>
          ))}
          <button onClick={resetAll} className="ml-1 text-xs text-muted-foreground underline hover:text-foreground">
            Reset all
          </button>
        </div>
      )}

      {/* ── The table ───────────────────────────────────────────────────────── */}
      <div className="br-scroll overflow-x-auto rounded-md border border-border">
        {/*
          `border-separate` with zero spacing rather than `border-collapse`. Sticky table cells and
          collapsed borders are a long-standing bad pair in Chrome — the cell keeps its sticky offset but
          loses its borders, and older versions dropped the stickiness altogether. Row separators here
          come from per-cell `border-b` classes, so nothing is lost by separating them.
        */}
        <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="sticky top-0 z-20 bg-card">
              <th className="w-8 border-b border-border" aria-label="Expand" />
              {shown.map((c, i) => {
                const s = sortFor(c.key)
                const sticky = c.key === 'rank' ? 'left-0 z-30' : c.key === 'player' ? 'left-12 z-30' : ''
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={s ? (s.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={cn(
                      'whitespace-nowrap border-b border-border bg-card px-2.5 py-2 font-medium',
                      c.align === 'right' ? 'text-right' : 'text-left',
                      sticky && `sticky ${sticky} bg-card`,
                      i === 0 && 'pl-3',
                    )}
                  >
                    <button
                      onClick={(e) => setSort((cur) => cycleSort(cur, c.key, e.shiftKey))}
                      title={`${c.tooltip}\n\nClick to sort. Shift-click to add a secondary sort.`}
                      className={cn('inline-flex items-center gap-1 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 rounded',
                        s && 'text-brand')}
                    >
                      {c.short ?? c.label}
                      {s?.dir === 'desc' && <ArrowDown className="size-3" aria-hidden />}
                      {s?.dir === 'asc' && <ArrowUp className="size-3" aria-hidden />}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {ordered.length === 0 && (
              <tr>
                <td colSpan={shown.length + 1} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  {hasActiveRowFilters(rowFilters) || anyFilter
                    ? 'No players match these filters.'
                    : 'No ranked matches yet.'}
                </td>
              </tr>
            )}

            {ordered.map((r) => {
              const isOpen = expanded === r.playerId
              const detail = details[r.playerId]
              return (
                // The key belongs on the Fragment: each row renders two <tr> elements, so keying the
                // children instead would leave the list itself unkeyed.
                <Fragment key={r.playerId}>
                  <tr
                    className={cn('transition-colors hover:bg-brand/[0.04]',
                      isOpen && 'bg-brand/[0.06]')}
                  >
                    <td className="border-b border-border/60 px-1 text-center">
                      <button
                        onClick={() => toggleExpand(r)}
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? 'Hide' : 'Show'} details for ${r.label}`}
                        className="rounded p-1 text-muted-foreground hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
                      >
                        {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                      </button>
                    </td>
                    {shown.map((c) => {
                      const sticky = c.key === 'rank' ? 'left-0' : c.key === 'player' ? 'left-12' : ''
                      const bg = isOpen ? 'bg-[color-mix(in_srgb,var(--card)_92%,var(--brand))]' : 'bg-card'
                      return (
                        <td
                          key={c.key}
                          className={cn('whitespace-nowrap border-b border-border/60 px-2.5 py-1.5',
                            c.align === 'right' ? 'text-right tabular' : 'text-left',
                            sticky && `sticky ${sticky} z-10 ${bg}`)}
                        >
                          {c.key === 'player' ? (
                            <Link href={`/players/${r.slug}`} className="hover:text-brand hover:underline">
                              {r.label}
                            </Link>
                          ) : c.key === 'currentStreak' ? (
                            <StreakCell streak={r.currentStreak} />
                          ) : c.key === 'titles' ? (
                            <TitleCell n={mode === 'SC' ? r.seasonTitles : r.tournamentTitles} />
                          ) : (
                            (c.format ?? ((row) => String(c.value(row, mode) ?? '—')))(r, mode)
                          )}
                        </td>
                      )
                    })}
                  </tr>

                  {isOpen && (
                    <tr className="border-b border-border">
                      <td colSpan={shown.length + 1} className="bg-card/40 px-3 py-3">
                        <DetailPanel row={r} detail={detail} mode={mode} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** A championship count with the gold trophy, so a title is visible without reading the number. */
function TitleCell({ n }: { n: number }) {
  if (n === 0) return <span className="text-muted-foreground">—</span>
  return (
    <span className="inline-flex items-center gap-1">
      <Trophy className="size-3.5" style={{ color: 'var(--gold)' }} aria-hidden />
      <span className="tabular font-semibold">{n}</span>
    </span>
  )
}

function Toggle({ label, title, on, onClick }: { label: string; title: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      title={title}
      className={cn('rounded border px-2 py-1 text-xs transition-colors',
        on ? 'border-brand bg-brand/15 text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}
    >
      {label}
    </button>
  )
}

function Select({ label, value, onChange, options }: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  options: { value: number; label: string }[]
}) {
  // An empty dimension is disabled rather than hidden, so the absence of data is visible instead of
  // looking like a missing feature.
  return (
    <label className="flex items-center gap-1 text-xs text-muted-foreground">
      <span className="sr-only sm:not-sr-only">{label}</span>
      <select
        value={value ?? ''}
        disabled={options.length === 0}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        aria-label={label}
        className="max-w-[11rem] rounded border border-input bg-card px-1.5 py-1 text-xs text-foreground outline-none focus-visible:border-brand disabled:opacity-40"
      >
        <option value="">{options.length === 0 ? `No ${label.toLowerCase()}s` : `All ${label.toLowerCase()}s`}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

/** The Columns control: every column, grouped, with a reset back to the view's defaults. */
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
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
      >
        <Columns3 className="size-3.5" aria-hidden />Columns
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-1 max-h-[70vh] w-64 overflow-y-auto rounded-md border border-border bg-card p-2 shadow-xl">
          {COLUMN_GROUPS.map((g) => {
            const cols = available.filter((c) => c.group === g.id && !c.locked)
            if (cols.length === 0) return null
            return (
              <div key={g.id} className="mb-2">
                <div className="mb-1 px-1 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.label}
                </div>
                {cols.map((c) => (
                  <label key={c.key} className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-xs hover:bg-brand/[0.06]" title={c.tooltip}>
                    <input
                      type="checkbox"
                      checked={visible.includes(c.key)}
                      onChange={() => toggle(c.key)}
                      className="mt-0.5 accent-[var(--brand)]"
                    />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
            )
          })}
          <button onClick={onReset} className="w-full rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
            Reset columns
          </button>
        </div>
      )}
    </div>
  )
}

/** The expanded row: where a record came from, competition by competition. */
function DetailPanel({ row, detail, mode }: {
  row: ExplorerRow
  detail: PlayerDetail | 'loading' | undefined
  mode: ChampionshipMode
}) {
  if (detail === 'loading' || detail === undefined) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />Loading breakdown…
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
      <div>
        <div className="mb-1.5 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
          By competition
        </div>
        {detail.competitions.length === 0 ? (
          <p className="text-xs text-muted-foreground">No competition history in this scope.</p>
        ) : (
          <ul className="space-y-1">
            {detail.competitions.map((c) => (
              <li key={`${c.kind}-${c.label}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                {c.won && <Trophy className="size-3.5 shrink-0" style={{ color: 'var(--gold)' }} aria-label="Won" />}
                <span className="font-medium">{c.label}</span>
                <span className="tabular text-muted-foreground">
                  {c.wins}–{c.losses}{c.draws > 0 ? `–${c.draws}` : ''} · games {c.gamesWon}–{c.gamesLost}
                </span>
                {c.reachedFinal && !c.won && (
                  <span className="rounded-full border border-border px-1.5 text-[0.65rem] text-muted-foreground">
                    reached final
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="min-w-[13rem] space-y-2 text-xs">
        <div>
          <div className="mb-1 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
            Recent form
          </div>
          {detail.recentForm.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <div className="flex gap-1">
              {detail.recentForm.map((f, i) => (
                <span
                  key={i}
                  className={cn('inline-flex size-5 items-center justify-center rounded text-[0.65rem] font-bold',
                    f === 'W' ? 'bg-[var(--win)]/20 text-[var(--win)]'
                      : f === 'L' ? 'bg-[var(--loss)]/20 text-[var(--loss)]'
                        : 'bg-muted text-muted-foreground')}
                  title={f === 'W' ? 'Win' : f === 'L' ? 'Loss' : 'Draw'}
                >
                  {f}
                </span>
              ))}
            </div>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5">
          <dt className="text-muted-foreground">Group play</dt>
          <dd className="tabular">{detail.groupRecord.wins}–{detail.groupRecord.losses}
            {detail.groupRecord.draws > 0 ? `–${detail.groupRecord.draws}` : ''}</dd>
          <dt className="text-muted-foreground">Playoffs</dt>
          <dd className="tabular">{detail.playoffRecord.wins}–{detail.playoffRecord.losses}</dd>
          <dt className="text-muted-foreground">Peak rating</dt>
          <dd className="tabular">{row.peakRating}</dd>
          <dt className="text-muted-foreground">{mode === 'SC' ? 'Season titles' : 'Tournament titles'}</dt>
          <dd className="tabular">{mode === 'SC' ? row.seasonTitles : row.tournamentTitles}</dd>
          <dt className="text-muted-foreground">Finals</dt>
          <dd className="tabular">{row.finalsAppearances}</dd>
        </dl>

        <Link href={`/players/${row.slug}`} className="inline-block text-brand hover:underline">
          Full profile →
        </Link>
      </div>
    </div>
  )
}
