'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'

import {
  MIN_YEAR, maxYear, defaultState, activeChips, OPTIONAL_COLUMN_KEYS, PERMANENT_COLUMN_KEYS, columnAppliesTo,
  COLUMN_BY_KEY, clampYear,
  type RankingsState, type EventType,
} from '@/lib/stats/rankings-columns'
import { UNASSIGNED_DIVISION } from '@/lib/stats/rankings-facts'
import { cn } from '@/lib/utils'

/**
 * The Rankings filter drawer.
 *
 * ── Draft, not live ──────────────────────────────────────────────────────────────────────────────
 * Opening the drawer takes a COPY of the applied state. Nothing typed inside it touches the table
 * until Apply Filters. That is the whole point of a drawer rather than an inline filter row: it
 * lets somebody set a year range, a competition and a division as one decision instead of watching
 * the table thrash through three intermediate answers, two of which they never wanted to see.
 *
 * Every way out that is not Apply — the X, Escape, the backdrop, navigating — discards the draft.
 * A half-set filter that leaks into the table on close is worse than one that is thrown away,
 * because the reader has no idea which of their edits survived.
 *
 * ── Why the year range is two controls ───────────────────────────────────────────────────────────
 * A slider is quick and imprecise; typed fields are precise and slow. Both edit the same two
 * numbers and are clamped by the same function, so they cannot disagree — and the upper bound is
 * read from the clock rather than written down, because a hard-coded maximum is a bug with a
 * delayed fuse.
 */

export interface DrawerFacets {
  competitions: { id: number; name: string }[]
  seasons: { id: number; label: string; year: number | null; seriesId: number | null }[]
  cups: { id: number; label: string; year: number | null }[]
  divisions: string[]
}

export interface FilterDrawerProps {
  open: boolean
  onClose: () => void
  /** The state currently driving the table. The draft starts from this every time it opens. */
  applied: RankingsState
  onApply: (next: RankingsState) => void
  facets: DrawerFacets
}

const FIELD =
  'w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60'

/**
 * The gate.
 *
 * Closed, the drawer does not exist. That is what makes the draft correct without a resync effect:
 * the panel below initialises its draft from the applied state in `useState`, and a fresh mount on
 * every open means reopening can only ever start from what is actually applied.
 */
export function FilterDrawer(props: FilterDrawerProps) {
  if (!props.open) return null
  return <DrawerPanel {...props} />
}

function DrawerPanel({ onClose, applied, onApply, facets }: FilterDrawerProps) {
  const now = useMemo(() => new Date(), [])
  const YEAR_MAX = maxYear(now)

  const [draft, setDraft] = useState<RankingsState>(applied)
  const panel = useRef<HTMLDivElement | null>(null)
  const titleId = useId()

  // The page behind a modal must not scroll: scrolling it moves content the reader cannot see and
  // loses their place in the table they are about to filter.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [])

  /**
   * Escape closes, and Tab cannot leave.
   *
   * A focus trap is not decoration here: without it, tabbing walks into the page behind the
   * backdrop, where the reader can see focus rings on controls they cannot click.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
      if (e.key !== 'Tab') return
      const root = panel.current
      if (!root) return
      const focusable = [...root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((el) => el.offsetParent !== null)
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Focus lands inside the drawer when it opens, so a keyboard reader is where the controls are.
  useEffect(() => {
    const t = setTimeout(() => {
      panel.current?.querySelector<HTMLElement>('button, input, select')?.focus()
    }, 30)
    return () => clearTimeout(t)
  }, [])

  const set = useCallback((patch: Partial<RankingsState>) => {
    setDraft((d) => ({ ...d, ...patch }))
  }, [])
  const setFilters = useCallback((patch: Partial<RankingsState['rowFilters']>) => {
    setDraft((d) => ({ ...d, rowFilters: { ...d.rowFilters, ...patch } }))
  }, [])

  // Typed fields and slider handles edit the same two numbers through the same clamp, so they can
  // never drift apart or cross over.
  const setFrom = (raw: unknown) => {
    const v = clampYear(raw, now) ?? MIN_YEAR
    setDraft((d) => ({ ...d, fromYear: Math.min(v, d.toYear) }))
  }
  const setTo = (raw: unknown) => {
    const v = clampYear(raw, now) ?? YEAR_MAX
    setDraft((d) => ({ ...d, toYear: Math.max(v, d.fromYear) }))
  }

  // Only the Seasons and Tournaments the other choices actually permit — an empty control that filters
  // nothing is worse than no control.
  const seasons = useMemo(() => facets.seasons.filter((s) =>
    (draft.competitionSeriesId == null || s.seriesId === draft.competitionSeriesId)
    && (s.year == null || (s.year >= draft.fromYear && s.year <= draft.toYear))), [facets.seasons, draft])
  const cups = useMemo(() => facets.cups.filter((c) =>
    c.year == null || (c.year >= draft.fromYear && c.year <= draft.toYear)), [facets.cups, draft])

  const chips = activeChips(draft, {
    competition: facets.competitions.find((c) => c.id === draft.competitionSeriesId)?.name,
    season: seasons.find((s) => s.id === draft.seasonId)?.label,
    cup: cups.find((c) => c.id === draft.tournamentId)?.label,
  }, now)

  return (
    <div className="fixed inset-0 z-[120]">
      <button
        type="button"
        aria-label="Close filters"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />

      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute inset-y-0 right-0 flex w-full flex-col bg-card shadow-2xl sm:w-[440px] sm:border-l sm:border-border"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-4 py-3">
          <h2 id={titleId} className="font-display text-base font-bold">Filters</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="rounded p-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-themed px-4 py-3">
          {chips.length > 0 && (
            <Section title="Applied Filters" defaultOpen>
              <div className="flex flex-wrap gap-1.5">
                {chips.map((c) => (
                  <span key={c.key} className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs">
                    {c.label}
                  </span>
                ))}
              </div>
            </Section>
          )}

          <Section title="Year Range" defaultOpen>
            <div className="flex items-end gap-2">
              <label className="flex-1">
                <span className="mb-1 block text-xs text-muted-foreground">From</span>
                <input type="number" inputMode="numeric" min={MIN_YEAR} max={YEAR_MAX}
                  value={draft.fromYear} onChange={(e) => setFrom(e.target.value)} className={FIELD} />
              </label>
              <span aria-hidden className="pb-2 text-muted-foreground">–</span>
              <label className="flex-1">
                <span className="mb-1 block text-xs text-muted-foreground">To</span>
                <input type="number" inputMode="numeric" min={MIN_YEAR} max={YEAR_MAX}
                  value={draft.toYear} onChange={(e) => setTo(e.target.value)} className={FIELD} />
              </label>
            </div>
            {/* Two overlaid range inputs: one per handle, each keyboard-operable on its own. */}
            <div className="mt-3 space-y-2">
              <label className="block">
                <span className="sr-only">Earliest year</span>
                <input type="range" min={MIN_YEAR} max={YEAR_MAX} value={draft.fromYear}
                  onChange={(e) => setFrom(e.target.value)}
                  aria-valuetext={`From ${draft.fromYear}`}
                  className="w-full accent-[var(--gold)]" />
              </label>
              <label className="block">
                <span className="sr-only">Latest year</span>
                <input type="range" min={MIN_YEAR} max={YEAR_MAX} value={draft.toYear}
                  onChange={(e) => setTo(e.target.value)}
                  aria-valuetext={`To ${draft.toYear}`}
                  className="w-full accent-[var(--gold)]" />
              </label>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {MIN_YEAR}–{YEAR_MAX} is the whole archive.
            </p>
          </Section>

          <Section title="Competition">
            <select value={draft.competitionSeriesId ?? ''} className={FIELD}
              onChange={(e) => set({
                competitionSeriesId: e.target.value ? Number(e.target.value) : null,
                // A Season belongs to a Competition, so changing one abandons a selection the other
                // no longer permits.
                seasonId: null,
              })}>
              <option value="">All competitions</option>
              {facets.competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Section>

          <Section title="Event Type">
            <div className="space-y-1.5">
              {([['all', 'Seasons and Tournaments'], ['seasons', 'Seasons only'], ['cups', 'Tournaments only']] as const)
                .map(([id, label]) => (
                  <label key={id} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="eventType" checked={draft.eventType === id}
                      onChange={() => set({ eventType: id as EventType, seasonId: null, tournamentId: null })}
                      className="accent-[var(--gold)]" />
                    {label}
                  </label>
                ))}
            </div>
          </Section>

          {draft.eventType !== 'cups' && seasons.length > 0 && (
            <Section title="Specific Season">
              <select value={draft.seasonId ?? ''} className={FIELD}
                onChange={(e) => set({ seasonId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">All Seasons</option>
                {seasons.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </Section>
          )}

          {draft.eventType !== 'seasons' && cups.length > 0 && (
            <Section title="Specific Tournament">
              <select value={draft.tournamentId ?? ''} className={FIELD}
                onChange={(e) => set({ tournamentId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">All Tournaments</option>
                {cups.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </Section>
          )}

          {facets.divisions.length > 0 && (
            <Section title="Division">
              <select value={draft.division ?? ''} className={FIELD}
                onChange={(e) => set({ division: e.target.value || null })}>
                <option value="">All divisions</option>
                {facets.divisions.map((d) => (
                  <option key={d} value={d}>{d === UNASSIGNED_DIVISION ? 'Unassigned' : d}</option>
                ))}
              </select>
            </Section>
          )}

          <Section title="Player Status">
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="status" checked={!draft.rowFilters.activeOnly}
                  onChange={() => setFilters({ activeOnly: false })} className="accent-[var(--gold)]" />
                All players
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="status" checked={draft.rowFilters.activeOnly}
                  onChange={() => setFilters({ activeOnly: true })} className="accent-[var(--gold)]" />
                Active players only
              </label>
            </div>
          </Section>

          <Section title="Entry Type">
            <div className="space-y-1.5">
              {([['all', 'All'], ['singles', 'Singles'], ['teams', 'Teams']] as const).map(([id, label]) => (
                <label key={id} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="entryType" checked={draft.rowFilters.entrantType === id}
                    onChange={() => setFilters({ entrantType: id })} className="accent-[var(--gold)]" />
                  {label}
                </label>
              ))}
            </div>
          </Section>

          <Section title="Achievements">
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.rowFilters.seasonChampionsOnly}
                  onChange={(e) => setFilters({ seasonChampionsOnly: e.target.checked })}
                  className="accent-[var(--gold)]" />
                Season Champions
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.rowFilters.cupChampionsOnly}
                  onChange={(e) => setFilters({ cupChampionsOnly: e.target.checked })}
                  className="accent-[var(--gold)]" />
                Tournament Titleholders
              </label>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Both ticked shows players who have won <strong>both</strong> a Season and a Tournament.
            </p>
          </Section>

          <Section title="Minimum Matches">
            <input type="number" inputMode="numeric" min={0} value={draft.rowFilters.minMatches}
              onChange={(e) => {
                const n = Number(e.target.value)
                setFilters({ minMatches: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0 })
              }}
              className={FIELD} />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Counts matches inside the selected years and competitions.
            </p>
          </Section>

          <Section title="Visible Columns">
            <div className="space-y-1.5">
              {PERMANENT_COLUMN_KEYS.map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" checked disabled className="accent-[var(--gold)]" />
                  {COLUMN_BY_KEY[k]?.label ?? k} <span className="text-xs">(always shown)</span>
                </label>
              ))}
              {/* A column the current scope does not offer is not listed: a checkbox that
                  changes nothing is worse than an absent one. */}
              {OPTIONAL_COLUMN_KEYS.filter((k) => columnAppliesTo(k, draft.platform)).map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.visibleColumns.includes(k)}
                    onChange={(e) => set({
                      visibleColumns: e.target.checked
                        ? [...draft.visibleColumns, k]
                        : draft.visibleColumns.filter((x) => x !== k),
                    })}
                    className="accent-[var(--gold)]"
                  />
                  {COLUMN_BY_KEY[k]?.label ?? k}
                </label>
              ))}
            </div>
          </Section>
        </div>

        <footer className="sticky bottom-0 z-10 flex items-center gap-2 border-t border-border bg-card px-4 py-3">
          <button
            type="button"
            onClick={() => setDraft({ ...defaultState(now), rowFilters: { ...defaultState(now).rowFilters, search: draft.rowFilters.search } })}
            className="rounded-md border border-border px-3 py-2 text-sm transition-colors hover:border-[var(--gold)]/50"
          >
            Defaults
          </button>
          <button
            type="button"
            onClick={() => { onApply(draft); onClose() }}
            className="flex-1 rounded-md bg-[var(--gold)] px-4 py-2 font-display text-sm font-bold text-black transition-opacity hover:opacity-90"
          >
            Apply Filters
          </button>
        </footer>
      </div>
    </div>
  )
}

/** A collapsible section. Open by default only where the reader is most likely to start. */
function Section({
  title, children, defaultOpen = false,
}: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <section className="border-b border-border py-2.5 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full items-center justify-between gap-2 rounded text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
      >
        {title}
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && <div id={id} className="pt-2.5">{children}</div>}
    </section>
  )
}
