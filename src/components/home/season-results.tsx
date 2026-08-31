import Link from 'next/link'

import { SnapScroller } from './snap-scroller'

import type { SeasonResultRow } from '@/lib/home/season-results'
import { identityLines } from '@/lib/identity/display'
import { PanelLink } from './competition-history'

/**
 * Season Results: every completed Season, oldest first.
 *
 * ── The whole archive, in a fixed frame ──────────────────────────────────────────────────────────
 * This lists all forty-eight completed Seasons rather than the five most recent, and scrolls inside
 * a frame the same height as the Top 10 beside it. That combination is the point: the panel keeps
 * the row's height without truncating the archive, so the homepage stays a dashboard while still
 * offering the whole record.
 *
 * Ordered oldest to newest, which is how an archive reads — you start at the beginning.
 *
 * ── The row is the link ──────────────────────────────────────────────────────────────────────────
 * Every cell is inside one anchor per row, so the target is the full width of the row rather than a
 * word in the last column. `display: contents` on the anchor lets it wrap the cells without breaking
 * the table's own layout, which is what makes the columns still line up.
 *
 * ── A forfeited final shows no score ─────────────────────────────────────────────────────────────
 * The service suppresses the stored value for a forfeited final and sets a flag instead. Printing
 * "9-0" for a match nobody played would be inventing the most consequential result in a Season.
 */
export interface SeasonResultsProps {
  rows: SeasonResultRow[]
  /**
   * Where a row goes. Defaults to the Season's own page.
   *
   * The archive overrides it: there, a row opens the Season INSIDE /yahoo rather than navigating to
   * a standalone route, so the summary and the ladder stay on screen. The panel does not need to
   * know that — it only needs to know that the destination is not always the same.
   */
  hrefFor?: (row: SeasonResultRow) => string
  /** Marked as the current row, for the archive's selected season. */
  selectedId?: number | null
  /** Overrides the "View all results" destination. */
  allHref?: string
  /**
   * Overrides the height of the scrolling frame.
   *
   * The homepage pins it to a fixed height so the panel matches the Top 10 beside it. The archive
   * passes a growing one instead, because there the frame's job is to reach the bottom of the page
   * alongside the ladder. Either way only the ROWS scroll — the panel heading and the table header
   * are outside this box.
   */
  frameClassName?: string
  /**
   * Classes on the panel itself.
   *
   * The homepage stretches it to match the Top 10 beside it (`h-full`). The archive does the
   * opposite: there the panel is sized by its rows and pinned to the top of its column, because the
   * ladder next to it grows with the window and a season list stretched to keep up would be mostly
   * empty background.
   */
  panelClassName?: string
  /**
   * End the frame on a row boundary rather than at an arbitrary pixel.
   *
   * Off by default so the homepage keeps the fixed frame that lines it up with its neighbour.
   */
  snap?: boolean
}

export function SeasonResults({
  rows,
  hrefFor = (r) => r.href,
  selectedId = null,
  allHref = '/seasons',
  frameClassName = 'max-h-[22rem]',
  panelClassName = 'h-full',
  snap = false,
}: SeasonResultsProps) {
  const Frame = snap ? SnapScroller : 'div'
  return (
    <section
      aria-labelledby="season-results-heading"
      className={`cyber-clip flex flex-col border border-[var(--line-strong)] bg-[var(--graphite)] ${panelClassName}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
        <h2 id="season-results-heading" className="flex items-center gap-2">
          <span className="font-display text-sm font-bold uppercase tracking-[0.14em] text-[var(--hot-red)]">
            Season Results
          </span>
          <span aria-hidden className="text-[var(--hot-red)]/50">{'//'}</span>
        </h2>
        <PanelLink href={allHref}>View all results</PanelLink>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          No Season has been completed yet. Champions appear here as they are decided.
        </p>
      ) : (
        /*
         * Scrolls in BOTH directions inside its own frame.
         *
         * Vertically because it holds the whole archive; horizontally because the five columns are
         * wider than a phone. The container is focusable and labelled, so somebody without a pointer
         * can reach and scroll it — a bare overflow container is unreachable by keyboard.
         *
         * The max height is what matches this panel to the Top 10 beside it.
         */
        <Frame
          role="region"
          aria-label="Season championship results, scrollable"
          tabIndex={0}
          className={`scrollbar-themed ${frameClassName} w-full overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]`}
        >
          <table className="w-full min-w-[34rem] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-[var(--graphite)] text-[0.66rem] uppercase tracking-[0.12em] text-muted-foreground">
              <tr className="border-b border-[var(--line-strong)]">
                <th scope="col" className="bg-[var(--graphite)] px-4 py-2 text-left font-bold">Season</th>
                <th scope="col" className="bg-[var(--graphite)] px-2 py-2 text-left font-bold">Winner</th>
                <th scope="col" className="bg-[var(--graphite)] px-2 py-2 text-left font-bold">Runner up</th>
                <th scope="col" className="bg-[var(--graphite)] px-2 py-2 text-right font-bold">Score</th>
                <th scope="col" className="bg-[var(--graphite)] px-4 py-2 text-left font-bold">Event</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const href = hrefFor(r)
                const selected = selectedId === r.seasonId
                /*
                 * The whole row is the target, and there is still only one tab stop.
                 *
                 * Every cell holds the same link so a click lands wherever the pointer is, but only
                 * the first is reachable by keyboard and only the first has an accessible name; the
                 * rest are hidden from assistive technology and skipped by Tab. Five announced links
                 * to one destination is worse than one, and a row you can only click on the word in
                 * the first column is the thing this replaces.
                 */
                return (
                  <tr
                    key={r.seasonId}
                    aria-current={selected ? 'true' : undefined}
                    className={
                      'border-b border-[var(--line)] transition-colors last:border-b-0 hover:bg-[var(--accent)] focus-within:bg-[var(--accent)]'
                      + (selected ? ' bg-[var(--selected-surface)]' : '')
                    }
                  >
                    <th scope="row" className="whitespace-nowrap p-0 text-left font-semibold text-foreground">
                      <Link
                        href={href}
                        className="block px-4 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]"
                        aria-label={`${r.label}, ${r.event}. Won by ${r.winnerHandle ?? r.winnerName ?? 'an unrecorded champion'}. Open this Season.`}
                      >
                        <span
                          aria-hidden
                          className={
                            'mr-2 inline-block size-1.5 rounded-full align-middle '
                            + (selected ? 'bg-[var(--gold)]' : 'bg-[var(--hot-red)]')
                          }
                        />
                        {r.label}
                      </Link>
                    </th>
                    <RowCell href={href} className="px-2 py-2.5">
                      <Identity handle={r.winnerHandle} name={r.winnerName} tone="gold" />
                    </RowCell>
                    <RowCell href={href} className="px-2 py-2.5">
                      <Identity handle={r.runnerUpHandle} name={r.runnerUpName} tone="muted" />
                    </RowCell>
                    <RowCell href={href} className="tabular whitespace-nowrap px-2 py-2.5 text-right font-bold text-foreground">
                      {r.finalsForfeit ? (
                        <span className="text-[var(--hot-red)]" title="Won by forfeit — no score was played">
                          FF
                        </span>
                      ) : (
                        r.finalScore ?? <span className="text-muted-foreground">—</span>
                      )}
                    </RowCell>
                    <RowCell href={href} className="whitespace-nowrap px-4 py-2.5 text-[var(--cyan)]">
                      {r.event}
                    </RowCell>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Frame>
      )}
    </section>
  )
}

/**
 * A cell that is part of the row's click target but not part of its keyboard path.
 *
 * `tabIndex={-1}` and `aria-hidden` together mean: clickable, invisible to Tab, and silent to a
 * screen reader — because the row has already been announced once by the header cell.
 */
function RowCell({ href, className, children }: { href: string; className: string; children: React.ReactNode }) {
  return (
    <td className="p-0">
      <Link href={href} tabIndex={-1} aria-hidden className={`block ${className}`}>
        {children}
      </Link>
    </td>
  )
}

/** The handle leads, the preferred name follows — the site-wide rule, in a tight cell. */
function Identity({ handle, name, tone }: { handle: string | null; name: string | null; tone: 'gold' | 'muted' }) {
  const { primary, secondary } = identityLines({ cueverseId: handle, preferredName: name })
  return (
    <span className="block min-w-0">
      <span
        className={
          tone === 'gold'
            ? 'block truncate font-semibold text-[var(--gold)]'
            : 'block truncate font-medium text-foreground'
        }
      >
        {primary}
      </span>
      {secondary && <span className="block truncate text-[0.7rem] text-muted-foreground">{secondary}</span>}
    </span>
  )
}
