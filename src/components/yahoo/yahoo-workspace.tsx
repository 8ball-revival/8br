'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, Minimize2 } from 'lucide-react'

import type { ExplorerRow, ExplorerFacets } from '@/lib/stats/ladder-explorer'
import type { RankingsState } from '@/lib/stats/rankings-columns'
import { encodeRankingsState } from '@/lib/stats/rankings-columns'
import { RankingsExplorer } from '@/components/rankings/rankings-explorer'
import { cn } from '@/lib/utils'

import { YAHOO_PARAM_PREFIX } from '@/lib/yahoo/params'

import { YahooLadderCompact } from './yahoo-ladder-compact'

/**
 * The Yahoo workspace: one page, three views, and a ladder that can take the whole width.
 *
 * ── Everything is at /yahoo ──────────────────────────────────────────────────────────────────────
 * Home, Groups and Playoffs are views of this page rather than routes of their own, so the archive
 * header and the era it belongs to never leave the screen. A reader who has opened a 2007 season and
 * flipped to its bracket is still, visibly, in the archive.
 *
 * ── What is in the URL, and what is not ──────────────────────────────────────────────────────────
 * The view, the selected season, the chosen group and every ladder filter are query parameters: they
 * are what somebody would want to share, and what Back should reproduce. Expansion is not. Expanding
 * the ladder is a way of LOOKING at the page, not a different page, and putting it in history would
 * make Back mean "shrink the table" instead of "go back to what I was reading".
 *
 * ── The ladder's parameters are namespaced ───────────────────────────────────────────────────────
 * `season` here means the historical season the explorer has open. The ladder also has a season
 * FILTER, so its parameters carry an `r` prefix — `rseason`, `rfrom` — and the two can coexist in
 * one URL without either having to guess which was meant.
 */

export { YAHOO_PARAM_PREFIX } from '@/lib/yahoo/params'

export type YahooView = 'home' | 'groups' | 'playoffs'

export interface YahooSeasonNav {
  id: number
  label: string
}

export function YahooWorkspace({
  view, rows, facets, state, summary, seasonResults, seasonPanel,
  selectedSeasonId, previous, next, needsSeason,
}: {
  view: YahooView
  rows: ExplorerRow[]
  facets: ExplorerFacets
  state: RankingsState
  /** The archive summary strip, rendered on the server. */
  summary: React.ReactNode
  /** The shared Season Results panel, rendered on the server with Yahoo rows. */
  seasonResults: React.ReactNode
  /** The selected season's groups or bracket, rendered on the server. */
  seasonPanel: React.ReactNode
  selectedSeasonId: number | null
  previous: YahooSeasonNav | null
  next: YahooSeasonNav | null
  /** Somebody asked for Groups or Playoffs without choosing a season first. */
  needsSeason: boolean
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [expanded, setExpanded] = useState(false)
  const [lastView, setLastView] = useState('')
  const [search, setSearch] = useState(state.rowFilters.search)
  const expandRef = useRef<HTMLButtonElement>(null)
  const minimizeRef = useRef<HTMLButtonElement>(null)
  const promptRef = useRef<HTMLParagraphElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const disclaimerRef = useRef<HTMLParagraphElement>(null)
  const now = useMemo(() => new Date(), [])

  /*
   * Expansion is deliberately not persisted.
   *
   * Not in the URL, not in localStorage, not in a cookie. A fresh visit to /yahoo is Home with the
   * compact ladder, every time — because the archive's first screen is meant to be the two panels
   * side by side, and a preference remembered from last week would quietly replace the thing the
   * page is for with the thing somebody once looked at.
   */
  const viewKey = `${view}:${selectedSeasonId}`
  if (viewKey !== lastView) {
    // Adjusted during render rather than in an effect: an effect would paint the expanded ladder
    // once before collapsing it, which is a visible flash of the wrong layout on every navigation.
    setLastView(viewKey)
    if (expanded) setExpanded(false)
  }

  /** Rewrite the URL, keeping everything this control does not own. */
  const urlWith = useCallback((patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) p.delete(k)
      else p.set(k, v)
    }
    const qs = p.toString()
    return qs ? `/yahoo?${qs}` : '/yahoo'
  }, [params])

  const go = useCallback((patch: Record<string, string | null>) => {
    router.push(urlWith(patch), { scroll: false })
  }, [router, urlWith])

  /** The ladder's filters, written back with their prefix and without disturbing the page's own. */
  const applyRanking = useCallback((nextState: RankingsState) => {
    const p = new URLSearchParams(params.toString())
    // Clear the ladder's keys before writing, or a filter that has just been switched off would
    // survive as a stale parameter.
    for (const k of [...p.keys()]) if (k.startsWith(YAHOO_PARAM_PREFIX)) p.delete(k)
    const encoded = new URLSearchParams(encodeRankingsState(nextState, now, YAHOO_PARAM_PREFIX))
    for (const [k, v] of encoded) p.set(k, v)
    const qs = p.toString()
    router.push(qs ? `/yahoo?${qs}` : '/yahoo', { scroll: false })
  }, [params, router, now])

  // Search is a row filter: applied here at once, and written to the URL as it settles, so a shared
  // link reproduces the table without a round trip per keystroke.
  useEffect(() => {
    if (search === state.rowFilters.search) return
    const t = setTimeout(() => {
      applyRanking({ ...state, rowFilters: { ...state.rowFilters, search } })
    }, 350)
    return () => clearTimeout(t)
  }, [search, state, applyRanking])

  /*
   * How much page is left, measured rather than declared.
   *
   * A pure CSS chain cannot do this. `body` is `min-h-screen` with an auto height, so `main` grows
   * with its content — which means `height: 100%` on anything inside resolves against the content it
   * is supposed to be constraining, and a five-hundred-row table simply makes the page taller. The
   * only fixed quantity in the layout is the viewport, so the panel is told what is left of it: the
   * window, less where the panel starts, less the disclaimer that has to stay on screen beneath it.
   *
   * A floor keeps the controls and a few rows usable on a short window; below that the page scrolls,
   * which is the right outcome rather than a frame too small to read.
   */
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    const apply = () => {
      // Stacked on a phone: two viewport-tall panels one after the other would be a page you have
      // to scroll twice to leave, so there the panels keep their own bounded heights.
      if (window.innerWidth < 1024) { el.style.height = ''; return }
      const top = el.getBoundingClientRect().top
      const below = disclaimerRef.current
        ? disclaimerRef.current.getBoundingClientRect().height + 28
        : 24
      const next = Math.max(360, Math.round(window.innerHeight - top - below))
      // Only write when it actually moves, so observing the page cannot feed back into itself.
      if (Math.abs(parseFloat(el.style.height || '0') - next) > 1) el.style.height = `${next}px`
    }
    apply()
    window.addEventListener('resize', apply)
    const raf = requestAnimationFrame(apply)
    return () => { window.removeEventListener('resize', apply); cancelAnimationFrame(raf) }
  }, [view, expanded, needsSeason, rows])

  const minimize = useCallback(() => {
    setExpanded(false)
    // Focus returns to the control that opened it, or a keyboard reader is dropped at the top of a
    // page that has just changed shape underneath them.
    requestAnimationFrame(() => expandRef.current?.focus())
  }, [])

  useEffect(() => {
    if (!expanded) return
    requestAnimationFrame(() => minimizeRef.current?.focus())
  }, [expanded])

  // Somebody arrived at Groups or Playoffs with no season chosen. Rather than opening an arbitrary
  // one, the page says so and puts the keyboard on the explanation.
  useEffect(() => {
    if (needsSeason) requestAnimationFrame(() => promptRef.current?.focus())
  }, [needsSeason])

  const tabs: { id: YahooView; label: string }[] = [
    { id: 'home', label: 'Home' },
    { id: 'groups', label: 'Groups' },
    { id: 'playoffs', label: 'Playoffs' },
  ]

  return (
    <div className="ya-root flex w-full flex-col">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[0.68rem] font-extrabold uppercase tracking-[0.22em] text-[var(--cyan)]">Historical Archive</p>
          <h1 className="font-display text-3xl font-black tracking-tight text-foreground sm:text-4xl">Yahoo Pool Archive</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            The original Yahoo era of 8BRCAM, kept as it survived. Ratings here are a separate legacy
            ladder — they are not part of the current CueVerse rankings.
          </p>
        </div>

        <div role="tablist" aria-label="Archive view" className="flex gap-px bg-[var(--line-strong)]">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              id={`ya-tab-${t.id}`}
              aria-selected={view === t.id}
              aria-controls="ya-panel"
              tabIndex={view === t.id ? 0 : -1}
              onClick={() => go({ view: t.id === 'home' ? null : t.id })}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
                e.preventDefault()
                const i = tabs.findIndex((x) => x.id === view)
                const d = e.key === 'ArrowRight' ? 1 : -1
                const nextTab = tabs[(i + d + tabs.length) % tabs.length]
                go({ view: nextTab.id === 'home' ? null : nextTab.id })
              }}
              className={cn(
                'min-w-[7rem] px-5 py-2 text-[0.72rem] font-bold uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]',
                view === t.id ? 'bg-brand text-primary-foreground' : 'bg-[var(--void)] text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {/*
        The summary sits with the season results, not across the top.
        On Home it is the head of the right-hand column, so the ladder gets the full height of the
        page beside it rather than starting a hundred pixels down. On a season view there is no
        second column to put it in, so it goes back to being a strip — it has to stay visible, since
        it is what says which archive you are reading.
      */}
      {view !== 'home' && !needsSeason && <div className="mb-1">{summary}</div>}

      {/*
        The panel is the only part of the page allowed to grow, so the frames inside it end exactly
        where the page does. `min-h-0` lets it shrink below its content; the minimum keeps the
        controls and a few rows usable when the window is genuinely short.
      */}
      <div
        ref={panelRef}
        id="ya-panel"
        role="tabpanel"
        aria-labelledby={`ya-tab-${view}`}
        className="mt-5 flex min-h-0 flex-col"
      >
        {needsSeason && (
          <p
            ref={promptRef}
            tabIndex={-1}
            role="status"
            className="mb-4 border border-[var(--gold)]/50 bg-[var(--selected-surface)] px-4 py-3 text-sm text-foreground focus-visible:outline-none"
          >
            Choose a season from the results below to see its groups or its bracket.
          </p>
        )}

        {view === 'home' || needsSeason ? (
          expanded ? (
            /*
             * Expanded: the whole interface, over Yahoo rows.
             *
             * This is the Rankings page's own component with a different base path and a namespaced
             * set of parameters — not a copy of it. Reusing it is what makes the columns, the rail,
             * the sorting, the colours and the filters identical to the current ladder rather than
             * merely similar to it.
             */
            <div className="scrollbar-themed flex min-h-0 flex-1 flex-col overflow-y-auto pr-1">
            <RankingsExplorer
              rows={rows}
              facets={facets}
              state={state}
              basePath="/yahoo"
              paramPrefix={YAHOO_PARAM_PREFIX}
              keepParams={pageParams(params)}
              showScopes={false}
              eyebrow="Historical Archive"
              title="Yahoo Legacy Rankings"
              heading={
                <p className="text-xs text-muted-foreground">
                  The Yahoo era of 8BRCAM, 2005–2014. A separate ladder from the current CueVerse rankings.
                </p>
              }
              action={
                <button
                  ref={minimizeRef}
                  type="button"
                  onClick={minimize}
                  aria-label="Minimize the rankings and show the season results again"
                  className="inline-flex items-center gap-1.5 border border-border px-2.5 py-1.5 text-[0.7rem] font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:border-[var(--gold)] hover:text-[var(--gold)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                >
                  <Minimize2 className="size-3.5" aria-hidden />
                  Minimize
                </button>
              }
            />
            </div>
          ) : (
            /*
             * One frame grows, the other does not.
             *
             * The ladder fills whatever the window has left, because more height there means more
             * players. Season Results is sized by its own rows and pinned to the top of its column:
             * stretching it to the ladder's bottom edge would buy nothing but a tall panel of empty
             * background under the last season.
             *
             * The ROW still stretches — that is what lets the ladder fill it — and the season column
             * opts out on its own with `self-start`. Putting `items-start` on the grid instead made
             * both columns content-height, which is how the ladder ended up twenty-three thousand
             * pixels tall with no scroller at all.
             */
            <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
              {/* A phone reads the honours first and the ladder second; a desktop shows both at once. */}
              <div className="order-2 flex min-h-0 min-w-0 flex-col lg:order-1">
                <YahooLadderCompact
                  rows={rows}
                  facets={facets}
                  state={state}
                  onApply={applyRanking}
                  onExpand={() => setExpanded(true)}
                  expandRef={expandRef}
                  search={search}
                  onSearch={setSearch}
                />
              </div>
              <div className="order-1 flex min-w-0 flex-col gap-4 self-start lg:order-2">
                {summary}
                {seasonResults}
              </div>
            </div>
          )
        ) : (
          <div className="min-w-0 overflow-y-auto lg:min-h-0 lg:flex-1">
            {(previous || next) && (
              <nav aria-label="Season navigation" className="mb-3 flex items-center justify-between gap-3">
                <NavButton
                  season={previous}
                  direction="previous"
                  onGo={(id) => go({ season: String(id) })}
                />
                <NavButton
                  season={next}
                  direction="next"
                  onGo={(id) => go({ season: String(id) })}
                />
              </nav>
            )}
            {seasonPanel}
          </div>
        )}
      </div>

      <p ref={disclaimerRef} className="mt-6 shrink-0 border-t border-border pt-3 text-xs text-muted-foreground">
        A historical community archive. 8 Ball Registry is not affiliated with or endorsed by Yahoo.
      </p>
    </div>
  )
}

/**
 * Previous and Next, disabled at the ends rather than hidden.
 *
 * A control that disappears at the boundary moves everything beside it, and the reader who was about
 * to click Next finds Previous under their pointer. Disabled says the same thing and stays still.
 */
function NavButton({
  season, direction, onGo,
}: {
  season: YahooSeasonNav | null
  direction: 'previous' | 'next'
  onGo: (id: number) => void
}) {
  const isPrev = direction === 'previous'
  return (
    <button
      type="button"
      disabled={!season}
      onClick={() => season && onGo(season.id)}
      aria-label={season ? `${isPrev ? 'Previous' : 'Next'} season: ${season.label}` : `No ${direction} season`}
      className={cn(
        'inline-flex items-center gap-1.5 border border-border px-3 py-1.5 text-[0.72rem] font-semibold transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-35',
        'enabled:hover:border-[var(--gold)] enabled:hover:text-[var(--gold)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
        !isPrev && 'ml-auto',
      )}
    >
      {isPrev && <ChevronLeft className="size-3.5" aria-hidden />}
      <span className="text-muted-foreground">{isPrev ? 'Previous' : 'Next'}</span>
      <span className="text-foreground">{season?.label ?? '—'}</span>
      {!isPrev && <ChevronRight className="size-3.5" aria-hidden />}
    </button>
  )
}

/** The parameters this page owns, which a ladder filter change must carry through unchanged. */
function pageParams(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of ['view', 'season', 'group']) {
    const v = params.get(k)
    if (v) out[k] = v
  }
  return out
}
