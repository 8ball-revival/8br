'use client'

import { useRef } from 'react'
import { cn } from '@/lib/utils'
import { useDecorativeMotion } from './motion'

/**
 * The six-pocket pool-table frame that surrounds a profile.
 *
 * ── What is media and what is CSS ───────────────────────────────────────────────────────────────
 * The POCKETS are the supplied artwork: a corner and a side pocket, in WebP with a PNG beside them.
 * They carry the moulded shape and the pewter edge, which is the part CSS cannot fake convincingly.
 * The RAILS use the supplied strip across the top and bottom, where it stretches without visible
 * distortion — a rail has no horizontal detail to smear — and a gradient sampled from that same file
 * down the two short sides, because rotating a bitmap for them costs more than it is worth.
 *
 * The media ships NEUTRAL — grey and near-black, no colour of its own — and the theme tints it
 * through an overlay keyed to `--pf-rail-tint`. That is why one set of files serves every player's
 * colours instead of a render per theme.
 *
 * ── Understated, and now more so ────────────────────────────────────────────────────────────────
 * The rails were thinned and darkened and the pockets shrunk: the frame is the room the profile sits
 * in, not the thing being looked at. A cushion line runs just inside it so the data surface reads as
 * the bed of a table rather than a rectangle that happens to sit inside a border. No green felt
 * anywhere — the interior stays the site's own dark surface.
 *
 * ── The travelling line ─────────────────────────────────────────────────────────────────────────
 * One accent-coloured segment runs the inside of the cushion, a circuit every ten seconds. It is a
 * single CSS animation on one element — no JavaScript per frame — and it is removed entirely when
 * the visitor prefers reduced motion, when the tab is in the background, or when the profile has
 * been scrolled off screen. See `useDecorativeMotion`.
 *
 * ── Narrow screens ──────────────────────────────────────────────────────────────────────────────
 * Below `lg` the pockets are dropped and the rail thins to a plain border. A pocket sized for a
 * 1440px table either overlaps the content or has to be squashed at 380px, and the brief is explicit
 * that decoration gives way before the layout does.
 */

export function TableFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const animate = useDecorativeMotion(ref)

  return (
    /*
      The rail thickness lives in the stylesheet (`--pf-rail` on `.pf-table`), not here.

      It was set inline as well, which silently won over the stylesheet and left the frame at the
      first value it was ever given — a good reminder that an inline style is not a default.
    */
    <div ref={ref} className={cn('pf-table relative isolate', className)}>
      {/*
        ── The rails ────────────────────────────────────────────────────────────────────────────
        Four explicit bars rather than one masked ring. A `mask-composite` ring is the tidier trick
        and it painted nothing here; four elements are boringly reliable, and they also let the top
        and bottom carry the supplied rail artwork while the sides use a gradient matched to it —
        rotating a bitmap for the two short rails costs more than it is worth.
      */}
      <div aria-hidden className="pf-rails pointer-events-none absolute inset-0 z-0">
        <span className="pf-rail pf-rail-top" />
        <span className="pf-rail pf-rail-bottom" />
        <span className="pf-rail pf-rail-left" />
        <span className="pf-rail pf-rail-right" />
      </div>

      {/*
        ── The pockets ────────────────────────────────────────────────────────────────────────────
        Four corners and two side pockets, which is six — a pool table's arrangement, with the side
        pockets at the midpoint of the long rails. Each corner is the same file rotated, so the
        moulding runs the right way round without four separate images.
      */}
      <div aria-hidden className="pf-pockets pointer-events-none absolute inset-0 z-10 hidden lg:block">
        <span className="pf-pocket pf-pocket-tl" />
        <span className="pf-pocket pf-pocket-tr" />
        <span className="pf-pocket pf-pocket-bl" />
        <span className="pf-pocket pf-pocket-br" />
        <span className="pf-pocket-side pf-pocket-top" />
        <span className="pf-pocket-side pf-pocket-bottom" />
      </div>

      {/*
        ── Rail sights ────────────────────────────────────────────────────────────────────────────
        The small diamonds a real table has along its rails. Drawn in CSS from the accent so they
        pick up the player's theme, and dropped below `lg` with the rest of the decoration.
      */}
      <div aria-hidden className="pf-sights pointer-events-none absolute inset-0 z-10 hidden lg:block" />

      {/* The playing surface: the profile itself, inset by the rail. */}
      <div className="pf-bed relative z-20">
        {/*
          The cushion, and the line that travels it.

          One element inset just inside the bed's edge. The line is a conic gradient rotating behind
          a border-width mask — a single compositor-friendly animation, rather than anything that
          moves an element along a path frame by frame.
        */}
        <span aria-hidden className={cn('pf-cushion', animate && 'pf-cushion-live')} />
        {children}
      </div>
    </div>
  )
}
