'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Crown, Maximize2, Search, Trophy, X } from 'lucide-react'

import type { ExplorerRow, ExplorerFacets, RecordView } from '@/lib/stats/ladder-explorer'
import { RECORD_VIEWS, type RankingsState } from '@/lib/stats/rankings-columns'
import { highestRatingOf, isHighestRating, ratingAriaLabelFor, ratingTier } from '@/lib/stats/rating-tier'
import { IdentityCell } from '@/components/rankings/identity-cell'
import { RatingLegend } from '@/components/rankings/rating-legend'
import { cn } from '@/lib/utils'

import { YahooFilterPanel } from './yahoo-filter-panel'

/**
 * The archive ladder at half width.
 *
 * ── Compressed, not reduced ──────────────────────────────────────────────────────────────────────
 * Home gives this half the page, so it shows about seventeen rows and scrolls for the rest. What it
 * does NOT do is drop capability to fit: the search, the rating legend, the championship counts and
 * every filter the full interface has are all here, the last of them behind one sliders icon. A
 * compact view that quietly did less would make the reader's first impression of the archive its
 * weakest one.
 *
 * ── Same colours, same rules, same helpers ───────────────────────────────────────────────────────
 * The rating band comes from `ratingTier` and the identity from `IdentityCell` — the shared pieces
 * the Rankings table itself uses. That is what guarantees a player is the same colour here as in
 * expanded mode: there is only one implementation, so there is nothing to keep in step.
 *
 * ── Why the scroller is allowed here ─────────────────────────────────────────────────────────────
 * Everywhere else on this page an inner scrollbar is refused, because it hides how much there is.
 * Here it is the point: the panel beside it is a fixed frame of season results, and a five-hundred
 * row table would leave that column staring at fifteen thousand pixels of nothing. The count in the
 * heading says how many rows the scroller holds, so nothing is concealed by it.
 */

/*
 * The frame has no height of its own.
 *
 * It used to be `max-h-[33rem]` -- about seventeen rows, which is right on one laptop and wrong on
 * every other display: a 1440-tall window left a third of the page empty beneath it, and a 768-tall
 * one pushed the legend off the bottom. So the height comes from what is left over instead. The page
 * is a flex column from `main` down to this table, every link in the chain carries `min-h-0`, and
 * this scroller is the one part allowed to grow. More window means more rows, immediately, with no
 * measurement and nothing to keep in step.
 *
 * `min-h-0` is the load-bearing half: a flex item's default minimum is its CONTENT, so without it a
 * five-hundred-row table refuses to shrink and pushes the legend past the bottom of the screen.
 *
 * On a phone the panels are stacked, and two viewport-tall frames one after another would be a page
 * you scroll twice to leave. There the scroller keeps a bounded height instead.
 */
const FRAME = 'max-h-[60svh] lg:max-h-none lg:min-h-0 lg:flex-1'

export function YahooLadderCompact({
  rows, facets, state, onApply, onExpand, expandRef, search, onSearch,
}: {
  rows: ExplorerRow[]
  facets: ExplorerFacets
  state: RankingsState
  onApply: (next: RankingsState) => void
  onExpand: () => void
  expandRef: React.Ref<HTMLButtonElement>
  search: string
  onSearch: (v: string) => void
}) {
  const [record, setRecord] = useState<RecordView>('overall')
  const scrollerRef = useRef<HTMLDivElement>(null)

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      r.label.toLowerCase().includes(q)
      || r.preferredName.toLowerCase().includes(q)
      || (r.cueverseId ?? '').toLowerCase().includes(q))
  }, [rows, search])

  // Filtering returns the table to its top: the row somebody was looking at is usually gone, and
  // landing mid-list in a different population reads as a rendering fault.
  useEffect(() => { scrollerRef.current?.scrollTo({ top: 0 }) }, [rows, search, record])

  const highest = useMemo(() => highestRatingOf(rows.map((r) => r.rating)), [rows])

  return (
    <section aria-labelledby="ya-ladder" className="flex min-h-0 min-w-0 flex-col lg:h-full">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <h2 id="ya-ladder" className="font-display text-sm font-extrabold uppercase tracking-[0.16em] text-[var(--gold)]">
          Yahoo Legacy Rankings
        </h2>
        <div className="flex items-center gap-2">
          <span className="tabular text-[0.7rem] text-muted-foreground" aria-live="polite">
            {visible.length === rows.length
              ? `${rows.length} players`
              : `${visible.length} of ${rows.length}`}
          </span>
          <button
            ref={expandRef}
            type="button"
            onClick={onExpand}
            aria-label="Expand the Yahoo legacy rankings to the full width of the page"
            className="inline-flex items-center gap-1.5 border border-border px-2.5 py-1.5 text-[0.7rem] font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:border-[var(--gold)] hover:text-[var(--gold)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <Maximize2 className="size-3.5" aria-hidden />
            Expand
          </button>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[10rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search all 498 archive players…"
            aria-label="Search the Yahoo legacy rankings"
            className="w-full rounded-none border border-border bg-[var(--void)] py-1.5 pl-8 pr-7 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
          {search && (
            <button type="button" onClick={() => onSearch('')} aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
        <YahooFilterPanel
          applied={state}
          facets={facets}
          onApply={onApply}
          resultCount={visible.length}
          totalCount={rows.length}
        />
      </div>

      {/*
        Which record the W-L-T columns describe. Local, not in the URL: it changes what is DISPLAYED,
        not who is ranked — the splits are already on every row — so two links that return the same
        standing should not look like different queries.
      */}
      <div role="group" aria-label="Record shown" className="mb-2 flex flex-wrap gap-px bg-[var(--line-strong)]">
        {RECORD_VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={record === v.id}
            onClick={() => setRecord(v.id)}
            title={v.hint}
            className={cn(
              'flex-1 px-2 py-1 text-[0.62rem] font-bold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]',
              record === v.id ? 'bg-brand text-primary-foreground' : 'bg-[var(--void)] text-muted-foreground hover:text-foreground',
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="flex-1 border border-dashed border-border px-3 py-10 text-center text-sm text-muted-foreground">
          No archive player matches these filters.
        </p>
      ) : (
        <div
          ref={scrollerRef}
          role="region"
          aria-label="Yahoo legacy rankings, scrollable"
          tabIndex={0}
          className={cn('scrollbar-themed min-w-0 overflow-auto border border-border', FRAME,
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]')}
        >
          <table className="w-full min-w-[36rem] table-fixed border-collapse text-sm">
            {/*
              Fixed widths, because auto layout gives the slack to the widest column — which is the
              player's name — and that opened a hand's width of empty table between the identity and
              the rating it belongs to. Percentages rather than pixels so the same proportions hold
              in the narrow column on Home and in a wider one.
            */}
            <colgroup>
              <col className="w-[7%]" />
              <col className="w-[6%]" />
              <col className="w-[26%]" />
              <col className="w-[15%]" />
              <col className="w-[6%]" />
              <col className="w-[6%]" />
              <col className="w-[6%]" />
              <col className="w-[9%]" />
              <col className="w-[11%]" />
              <col className="w-[8%]" />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-border bg-card text-[0.6rem] uppercase tracking-[0.1em] text-muted-foreground">
                <th scope="col" className="bg-card px-1.5 py-2 text-center" title="Championships">
                  <Crown className="mx-auto size-3.5" style={{ color: 'var(--gold)' }} aria-hidden />
                  <span className="sr-only">Championships</span>
                </th>
                <th scope="col" className="bg-card px-1.5 py-2 text-right">#</th>
                <th scope="col" className="bg-card px-2 py-2 text-left">Player</th>
                <th scope="col" className="bg-card px-1.5 py-2 text-right">Legacy rating</th>
                <th scope="col" className="bg-card px-1.5 py-2 text-right">W</th>
                <th scope="col" className="bg-card px-1.5 py-2 text-right">L</th>
                <th scope="col" className="bg-card px-1.5 py-2 text-right" title="Draws">D</th>
                <th scope="col" className="bg-card px-1.5 py-2 text-right">Played</th>
                <th scope="col" className="bg-card px-2 py-2 text-right">Win %</th>
                <th scope="col" className="bg-card px-2 py-2 text-right">Seasons</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const rec = recordFor(r, record)
                return (
                  <tr key={r.playerId} className="border-b border-border/60 last:border-0 hover:bg-card">
                    <td className="px-1.5 py-1.5 text-center">
                      <ChampionshipCell row={r} />
                    </td>
                    <td className="tabular px-1.5 py-1.5 text-right text-muted-foreground">{r.rank}</td>
                    <td className="min-w-0 px-2 py-1.5">
                      <IdentityCell
                        identity={{ preferredName: r.preferredName, cueverseId: r.cueverseId, slug: r.slug }}
                        className="min-w-0"
                      />
                    </td>
                    <td className="tabular px-1.5 py-1.5 text-right">
                      <RatingValue rating={r.rating} highest={highest} />
                    </td>
                    <td className="tabular px-1.5 py-1.5 text-right">{rec.wins}</td>
                    <td className="tabular px-1.5 py-1.5 text-right">{rec.losses}</td>
                    <td className="tabular px-1.5 py-1.5 text-right">{rec.draws}</td>
                    <td className="tabular px-1.5 py-1.5 text-right">{rec.played}</td>
                    <td className="tabular px-2 py-1.5 text-right">{rec.pct}</td>
                    <td className="tabular px-2 py-1.5 text-right text-muted-foreground">{r.seasonsPlayed}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/*
        The legend is a footer of this frame, not a row of the table.
        It sits outside the scroller and after it, so it stays put while five hundred players move
        past above it — and because the frame reaches the bottom of the page, so does the legend.
        It never overlays a row: it occupies its own space rather than floating over one.
      */}
      <RatingLegend className="mt-2 shrink-0" />
    </section>
  )
}

/** The same band, the same first-place override and the same halo the Rankings table uses. */
function RatingValue({ rating, highest }: { rating: number | null; highest: number | null }) {
  const tier = ratingTier(rating)
  if (tier == null) return <span className="text-muted-foreground">—</span>
  return (
    <span
      className={cn('rating-primary', `rating-primary--${tier}`, isHighestRating(rating, highest) && 'rating-primary--highest')}
      aria-label={ratingAriaLabelFor(rating, highest)}
    >
      {rating}
    </span>
  )
}

/**
 * Championships, as one number that can be taken apart.
 *
 * The column is a sliver wide, so it shows the total; the breakdown is a click, a focus or a tap
 * away rather than a hover, because a hover-only disclosure does not exist on a touch screen. Runner
 * up finishes are deliberately not counted: this column says what somebody won.
 */
function ChampionshipCell({ row }: { row: ExplorerRow }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const total = row.seasonTitles + row.tournamentTitles

  const close = useCallback(() => setOpen(false), [])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close() }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown) }
  }, [open, close])

  // Nobody's absence is decorated. A dash is the whole answer.
  if (total === 0) return <span className="text-muted-foreground">—</span>

  const who = row.preferredName || row.cueverseId || 'This player'
  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onFocus={() => setOpen(true)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        aria-expanded={open}
        aria-label={`${who}: ${total} championship${total === 1 ? '' : 's'} — ${row.seasonTitles} season, ${row.tournamentTitles} tournament. Show the breakdown.`}
        className="inline-flex items-center gap-1 rounded px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
      >
        <Crown className="size-3.5" style={{ color: 'var(--gold)' }} aria-hidden />
        <span className="tabular font-semibold">{total}</span>
      </button>
      {open && (
        <div
          role="status"
          className="absolute left-0 top-full z-30 mt-1 w-max border border-[var(--line-strong)] bg-[var(--graphite)] px-2.5 py-2 text-left text-[0.7rem] shadow-xl"
        >
          <p className="flex items-center gap-1.5 whitespace-nowrap">
            <Crown className="size-3" style={{ color: 'var(--gold)' }} aria-hidden />
            <span className="text-muted-foreground">Season championships</span>
            <span className="tabular ml-auto font-semibold">{row.seasonTitles}</span>
          </p>
          <p className="mt-1 flex items-center gap-1.5 whitespace-nowrap">
            <Trophy className="size-3" style={{ color: 'var(--gold)' }} aria-hidden />
            <span className="text-muted-foreground">Tournament championships</span>
            <span className="tabular ml-auto font-semibold">{row.tournamentTitles}</span>
          </p>
          <p className="mt-1 flex items-center gap-1.5 whitespace-nowrap border-t border-border pt-1 font-semibold">
            <span>Total</span>
            <span className="tabular ml-auto">{total}</span>
          </p>
        </div>
      )}
    </div>
  )
}

/** The split the Record Shown switch selects. Every figure is already on the row. */
function recordFor(r: ExplorerRow, view: RecordView) {
  const pct = (w: number, played: number) => (played === 0 ? '—' : `${((w / played) * 100).toFixed(1)}%`)
  if (view === 'group') {
    const played = r.groupWins + r.groupLosses + r.draws
    return { wins: r.groupWins, losses: r.groupLosses, draws: r.draws, played, pct: pct(r.groupWins, played) }
  }
  if (view === 'playoff') {
    const played = r.playoffWins + r.playoffLosses
    return { wins: r.playoffWins, losses: r.playoffLosses, draws: 0, played, pct: pct(r.playoffWins, played) }
  }
  if (view === 'tournament') {
    const played = r.tournamentWins + r.tournamentLosses
    return { wins: r.tournamentWins, losses: r.tournamentLosses, draws: 0, played, pct: pct(r.tournamentWins, played) }
  }
  return { wins: r.wins, losses: r.losses, draws: r.draws, played: r.played, pct: `${r.matchWinPct.toFixed(1)}%` }
}
