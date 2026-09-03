'use client'

import { useRef } from 'react'
import Link from 'next/link'

import type { SeasonProgressView } from '@/lib/home/season-progress'
import { formatPct } from '@/lib/home/season-progress-order'
import { useDecorativeMotion, usePointerSpotlight } from '@/components/players/profile/motion'

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
 * ── Why this is a client component ──────────────────────────────────────────────────────────────
 * Only for the motion. Every figure it renders still arrives as a prop from the server; nothing is
 * fetched, computed or re-derived here. What the client adds is the decorative frame's on/off
 * decision and the pointer-following light, both of which need a browser to answer.
 *
 * ── Colour ──────────────────────────────────────────────────────────────────────────────────────
 * Red marks first place and the live frame; gold marks points. Both are load-bearing in this
 * project's palette — see the note at the top of `globals.css` — so spending either on decoration
 * would cost them their meaning everywhere else on the site.
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
  const panelRef = useRef<HTMLElement>(null)

  /*
    One answer for "should anything be moving", from the profile's own primitive.

    False under `prefers-reduced-motion`, false while the tab is hidden, and false while the tile is
    scrolled off screen — so a homepage left open in a background tab animates nothing. The class it
    drives is the only switch, so turning motion off removes a CSS animation rather than cancelling
    a loop this component would otherwise have to own.
  */
  const animate = useDecorativeMotion(panelRef)
  /*
    The cursor pool, from the same shared hook the profile panels use, aimed at `.sp-panel`.

    One listener on this tile, one requestAnimationFrame in flight at a time, no React state per
    pointer move, and cleanup in the same effect. Passing `animate` means it is never even attached
    when motion is off, so there is nothing to accumulate across visibility changes.
  */
  usePointerSpotlight(panelRef, animate, '.sp-panel')

  if (!view) {
    return (
      <section
        ref={panelRef}
        aria-label={heading}
        className="sp-panel flex h-full flex-col bg-[var(--surface)]"
      >
        <Frame animate={animate} />
        <Header heading={heading} />
        <p className="px-4 py-6 text-sm text-muted-foreground">{emptyText}</p>
      </section>
    )
  }

  const { rows, stats } = view

  return (
    <section
      ref={panelRef}
      aria-label={`${heading}: ${view.label}`}
      className="sp-panel flex h-full min-h-[34rem] flex-col bg-[var(--surface)]"
    >
      <Frame animate={animate} />

      <Header
        heading={heading}
        /*
          The stat strip goes on the TITLE's line, which is the part of the header that was actually
          empty. Beside the season name instead, it had nowhere to go on a 430px tile and wrapped
          underneath — pushing the table down and costing a row.

          `items-start` rather than baseline: the labels are tiny and the title is not, and aligning
          their baselines dropped the strip below the rule.
        */
        aside={(
          <dl className="flex shrink-0 items-start gap-x-2 2xl:gap-x-3.5">
            <Stat label="Groups" value={String(stats.groups)} />
            <Stat label="Players" value={String(stats.players)} />
            <Stat
              label="Matches"
              value={`${stats.matchesPlayed}/${stats.matchesTotal}`}
              /* Said in full for a screen reader: "18/70" is a fraction only to the eye. */
              srValue={`${stats.matchesPlayed} of ${stats.matchesTotal} played`}
            />
          </dl>
        )}
      >
        <p className="mt-1.5 font-condensed text-[0.78rem] font-semibold uppercase tracking-[0.14em] text-foreground">
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
          {/*
            `pr-3` is the gutter between the last column and the scrollbar.

            Twelve pixels, on the SCROLL CONTAINER rather than on the table, so the sticky header
            row and the values beneath it move together and stay aligned. Without it the points sat
            hard against the scrollbar and read as though they were underneath it.
          */}
          <div
            tabIndex={0}
            role="region"
            aria-label={`${view.label} standings, scrollable`}
            className="scrollbar-crimson absolute inset-0 overflow-y-auto overflow-x-hidden pr-3 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--signal)]"
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
                  /*
                    First place is a POSITION, not a person.

                    `i === 0` after the comparator has run, so the treatment follows whoever is
                    currently top and moves the moment a result changes the order. Nothing here
                    knows a name or a CueVerse ID.

                    `r.played > 0` because a table where nobody has played has no leader: the top
                    row is then simply the best ladder rank, and crowning it would be a claim about
                    a season that has not started.
                  */
                  const leader = i === 0 && r.played > 0
                  return (
                    <tr
                      key={r.entrantId}
                      className={[
                        'sp-row border-b border-border/40 last:border-0',
                        // Banding is a wash, not a stripe. First place shares it like any other row.
                        i % 2 === 1 ? 'bg-white/[0.015]' : '',
                        leader ? 'sp-row-leader' : '',
                      ].join(' ')}
                    >
                      <Td className={`sp-pos text-left tabular ${leader ? 'font-bold' : 'text-[var(--text-muted)]'}`}>
                        {i + 1}
                      </Td>
                      <td className={`max-w-0 truncate px-1.5 py-[0.65rem] ${leader ? 'font-bold' : 'font-semibold'}`}>
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
                            className={leader ? 'sp-id hover:underline' : 'text-foreground hover:text-[var(--signal)] hover:underline'}
                          >
                            {r.handle}
                          </Link>
                        ) : (
                          <span title={r.handle} className={leader ? 'sp-id' : 'text-foreground'}>
                            {r.handle}
                          </span>
                        )}
                      </td>
                      <Td className={`text-right tabular ${leader ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {r.wins}–{r.losses}–{r.draws}
                      </Td>
                      <Td className={`text-right tabular ${leader ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {r.gamesWon}–{r.gamesLost}
                      </Td>
                      <Td className={`text-right tabular ${leader ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {formatPct(r.gameWinPct)}
                      </Td>
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

/**
 * The decorative frame: a travelling light, the bloom that rides with it, and the cursor pool.
 *
 * `aria-hidden` on all three, and `pointer-events: none` in the stylesheet — this says nothing a
 * reader needs and must never intercept a click meant for the table. The `-live` classes are the
 * only switch: with them the CSS animation runs, without them the same gradient sits still, which
 * is what keeps the frame looking finished under reduced motion rather than merely undecorated.
 */
function Frame({ animate }: { animate: boolean }) {
  return (
    <>
      <span aria-hidden className={`sp-glow ${animate ? 'sp-glow-live' : ''}`} />
      <span aria-hidden className={`sp-frame ${animate ? 'sp-frame-live' : ''}`} />
      <span aria-hidden className="sp-spot" />
    </>
  )
}

/**
 * One header figure: a small label above a brighter value.
 *
 * Centred rather than left-aligned. The labels are wider than most of the values, so left alignment
 * parked a lone "0" against the left edge of QUALIFIED where it read as part of the "18/70" beside
 * it. Centring gives each pair its own visual column without needing a divider between them.
 */
function Stat({ label, value, srValue }: { label: string; value: string; srValue?: string }) {
  return (
    <div className="min-w-0 text-center">
      {/*
        Tight tracking and a small size, because four labels plus the title have to share one line.

        At 0.16em and 0.58rem the strip was 210px wide, which fits beside the title on a 1440 screen
        and wraps below it on a 1280 one — the panel is only 384px there. Tightening the label is
        what buys the line back without shrinking the VALUES, which are the part meant to read.
      */}
      <dt className="font-condensed text-[0.55rem] font-bold uppercase leading-none tracking-[0.1em] text-[var(--text-muted)]">
        {label}
      </dt>
      <dd className="sp-stat-value tabular mt-1 text-[0.82rem] font-bold leading-none">
        {srValue ? (
          <>
            <span className="sr-only">{srValue}</span>
            <span aria-hidden>{value}</span>
          </>
        ) : value}
      </dd>
    </div>
  )
}

/**
 * The panel head: a title, an optional strip of figures opposite it, and the season lines beneath.
 *
 * `flex-wrap` on the title row is the whole of the narrow-layout behaviour. While both fit they sit
 * on one line with the figures pushed right; when they stop fitting the strip wraps to its own line
 * and stays left-aligned under the title. Nothing is hidden and nothing is compressed, which is what
 * keeps a 390px phone from crushing four labels into two characters each.
 */
function Header({ heading, aside, children }: {
  heading: string
  aside?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="border-b border-border px-4 pb-2.5 pt-3">
      {/*
        `gap-x-2` rather than `gap-x-4`: at 1280 the title and the strip together came to 352px in a
        345px row and wrapped, seven pixels short. Eight pixels of gap plus the tighter label
        tracking buys the line back with room to spare, and at 1536 and up the `2xl` gap restores the more
        generous spacing the width can afford.
      */}
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-2 2xl:gap-x-4">
        <h2 className="font-display text-sm font-black uppercase leading-none tracking-[0.12em] text-foreground">
          {heading}
        </h2>
        {aside}
      </div>
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
