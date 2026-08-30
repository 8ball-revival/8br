'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { RotateCcw, SlidersHorizontal, X } from 'lucide-react'

import type { ExplorerFacets } from '@/lib/stats/ladder-explorer'
import {
  MIN_YEAR, defaultState, hasAnyFilter, type EventType, type RankingsState,
} from '@/lib/stats/rankings-columns'
import { cn } from '@/lib/utils'

/**
 * Every filter the archive ladder has, behind one control.
 *
 * ── Why one icon instead of a row of tabs ────────────────────────────────────────────────────────
 * Compact mode gives the ladder half the page, and the original filter bar needs all of it. Rather
 * than dropping controls to fit -- which would make the compressed view a weaker product than the
 * expanded one for no reason a reader could see -- everything moves behind a single sliders icon
 * that carries a count of what is currently applied.
 *
 * ── The panel edits a draft ──────────────────────────────────────────────────────────────────────
 * Nothing here navigates until Apply. Filtering a five-hundred-row ladder on every keystroke of a
 * year field means a round trip per digit and a table that flickers through three wrong answers on
 * the way to the right one. Reset is a separate act from Cancel: Reset clears the filters, closing
 * the panel abandons the edit.
 *
 * ── The same state as expanded mode ──────────────────────────────────────────────────────────────
 * This writes `RankingsState`, which is exactly what the full Rankings interface writes. Identical
 * filters therefore produce identical results in both modes by construction, rather than by two
 * implementations agreeing.
 */
export function YahooFilterPanel({
  applied, facets, onApply, resultCount, totalCount,
}: {
  applied: RankingsState
  facets: ExplorerFacets
  onApply: (next: RankingsState) => void
  resultCount: number
  totalCount: number
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<RankingsState>(applied)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const now = useMemo(() => new Date(), [])

  const close = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, close])

  // Clicking outside is a dismissal, not an apply — same as Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const set = (patch: Partial<RankingsState>) => setDraft((d) => ({ ...d, ...patch }))
  const setRow = (patch: Partial<RankingsState['rowFilters']>) =>
    setDraft((d) => ({ ...d, rowFilters: { ...d.rowFilters, ...patch } }))

  const active = countActive(applied, now)
  const years = facets.years.length ? facets.years : []
  const yearMin = years.length ? Math.min(...years) : MIN_YEAR
  const yearMax = years.length ? Math.max(...years) : MIN_YEAR

  /** A single year is a range of one — the ladder engine treats it as the same self-contained period. */
  const singleYear = draft.fromYear === draft.toYear ? draft.fromYear : null

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        // The draft is seeded when the panel opens rather than watched from an effect, so
        // re-opening never shows a half-finished edit somebody walked away from.
        onClick={() => { if (!open) setDraft(applied); setOpen((o) => !o) }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Filter the archive ladder"
        data-yahoo-filter
        className={cn(
          'inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-[0.7rem] font-bold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
          active > 0
            ? 'border-[var(--gold)] text-[var(--gold)]'
            : 'border-border text-muted-foreground hover:text-foreground',
        )}
      >
        <SlidersHorizontal className="size-3.5" aria-hidden />
        Filters
        {active > 0 && (
          <span
            className="grid min-w-4 place-items-center bg-[var(--gold)] px-1 text-[0.6rem] font-bold text-[var(--void)]"
            aria-label={`${active} filter${active === 1 ? '' : 's'} applied`}
          >
            {active}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          className="scrollbar-themed absolute right-0 z-40 mt-2 max-h-[32rem] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto border border-[var(--line-strong)] bg-[var(--graphite)] p-4 shadow-2xl"
        >
          <div className="mb-3 flex items-center justify-between gap-3 border-b border-border pb-2">
            <h3 id={titleId} className="font-display text-sm font-extrabold uppercase tracking-[0.14em] text-[var(--gold)]">
              Filter the archive ladder
            </h3>
            <button type="button" onClick={close} aria-label="Close filters"
              className="grid size-6 place-items-center border border-border text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
              <X className="size-3.5" aria-hidden />
            </button>
          </div>

          <Field label="Yahoo event source" hint="Record type — which kind of Yahoo competition counts.">
            <select
              className={FIELD}
              value={draft.eventType}
              onChange={(e) => set({ eventType: e.target.value as EventType, seasonId: null, tournamentId: null })}
            >
              <option value="all">All Yahoo events</option>
              <option value="seasons">Yahoo 8BRCAM seasons</option>
              <option value="cups">Yahoo tournaments</option>
            </select>
          </Field>

          <Field label="Time range" hint="A period is its own ladder: everybody starts level and only these results are played.">
            <select
              className={FIELD}
              value={rangePreset(draft, yearMin, yearMax)}
              onChange={(e) => {
                const v = e.target.value
                if (v === 'all') set({ fromYear: MIN_YEAR, toYear: defaultState(now).toYear })
                else if (v !== 'custom') {
                  const span = Number(v)
                  set({ fromYear: Math.max(yearMin, yearMax - span + 1), toYear: yearMax })
                }
              }}
            >
              <option value="all">All time</option>
              {rangePreset(draft, yearMin, yearMax) === 'custom' && <option value="custom">Custom</option>}
              <option value="1">Final year ({yearMax})</option>
              <option value="3">Last 3 archive years</option>
              <option value="5">Last 5 archive years</option>
              <option value="10">Last 10 archive years</option>
            </select>
          </Field>

          <Field label="Specific year">
            <select
              className={FIELD}
              value={singleYear != null && years.includes(singleYear) ? String(singleYear) : ''}
              onChange={(e) => {
                if (!e.target.value) { set({ fromYear: MIN_YEAR, toYear: defaultState(now).toYear }); return }
                const y = Number(e.target.value)
                set({ fromYear: y, toYear: y })
              }}
            >
              <option value="">Any year</option>
              {[...years].sort((a, b) => b - a).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </Field>

          <Field label="Inclusive year range" hint="Both ends are included.">
            <div className="flex items-center gap-2">
              <select className={FIELD} aria-label="From year" value={String(draft.fromYear)}
                onChange={(e) => set({ fromYear: Number(e.target.value) })}>
                {[...years].sort((a, b) => a - b).map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <span className="text-xs text-muted-foreground">to</span>
              <select className={FIELD} aria-label="To year" value={String(Math.min(draft.toYear, yearMax))}
                onChange={(e) => set({ toYear: Number(e.target.value) })}>
                {[...years].sort((a, b) => a - b).map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </Field>

          {draft.eventType !== 'cups' && facets.seasons.length > 0 && (
            <Field label="Specific season">
              <select className={FIELD} value={draft.seasonId ?? ''}
                onChange={(e) => set({ seasonId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">All seasons</option>
                {facets.seasons.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </Field>
          )}

          {draft.eventType !== 'seasons' && facets.tournaments.length > 0 && (
            <Field label="Specific tournament">
              <select className={FIELD} value={draft.tournamentId ?? ''}
                onChange={(e) => set({ tournamentId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">All tournaments</option>
                {facets.tournaments.map((t) => <option key={t.id} value={t.id}>{t.label} — {t.year}</option>)}
              </select>
            </Field>
          )}

          <Field label="Achievements">
            <div className="space-y-1.5">
              <Check
                checked={draft.rowFilters.seasonChampionsOnly}
                onChange={(v) => setRow({ seasonChampionsOnly: v })}
                label="Season champions only"
              />
              <Check
                checked={draft.rowFilters.cupChampionsOnly}
                onChange={(v) => setRow({ cupChampionsOnly: v })}
                label="Tournament champions only"
              />
            </div>
          </Field>

          <Field label="Minimum matches" hint="Hides players with too little history to rank meaningfully.">
            <input
              type="number" min={0} max={500} className={FIELD}
              value={draft.rowFilters.minMatches}
              onChange={(e) => setRow({ minMatches: Math.max(0, Number(e.target.value) || 0) })}
            />
          </Field>

          {facets.divisions.length > 0 && (
            <Field label="Division">
              <select className={FIELD} value={draft.division ?? ''}
                onChange={(e) => set({ division: e.target.value || null })}>
                <option value="">All divisions</option>
                {facets.divisions.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
          )}

          <p className="mt-3 border-t border-border pt-2 text-[0.7rem] text-muted-foreground">
            Showing <span className="tabular font-semibold text-foreground">{resultCount}</span> of{' '}
            <span className="tabular">{totalCount}</span> archive players.
          </p>

          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => { const d = defaultState(now); setDraft(d); onApply(d); }}
              className="inline-flex items-center gap-1.5 border border-border px-2.5 py-1.5 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              <RotateCcw className="size-3.5" aria-hidden />
              Reset
            </button>
            <button
              type="button"
              onClick={() => { onApply(draft); close() }}
              className="border border-[var(--gold)] bg-[var(--gold)] px-4 py-1.5 text-[0.7rem] font-bold uppercase tracking-wider text-[var(--void)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const FIELD = 'w-full rounded-none border border-border bg-[var(--void)] px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-[0.62rem] font-bold uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[0.66rem] text-muted-foreground">{hint}</span>}
    </label>
  )
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--gold)]" />
      {label}
    </label>
  )
}

/** Which preset the current bounds correspond to, derived rather than stored — see the Rankings bar. */
function rangePreset(s: RankingsState, min: number, max: number): string {
  if (s.fromYear <= min && s.toYear >= max) return 'all'
  const span = s.toYear - s.fromYear + 1
  return s.toYear === max && [1, 3, 5, 10].includes(span) ? String(span) : 'custom'
}

/**
 * How many filters are in force, for the badge on the icon.
 *
 * Counted as GROUPS rather than fields: a year range is one decision even though it is two numbers,
 * and a reader who set one thing should see "1".
 */
export function countActive(s: RankingsState, now: Date): number {
  const d = defaultState(now)
  let n = 0
  if (s.fromYear !== d.fromYear || s.toYear !== d.toYear) n++
  if (s.eventType !== d.eventType) n++
  if (s.competitionSeriesId != null) n++
  if (s.seasonId != null) n++
  if (s.tournamentId != null) n++
  if (s.division) n++
  if (s.rowFilters.minMatches > 0) n++
  if (s.rowFilters.seasonChampionsOnly || s.rowFilters.cupChampionsOnly) n++
  if (s.rowFilters.activeOnly) n++
  if (s.rowFilters.entrantType !== 'all') n++
  return n
}

export { hasAnyFilter }
