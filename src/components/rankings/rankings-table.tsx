'use client'

import { Fragment, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Crown, Flame, Snowflake, Trophy } from 'lucide-react'

import type { ExplorerRow } from '@/lib/stats/ladder-explorer'
import type { PlayerDetail } from '@/lib/stats/rankings-detail'
import {
  COLUMN_BY_KEY, isQualified,
  type ColumnDef, type SortSpec,
} from '@/lib/stats/rankings-columns'
import { highestRatingOf, isHighestRating, ratingAriaLabelFor, ratingTier } from '@/lib/stats/rating-tier'
import { cn } from '@/lib/utils'

import { ExpandedRow } from './expanded-row'
import { IdentityCell } from './identity-cell'
import { Tip } from './tooltip'

/**
 * The Rankings table.
 *
 * ── Layout decisions that are load-bearing ───────────────────────────────────────────────────────
 *
 * The Player column is CLAMPED. Left to itself it took 481px at 1728 — nearly a third of the table
 * — because it was the only column whose content could grow. `clamp(11rem, 20vw, 300px)` gives it
 * room for a two-line identity and stops there; long values truncate with the full text reachable
 * on hover and focus.
 *
 * Rank and Player are STICKY horizontally, so a reader scrolled to the right-hand statistics can
 * still see whose row they are reading. The column header is sticky vertically inside a bounded
 * pane, and the pane itself is sticky beneath the navigation at an offset measured from the real
 * rendered header rather than a hardcoded 64px that breaks the moment the header wraps.
 *
 * `border-separate` with zero spacing rather than `border-collapse`: sticky cells and collapsed
 * borders are a long-standing bad pair in Chrome — the cell keeps its offset but loses its borders.
 * Row separators come from per-cell `border-b`, so nothing is lost by separating them.
 */

export const PLAYER_COL_WIDTH = 'clamp(11rem, 20vw, 300px)'

/**
 * The two frozen columns' widths, which are also their neighbours' sticky offsets.
 *
 * These are ENFORCED with matching width/minWidth/maxWidth rather than guessed from the content,
 * because an offset that disagrees with the rendered width is a bug you only see at the moment
 * someone scrolls: the frozen column jumps by the difference and then overlaps the column behind
 * it. The first attempt here declared 68px for a control cell that rendered 78, and Rank shifted
 * 10px sideways on every horizontal scroll.
 *
 * CONTROL_COL holds one 32px control plus the cell padding: 32 + 8 = 40.
 */
// Rank is the FIRST column now. The pin gutter that used to sit before it is gone, along with the
// 40px of dead space it reserved on every row.
const CONTROL_COL = 0
const RANK_COL = 56

/**
 * How long a run has to be before it is a run.
 *
 * Two results is a coincidence. Three is the shortest run that says something about form, so it is
 * where the colour and the icon start; everything between −2 and +2 stays plain.
 */
/**
 * The primary Rating value — the row's headline number.
 *
 * Coloured by band — gold, purple, blue, green, red, grey descending — with one exception laid over
 * the top: whoever holds the highest rating on the table renders red for first place, whatever band
 * they are actually in.
 *
 * Flat colour, no glow, no animation. A layered neon version was tried and it smeared the digits;
 * a rating that is hard to read is a worse rating however striking it looks.
 *
 * Deliberately the ONLY rating on the site that is coloured. Peak rating, the expanded panel, the
 * comparison table, player profiles, the rating-history chart, Creator and the homepage all display
 * ratings; if any of them adopted the bands, the colour would stop meaning "this is the figure the
 * ranking is built on".
 *
 * An absent rating stays a plain neutral dash. Painting it grey would make "no rating recorded" look
 * identical to "rated below 1200", which are not the same claim.
 */
function RatingCell({ rating, highest }: { rating: number | null; highest: number | null }) {
  const tier = ratingTier(rating)
  if (tier == null) return <span className="text-muted-foreground">—</span>
  const top = isHighestRating(rating, highest)
  return (
    <span
      className={cn('rating-primary', `rating-primary--${tier}`, top && 'rating-primary--highest')}
      aria-label={ratingAriaLabelFor(rating, highest)}
    >
      {rating}
    </span>
  )
}

const STREAK_RUN = 3

/**
 * The current streak, as a signed number.
 *
 * `+9` and `−1` rather than `W9` and `L1`: the sign already says which direction, and a signed
 * column sorts and scans as one continuous scale from a long losing run to a long winning one.
 *
 * Colour marks a RUN, not every result — and never on its own. A run of wins is green and carries a
 * flame; a run of losses is red and carries a snowflake. Both keep the number and the sign, so the
 * value is readable without seeing the colour at all.
 */
function StreakCell({ streak }: { streak: number }) {
  if (streak === 0) return <span className="text-muted-foreground">—</span>

  const hot = streak >= STREAK_RUN
  const cold = streak <= -STREAK_RUN
  const magnitude = Math.abs(streak)
  // A true minus sign rather than a hyphen: it aligns with the digits in a tabular column.
  const text = streak > 0 ? `+${streak}` : `−${magnitude}`

  return (
    <span
      className={cn(
        'inline-flex items-center justify-end gap-1',
        hot ? 'font-semibold text-[var(--streak-hot)]'
          : cold ? 'font-semibold text-[var(--streak-cold)]'
            : 'text-foreground',
      )}
      aria-label={`${magnitude}-match ${streak > 0 ? 'winning' : 'losing'} streak`}
    >
      {hot && (
        <Flame
          className="size-3.5 fill-[var(--streak-fire)] text-[var(--streak-fire)]"
          aria-hidden
        />
      )}
      {cold && <Snowflake className="size-3.5 text-[var(--streak-ice)]" aria-hidden />}
      {text}
    </span>
  )
}

/**
 * A championship count.
 *
 * Season Championships wear the gold diamond the rest of the site uses for a Season title;
 * Cup Titles wear the trophy. Clicking opens the player's expanded row, where the
 * exact competitions behind the number are listed and linked — a count nobody can trace is a count
 * nobody should have to take on trust.
 */
function TitleCell({ n, kind, onOpen, playerName }: {
  n: number
  kind: 'season' | 'cup'
  onOpen: () => void
  playerName: string
}) {
  // A dash is the whole answer for nobody. An icon beside it would decorate an absence.
  if (n === 0) return <span className="text-muted-foreground">—</span>
  const Icon = kind === 'season' ? Crown : Trophy
  const what = kind === 'season' ? 'Season Championship' : 'Cup Title'
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${playerName}: ${n} ${what}${n === 1 ? '' : 's'}. Show the competitions behind this.`}
      className="inline-flex items-center gap-1 rounded px-1 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
    >
      <Icon className="size-3.5" style={{ color: 'var(--gold)' }} aria-hidden />
      <span className="font-semibold">{n}</span>
    </button>
  )
}

/** A count that can be traced, rendered as a control that opens the evidence. */
function EvidenceCell({ n, onOpen, label }: { n: number; onOpen: () => void; label: string }) {
  if (n === 0) return <span className="text-muted-foreground">—</span>
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${label}. Show the competitions behind this.`}
      className="rounded px-1 underline decoration-dotted underline-offset-2 hover:text-[var(--gold)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
    >
      {n}
    </button>
  )
}

/**
 * How tall the table pane may be: from where it sits to the bottom of the window.
 *
 * The pane has to be a bounded scrollport, because that is what the sticky column header sticks TO.
 * Unbounded, `sticky top-0` on the header pins it to a box that scrolls away with the page — which
 * is how the header came to sit 166px below the navigation in the first place.
 *
 * The bound is measured from the pane's own position rather than assumed, so it holds at any width
 * and whatever the filter bar wraps to. The consequence is that the page barely scrolls: the table
 * fills what is left of the window, its header stays put at the pane's top, and the header can
 * never rise above the navigation.
 */
function usePaneHeight(ref: React.RefObject<HTMLDivElement | null>): number | null {
  const [height, setHeight] = useState<number | null>(null)
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current
      if (!el) return
      const top = el.getBoundingClientRect().top + window.scrollY
      // A floor keeps the table usable on a short window rather than collapsing it to a sliver.
      setHeight(Math.max(320, window.innerHeight - top - 16))
    }
    measure()
    window.addEventListener('resize', measure)
    const ro = new ResizeObserver(measure)
    if (ref.current?.parentElement) ro.observe(ref.current.parentElement)
    return () => { window.removeEventListener('resize', measure); ro.disconnect() }
  }, [ref])
  return height
}

export interface RankingsTableProps {
  rows: ExplorerRow[]
  columns: ColumnDef[]
  sort: SortSpec[]
  onSort: (key: string, additive: boolean) => void
  expanded: string | null
  onToggleExpand: (row: ExplorerRow) => void
  details: Record<string, PlayerDetail | 'loading'>
  minMatches: number
  /** Sticky offset for the pane, measured from the real rendered site header. */
  topOffset: number
  emptyMessage: string
}

export function RankingsTable(props: RankingsTableProps) {
  const { rows, columns, topOffset, emptyMessage } = props

  /*
   * The highest rating currently on the table.
   *
   * Computed from the rows actually being shown — including pinned ones, which are on the table too
   * — so filtering to a division marks the best player IN that division rather than pointing at a
   * row that is no longer there. Derived during render rather than stored, because it is a fact
   * about the current rows and nothing else.
   */
  const highestRating = highestRatingOf(rows.map((r) => r.rating))
  const colSpan = columns.length + 1
  const frameRef = useRef<HTMLDivElement>(null)
  const paneHeight = usePaneHeight(frameRef)

  return (
    <div ref={frameRef} className="overflow-hidden rounded-md border border-border">
      <div
        data-rankings-scroller
        className="scrollbar-themed overflow-auto rounded-md"
        style={{
          // Before the measurement lands, fall back to the window minus the site header, which is
          // close enough that the first paint is not a full-page-tall table that then snaps.
          maxHeight: paneHeight != null ? paneHeight : `calc(100dvh - ${topOffset}px - 1rem)`,
        }}
      >
        <table data-rankings-table className="w-full min-w-max border-separate border-spacing-0 text-sm">
          <caption className="sr-only">
            Player rankings. Rank is the official standing; sorting by another column reorders the
            table without changing it.
          </caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <HeaderCell key={c.key} col={c} {...props} />
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={colSpan} className="px-3 py-12 text-center text-sm text-muted-foreground">
                  {emptyMessage}
                </td>
              </tr>
            )}
            {rows.map((r) => <Row key={r.playerId} row={r} highestRating={highestRating} {...props} />)}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function HeaderCell({ col, sort, onSort }: { col: ColumnDef } & RankingsTableProps) {
  const s = sort.find((x) => x.key === col.key)
  const sticky = col.key === 'rank' ? { left: CONTROL_COL } : col.key === 'player' ? { left: CONTROL_COL + RANK_COL } : null
  const label = col.short ?? col.label
  const fullLabel = col.label
  const tooltip = col.tooltip

  return (
    <th
      scope="col"
      data-col={col.key}
      aria-sort={s ? (s.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn(
        'sticky top-0 z-30 border-b border-border bg-card px-2.5 py-2 align-bottom font-medium',
        // Most headers are short and read best on one line. The honours headers are not: forcing
        // "Season Championships 👑" onto one line drags the whole column to its width and pushes
        // everything else off screen. Those wrap instead, and the row aligns on its baseline so a
        // two-line header sits level with the one-line ones beside it.
        col.group === 'titles' ? 'w-[7.5rem] whitespace-normal leading-tight' : 'whitespace-nowrap',
        col.align === 'right' ? 'text-right' : 'text-left',
        sticky && 'z-40',
        // The active sort is marked with a neutral lift and gold TEXT. A translucent gold wash over
        // charcoal renders brown, which is not a colour this site uses.
        s && 'bg-white/[0.06]',
      )}
      style={{
        ...(sticky ?? {}),
        ...(col.key === 'player'
          ? { width: PLAYER_COL_WIDTH, minWidth: '11rem', maxWidth: 300 }
          : col.key === 'rank' ? { width: RANK_COL, minWidth: RANK_COL, maxWidth: RANK_COL } : {}),
      }}
    >
      <Tip text={`${tooltip}\n\nClick to sort. Shift-click to add a secondary sort.`} side="bottom">
        <span
          role="button"
          tabIndex={-1}
          onClick={(e) => onSort(col.key, e.shiftKey)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(col.key, e.shiftKey) }
          }}
          className={cn('inline-flex items-center gap-1', s && 'text-[var(--gold)]')}
        >
          <span aria-hidden>{label}</span>
          <span className="sr-only">{fullLabel}</span>
          {s?.dir === 'desc' && <ArrowDown className="size-3" aria-hidden />}
          {s?.dir === 'asc' && <ArrowUp className="size-3" aria-hidden />}
        </span>
      </Tip>
    </th>
  )
}

function Row({
  row, highestRating = null, columns, expanded, onToggleExpand, details, minMatches,
}: {
  row: ExplorerRow
  /** The highest rating on the whole table, so a row can tell whether it holds it. */
  highestRating?: number | null
} & RankingsTableProps) {
  const isOpen = expanded === row.playerId
  const qualified = isQualified(row, minMatches)
  const name = row.preferredName || row.cueverseId || 'Unknown player'
  const open = () => { if (!isOpen) onToggleExpand(row) }

  // Neutral lifts, never a gold wash: gold over charcoal goes brown.
  const bg = isOpen ? 'bg-white/[0.06]' : 'bg-card'

  return (
    <Fragment>
      <tr
        data-player-row={row.playerId}
        className={cn(
          'transition-colors hover:bg-white/[0.04]',
          isOpen && 'bg-white/[0.06]',
          !qualified && 'opacity-70',
        )}
      >
        {columns.map((c) => {
          const sticky = c.key === 'rank' ? { left: CONTROL_COL } : c.key === 'player' ? { left: CONTROL_COL + RANK_COL } : null
          return (
            <td
              key={c.key}
              className={cn(
                'border-b border-border/60 px-2.5 py-1.5',
                c.align === 'right' ? 'text-right tabular-nums' : 'text-left',
                c.key !== 'player' && 'whitespace-nowrap',
                sticky && cn('sticky z-10', bg),
              )}
              style={{
                ...(sticky ?? {}),
                ...(c.key === 'player'
                  ? { width: PLAYER_COL_WIDTH, minWidth: '11rem', maxWidth: 300 }
                  : c.key === 'rank' ? { width: RANK_COL, minWidth: RANK_COL, maxWidth: RANK_COL } : {}),
              }}
            >
              {c.key === 'rank' ? (
                <span className={cn('inline-flex items-center gap-1', !qualified && 'text-muted-foreground')}>
                  {!qualified && (
                    <Tip text={`Below the ${minMatches}-match qualification threshold, so this player is shown but is not ranked against it. Their record is unaffected.`}>
                      <span aria-label="Below the qualification threshold" className="text-[var(--gold-dim)]">*</span>
                    </Tip>
                  )}
                  {row.rank}
                </span>
              ) : c.key === 'player' ? (
                /*
                  The NAME is the control that opens a player's history. There is no chevron and no
                  checkbox beside it: a row with three separate affordances made the reader choose
                  which one meant "tell me more", and the obvious thing to click was always the name.
                  The profile link moved into the expanded panel, where it reads as one of several
                  places to go next rather than as a trap on the row itself.
                */
                <button
                  type="button"
                  onClick={() => onToggleExpand(row)}
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? 'Hide' : 'Show'} career detail for ${name}`}
                  className="block w-full min-w-0 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
                >
                  <IdentityCell
                    identity={{ preferredName: row.preferredName, cueverseId: row.cueverseId }}
                    className="min-w-0"
                  />
                </button>
              ) : c.key === 'rating' ? (
                <RatingCell rating={row.rating} highest={highestRating} />
              ) : c.key === 'currentStreak' ? (
                <StreakCell streak={row.currentStreak} />
              ) : c.key === 'seasonTitles' ? (
                <TitleCell n={row.seasonTitles} kind="season" onOpen={open} playerName={name} />
              ) : c.key === 'tournamentTitles' ? (
                <TitleCell n={row.tournamentTitles} kind="cup" onOpen={open} playerName={name} />
              ) : c.key === 'finalsAppearances' ? (
                <EvidenceCell n={row.finalsAppearances} onOpen={open} label={`${name}: ${row.finalsAppearances} finals reached`} />
              ) : (
                (c.format ?? ((r) => String(COLUMN_BY_KEY[c.key]?.value(r) ?? '—')))(row)
              )}
            </td>
          )
        })}
      </tr>

      {isOpen && (
        <tr>
          <td colSpan={columns.length} className="border-b border-border bg-card/60 px-4 py-4">
            <ExpandedRow row={row} detail={details[row.playerId]} />
          </td>
        </tr>
      )}
    </Fragment>
  )
}
