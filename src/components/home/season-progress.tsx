import Link from 'next/link'

import type { SeasonProgressView } from '@/lib/home/season-progress'
import { formatPct } from '@/lib/home/season-progress-order'

/**
 * Season Progress — a live cross-group standings table, in the register of a sports results panel.
 *
 * ── Why it is one tile and not a card per row ────────────────────────────────────────────────────
 * Thirty-two rows is a table. Cards would give each row a border, a background and its own padding,
 * which triples the height of the same information and makes comparing two rows — the only thing
 * anybody does with a standings table — into a scrolling exercise. So: one outer border, one
 * continuous surface, hairline separators, and the density a results page actually has.
 *
 * ── The internal scroll ─────────────────────────────────────────────────────────────────────────
 * About fifteen rows are visible and the rest scroll inside the tile, because the alternative is a
 * homepage panel two thousand pixels tall that pushes the footer off the end of the page. The header
 * row is sticky so the columns stay named at row thirty, and the scroll container is a plain
 * overflow region with `tabIndex` — which is what makes the wheel, the trackpad, touch, and the
 * arrow keys and Page Up/Down all work without a line of JavaScript.
 *
 * ── Colour ──────────────────────────────────────────────────────────────────────────────────────
 * Red marks first place and nothing else, gold marks points and nothing else. Both are load-bearing
 * in this project's palette — see the note at the top of `globals.css` — so spending either on
 * decoration would cost them their meaning everywhere else on the site.
 */
export function SeasonProgress({
  view,
  heading,
  emptyText,
  viewAllLabel,
}: {
  view: SeasonProgressView | null
  heading: string
  emptyText: string
  viewAllLabel: string
}) {
  if (!view) {
    return (
      <section aria-label={heading} className="flex h-full flex-col border border-border bg-[var(--surface)]">
        <Header heading={heading} />
        <p className="px-4 py-6 text-sm text-muted-foreground">{emptyText}</p>
      </section>
    )
  }

  const { rows } = view

  return (
    <section
      aria-label={`${heading}: ${view.label}`}
      /*
        `min-h-[34rem]` is the floor the absolute table needs.

        Taking the table out of the flow means the tile has almost no intrinsic height of its own —
        which is the point beside a tall neighbour, and a collapse to a header and a link anywhere
        else. This floor is what the panel falls back to once the section stacks, below 1024px,
        where there is no tall neighbour left to measure against. At 26rem that came out at seven
        rows, which is too little of a 32-player table to be worth scrolling; 34rem shows about
        eleven, and the tile is full width by then so each row is easy to read.
      */
      className="flex h-full min-h-[34rem] flex-col border border-border bg-[var(--surface)]"
    >
      <Header heading={heading}>
        <p className="mt-1 font-condensed text-[0.78rem] font-semibold uppercase tracking-[0.14em] text-foreground">
          {view.label}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-condensed text-[0.66rem] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          <span className="text-[var(--signal)]">{view.phase}</span>
          <Dot />
          <span>{view.entrants} {view.entrants === 1 ? 'player' : 'players'}</span>
          {view.live && (
            <>
              <Dot />
              {/*
                A dot AND the word, matching the registry status line: colour alone would make the
                state invisible to anybody who cannot distinguish it, and a live indicator has to
                survive being seen in greyscale.
              */}
              <span className="inline-flex items-center gap-1.5 text-[var(--signal)]">
                <span aria-hidden className="size-1.5 rounded-full bg-[var(--signal)]" />
                Live
              </span>
            </>
          )}
        </p>
      </Header>

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        /*
          -- How fifteen rows is arrived at, and why the table is positioned out of the flow -----

          The neighbouring column -- the marquee above the record feature -- sets this tile's
          height, because the section grid is `items-stretch` and both columns end on the same line.
          So the table takes whatever is left after the header and the footer link, and the row
          padding below is tuned so that leftover lands on about fifteen rows.

          Getting there took two wrong turns, both worth recording because both LOOK right in code:

            - `flex-1 min-h-0` alone. The scroll box shrinks correctly, but the table still
              contributes its full 32-row height to the tile's INTRINSIC size -- and in a stretch
              grid the taller column wins. So the panel grew past the record feature and left a gap
              under it: the tile stopped adapting to the column and started driving it.
            - `flex-1 min-h-0 max-h-[Nrem]`. A cap fixes that only for one N. Too small and the
              table stops early, leaving empty tile beneath the footer link; too large and it is
              back to driving the row height. There is no N that tracks a neighbour's content.

          `absolute inset-0` inside a `relative flex-1` wrapper is what actually answers it: the
          table is out of the flow, so it adds NOTHING to the intrinsic height, and the wrapper
          takes exactly the space the column leaves. The tile can then only ever adapt.
        */
        <div className="relative min-h-0 flex-1">
          <div
            tabIndex={0}
            role="region"
            aria-label={`${view.label} standings, scrollable`}
            className="scrollbar-crimson absolute inset-0 overflow-y-auto overflow-x-hidden outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--signal)]"
          >
          <table className="w-full table-fixed border-collapse text-[0.8rem]">
            <caption className="sr-only">
              {view.label} group-stage standings: position, player, set record, individual games,
              game win percentage and points.
            </caption>
            {/*
              Five fixed columns and one that takes the rest.

              The five are sized to their widest real value -- "0-0-0", "44-16", "47.2%", "100" --
              plus the cell padding, and no more. That matters at the tablet width, where the tile
              is under 300px wide: at the first attempt these were a comfortable 3.6rem each and
              left the player column 39 pixels, which truncated the leader to "Sta...". Every pixel
              taken off a number column is a pixel the handle gets, and the handle is the only cell
              in the row that cannot be inferred from the others.
            */}
            <colgroup>
              <col className="w-[1.9rem]" />
              <col />
              <col className="w-[3.2rem]" />
              <col className="w-[3.2rem]" />
              <col className="w-[3.1rem]" />
              <col className="w-[2.2rem]" />
            </colgroup>
            <thead>
              <tr className="sticky top-0 z-10 bg-[var(--surface)] shadow-[0_1px_0_var(--border)]">
                <Th className="text-left">Pos</Th>
                <Th className="text-left">Player</Th>
                <Th className="text-right">Sets</Th>
                <Th className="text-right">Games</Th>
                <Th className="text-right">Win %</Th>
                <Th className="text-right">Pts</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const leader = i === 0 && r.played > 0
                return (
                  <tr
                    key={r.entrantId}
                    className={[
                      'border-b border-border/40 last:border-0',
                      // Subtle banding: a wash, not a stripe. Anything stronger competes with the leader.
                      i % 2 === 1 ? 'bg-white/[0.015]' : '',
                      leader
                        // Controlled red: a left rule and a tint. Never a red fill behind white text.
                        ? 'bg-[var(--signal)]/[0.07] shadow-[inset_2px_0_0_var(--signal)]'
                        : '',
                    ].join(' ')}
                  >
                    <Td className={`text-left tabular ${leader ? 'font-bold text-[var(--signal)]' : 'text-[var(--text-muted)]'}`}>
                      {i + 1}
                    </Td>
                    <td className="max-w-0 truncate px-1.5 py-[0.65rem] font-semibold">
                      {/*
                        The CueVerse ID, alone. No preferred name beneath it: this is a dense
                        standings table, and a second line per row would halve how much of the
                        season fits on screen to repeat something the ID already identifies.

                        `title` carries the full handle because the cell truncates — a handle is
                        the one thing in this row that must stay recoverable when it does.
                      */}
                      {r.slug ? (
                        <Link
                          href={`/players/${encodeURIComponent(r.slug)}`}
                          title={r.handle}
                          className={leader ? 'text-[var(--signal)] hover:underline' : 'text-foreground hover:text-[var(--signal)] hover:underline'}
                        >
                          {r.handle}
                        </Link>
                      ) : (
                        <span title={r.handle} className={leader ? 'text-[var(--signal)]' : 'text-foreground'}>
                          {r.handle}
                        </span>
                      )}
                    </td>
                    <Td className="text-right tabular text-muted-foreground">
                      {r.wins}–{r.losses}–{r.draws}
                    </Td>
                    <Td className="text-right tabular text-muted-foreground">
                      {r.gamesWon}–{r.gamesLost}
                    </Td>
                    <Td className="text-right tabular text-muted-foreground">{formatPct(r.gameWinPct)}</Td>
                    {/* Gold is this project's championship colour, and points are what decide one. */}
                    <Td className="text-right tabular font-bold text-[var(--gold)]">{r.points}</Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      <Link
        href={view.href}
        className="border-t border-border px-4 py-2.5 text-center font-condensed text-[0.68rem] font-bold uppercase tracking-[0.18em] text-[var(--signal)] transition hover:bg-white/[0.04]"
      >
        {viewAllLabel} <span aria-hidden>→</span>
      </Link>
    </section>
  )
}

function Header({ heading, children }: { heading: string; children?: React.ReactNode }) {
  return (
    <div className="border-b border-border px-4 pb-2.5 pt-3">
      <h2 className="font-display text-sm font-black uppercase tracking-[0.16em] text-foreground">{heading}</h2>
      {children}
    </div>
  )
}

function Dot() {
  return <span aria-hidden className="text-[var(--line-strong)]">·</span>
}

function Th({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className={`px-1.5 pb-1.5 pt-2 font-condensed text-[0.6rem] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)] ${className}`}
    >
      {children}
    </th>
  )
}

/*
  `py-[0.65rem]` is a measured value, not a guess.

  The tile's height is set by the marquee and the record beside it. At this padding a row is about
  40px, which divides that height into the fifteen rows the design asks for. Tightening it to 0.3rem
  fitted seventeen and read as a spreadsheet; loosening it further fits twelve and wastes the column.
*/
function Td({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <td className={`px-1.5 py-[0.65rem] ${className}`}>{children}</td>
}
