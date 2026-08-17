'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, ArrowRight, Maximize2, Minus, Plus, Search } from 'lucide-react'

import { cn } from '@/lib/utils'
import { identityLines } from '@/lib/identity/display'
import type { CompetitionOption, SeasonOption, SeasonPlayerHit } from '@/lib/seasons/browse'

/**
 * The Seasons control bar: Competition | Year | Season | Player Search | Groups/Playoffs | Zoom |
 * Previous/Next, in that order, sticky under the site header.
 *
 * Every choice that changes what you are looking at lives in the URL, so a Season view can be
 * refreshed, bookmarked and shared and come back identical. Zoom is the one exception — it is a
 * comfort setting for the current screen, not part of what is being shown, so it stays local and is
 * remembered per browser.
 *
 * Options come from the registry via props. There is no static list anywhere.
 */
export function SeasonControls({
  competitions,
  seasons,
  years,
  current,
  competitionSlug,
  view,
  neighbours,
  searchPlayers,
}: {
  competitions: CompetitionOption[]
  seasons: SeasonOption[]
  years: number[]
  current: { number: number; year: number }
  competitionSlug: string | null
  view: 'groups' | 'playoffs'
  neighbours: { prev: number | null; next: number | null }
  searchPlayers: (q: string) => Promise<SeasonPlayerHit[]>
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [, startNav] = useTransition()

  /** Rebuild the URL, keeping whatever is not being changed. */
  const urlFor = (overrides: { season?: number; competition?: string | null; view?: 'groups' | 'playoffs' }) => {
    const next = new URLSearchParams(params.toString())
    const comp = overrides.competition !== undefined ? overrides.competition : competitionSlug
    if (comp) next.set('competition', comp)
    else next.delete('competition')
    next.set('view', overrides.view ?? view)
    const seasonNumber = overrides.season ?? current.number
    const qs = next.toString()
    return `/seasons/${seasonNumber}${qs ? `?${qs}` : ''}`
  }

  const go = (href: string) => startNav(() => router.push(href))

  // Years are derived from the Seasons actually on offer, so the Year picker can never point at a
  // year with nothing in it.
  const seasonsForYear = useMemo(
    () => seasons.filter((s) => s.year === current.year),
    [seasons, current.year],
  )

  /** Newest Season in a year — the same rule the landing page uses, applied locally. */
  const newestIn = (year: number) => {
    const inYear = seasons.filter((s) => s.year === year)
    return inYear.length ? Math.max(...inYear.map((s) => s.number)) : current.number
  }

  // Clamped to the global header: same background, one hairline between them, and a sticky offset
  // read from --site-header-h so the two rows travel as one unit from the first paint onwards.
  useTrackSiteHeaderHeight()

  return (
    <div
      style={{ top: 'var(--site-header-h)' }}
      className="sticky z-40 border-b border-nav-border bg-nav-bg/85 backdrop-blur supports-[backdrop-filter]:bg-nav-bg/70"
    >
      <div className="w-full max-w-none px-3 sm:px-5">
        {/* Wraps on narrow screens rather than overflowing, so the bar never detaches from the
            header above it. */}
        <div className="flex flex-wrap items-end gap-2.5 py-2.5 sm:gap-3">
          <Field label="Competition" htmlFor="f-comp">
            <select
              id="f-comp"
              value={competitionSlug ?? ''}
              onChange={(e) => go(urlFor({ competition: e.target.value || null }))}
              className={SELECT}
            >
              {/* Filtering is by slug; the label is the Competition's stored short name. */}
              <option value="">All Competitions</option>
              {competitions.map((c) => (
                <option key={c.slug} value={c.slug}>{c.shortName}</option>
              ))}
            </select>
          </Field>

          <Field label="Year" htmlFor="f-year">
            <select
              id="f-year"
              value={current.year}
              onChange={(e) => go(urlFor({ season: newestIn(Number(e.target.value)) }))}
              className={SELECT}
            >
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </Field>

          <Field label="Season" htmlFor="f-season">
            <select
              id="f-season"
              value={current.number}
              onChange={(e) => go(urlFor({ season: Number(e.target.value) }))}
              className={SELECT}
            >
              {seasonsForYear.map((s) => (
                <option key={s.number} value={s.number}>{s.title}</option>
              ))}
            </select>
          </Field>

          <PlayerSearch searchPlayers={searchPlayers} />

          <Field label="View">
            <div className="inline-flex overflow-hidden rounded-md border border-input">
              {(['groups', 'playoffs'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => go(urlFor({ view: v }))}
                  className={cn(
                    'px-4 py-1.5 text-sm font-semibold capitalize transition-colors',
                    view === v ? 'bg-[var(--gold)] text-black' : 'bg-card text-muted-foreground hover:text-foreground',
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          </Field>

          <Zoom onManual={() => window.dispatchEvent(new Event('8br:bracket-manual-zoom'))} />
          {view === 'playoffs' && <FitBracket />}

          <div className="ml-auto flex items-end gap-1.5">
            <NavButton
              label="Previous season"
              disabled={neighbours.prev == null}
              onClick={() => neighbours.prev != null && go(urlFor({ season: neighbours.prev }))}
            >
              <ArrowLeft className="size-4" />
            </NavButton>
            <NavButton
              label="Next season"
              disabled={neighbours.next == null}
              onClick={() => neighbours.next != null && go(urlFor({ season: neighbours.next }))}
            >
              <ArrowRight className="size-4" />
            </NavButton>
          </div>
        </div>
      </div>
    </div>
  )
}


/**
 * Keep `--site-header-h` matching the global header's REAL rendered height.
 *
 * The stylesheet already carries a correct default, so this is a correction rather than the source
 * of truth: it only matters when the header ends up a different height than the default assumes —
 * a wrapped nav on a narrow screen, or a future change to its padding. A ResizeObserver keeps the
 * two rows joined through any of that, at any width.
 *
 * Writing a CSS variable rather than React state is deliberate: the sticky offset then never
 * depends on a render pass, so it cannot be briefly wrong while the page hydrates.
 */
function useTrackSiteHeaderHeight(): void {
  useEffect(() => {
    const header = document.querySelector<HTMLElement>('[data-site-header]')
    if (!header) return
    const apply = () => {
      const h = Math.round(header.getBoundingClientRect().height)
      document.documentElement.style.setProperty('--site-header-h', `${h}px`)
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(header)
    window.addEventListener('resize', apply)
    return () => { ro.disconnect(); window.removeEventListener('resize', apply) }
  }, [])
}

const SELECT =
  'h-8 min-w-[7.5rem] rounded-md border border-input bg-card px-2 text-sm text-foreground outline-none focus-visible:border-[var(--gold)] focus-visible:ring-2 focus-visible:ring-[var(--gold)]/25'

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-[0.6rem] font-bold uppercase tracking-[0.09em] text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}

function NavButton({
  label, disabled, onClick, children,
}: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 min-w-10 items-center justify-center rounded-md border border-input bg-card text-foreground transition-colors hover:border-[var(--gold-dim)] disabled:cursor-not-allowed disabled:opacity-35"
    >
      {children}
    </button>
  )
}

/**
 * Zoom scales the group matrices and the bracket through a single CSS variable, so wide tables can
 * be pulled down to fit a laptop or pushed up on an ultrawide without any re-layout.
 *
 * Not in the URL: it describes the reader's screen, not the Season. Remembered per browser instead.
 */
const ZOOM_KEY = '8br.seasons.zoom'
const ZOOM_MIN = 0.7
const ZOOM_MAX = 1.4
const ZOOM_DEFAULT = '1'

// localStorage is an external store, so it is READ as one rather than copied into state inside an
// effect. That keeps the server render and the first client render agreeing on the default, and the
// saved value arrives through the normal subscription path instead of a second render pass.
const zoomListeners = new Set<() => void>()
function subscribeZoom(cb: () => void) {
  zoomListeners.add(cb)
  window.addEventListener('storage', cb)
  return () => { zoomListeners.delete(cb); window.removeEventListener('storage', cb) }
}
function zoomSnapshot() { return window.localStorage.getItem(ZOOM_KEY) ?? ZOOM_DEFAULT }
function zoomServerSnapshot() { return ZOOM_DEFAULT }
function writeZoom(v: number) {
  window.localStorage.setItem(ZOOM_KEY, String(v))
  for (const cb of zoomListeners) cb()
}

function Zoom({ onManual }: { onManual?: () => void }) {
  const raw = useSyncExternalStore(subscribeZoom, zoomSnapshot, zoomServerSnapshot)
  const parsed = Number(raw)
  const z = Number.isFinite(parsed) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, parsed)) : 1

  useEffect(() => {
    document.documentElement.style.setProperty('--season-zoom', String(z))
    return () => { document.documentElement.style.removeProperty('--season-zoom') }
  }, [z])

  const step = (delta: number) => {
    // Touching zoom is how the reader takes manual control back from a fitted bracket.
    onManual?.()
    writeZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + delta) * 100) / 100)))
  }

  return (
    <Field label="Zoom">
      <div className="flex h-8 items-center gap-1">
        <ZoomButton label="Zoom out" disabled={z <= ZOOM_MIN} onClick={() => step(-0.1)}>
          <Minus className="size-3.5" />
        </ZoomButton>
        <output className="tabular min-w-[3rem] text-center text-xs text-muted-foreground">
          {Math.round(z * 100)}%
        </output>
        <ZoomButton label="Zoom in" disabled={z >= ZOOM_MAX} onClick={() => step(0.1)}>
          <Plus className="size-3.5" />
        </ZoomButton>
      </div>
    </Field>
  )
}


/**
 * Scale the bracket down to whatever room the panel has.
 *
 * Sits beside Zoom because it answers the same question, and hands control back the moment the
 * reader touches Zoom afterwards. The measuring happens in the bracket itself — only it knows its
 * own natural width — so this just asks.
 */
function FitBracket() {
  return (
    <Field label="Bracket">
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event('8br:bracket-fit'))}
        title="Scale the bracket to fit the panel"
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-card px-2.5 text-sm font-medium text-foreground transition-colors hover:border-[var(--gold-dim)] focus-visible:outline-none focus-visible:border-[var(--gold)] focus-visible:ring-2 focus-visible:ring-[var(--gold)]/25"
      >
        <Maximize2 className="size-3.5" aria-hidden /> Fit Bracket
      </button>
    </Field>
  )
}

function ZoomButton({
  label, disabled, onClick, children,
}: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-md border border-input bg-card text-foreground transition-colors hover:border-[var(--gold-dim)] disabled:cursor-not-allowed disabled:opacity-35"
    >
      {children}
    </button>
  )
}

/**
 * Search the players in the Season on screen and jump to them.
 *
 * Results come from the registry through a server action — the entrants of THIS Season and nothing
 * else. Selecting a result scrolls their row into view and highlights it, which is the useful part
 * of the offline viewer's behaviour: in a table of thirty-odd names you want to be taken to the one
 * you typed rather than left to find it.
 */
function PlayerSearch({ searchPlayers }: { searchPlayers: (q: string) => Promise<SeasonPlayerHit[]> }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hits, setHits] = useState<SeasonPlayerHit[]>([])
  const [busy, startSearch] = useTransition()
  const boxRef = useRef<HTMLDivElement>(null)

  const load = (value: string) => {
    setQ(value)
    startSearch(async () => setHits(await searchPlayers(value.trim())))
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function jump(hit: SeasonPlayerHit) {
    setOpen(false)
    const row = document.querySelector<HTMLElement>(`[data-entrant="${hit.entrantId}"]`)
    if (!row) return
    row.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
    row.classList.add('season-hit')
    window.setTimeout(() => row.classList.remove('season-hit'), 2600)
  }

  return (
    <div ref={boxRef} className="relative">
      <Field label="Player search" htmlFor="f-player">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            id="f-player"
            type="search"
            value={q}
            placeholder="CueVerse ID or name…"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => load(e.target.value)}
            onFocus={() => { setOpen(true); if (hits.length === 0) load(q) }}
            className="h-8 w-full min-w-[13rem] rounded-md border border-input bg-card py-1 pl-8 pr-2 text-sm text-foreground outline-none focus-visible:border-[var(--gold)] focus-visible:ring-2 focus-visible:ring-[var(--gold)]/25"
          />
        </div>
      </Field>

      {open && (
        <div className="absolute left-0 top-[calc(100%+5px)] z-60 max-h-[24rem] w-[22rem] overflow-auto rounded-lg border border-border bg-card p-1.5 shadow-xl">
          {busy && <p className="px-2 py-2 text-xs text-muted-foreground">Searching…</p>}
          {!busy && hits.length === 0 && (
            <p className="px-2 py-2 text-xs text-muted-foreground">No player in this Season matches that.</p>
          )}
          {!busy && hits.map((h) => {
            const lines = identityLines({ cueverseId: h.cueverseId, preferredName: h.preferredName })
            return (
              <button
                key={h.entrantId}
                type="button"
                onClick={() => jump(h)}
                className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-muted"
              >
                <span className="block text-sm font-medium text-foreground">{lines.primary}</span>
                {lines.secondary && <span className="block text-xs text-muted-foreground">{lines.secondary}</span>}
                <span className="block text-[0.7rem] text-[var(--gold)]">
                  {h.groupLabel ?? 'Not in a published group'}{h.inPlayoffs ? ' · in the playoffs' : ''}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
