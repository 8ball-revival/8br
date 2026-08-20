'use client'

import { useLayoutEffect, useRef } from 'react'
import Link from 'next/link'

/**
 * Text that grows to fill the box it is given.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────────
 * Some frames are a fixed size because something beside them is: the archive card has to match the
 * statistic tiles' height exactly, so it cannot shrink to its content. With one fixed type size that
 * leaves a short line — "In 2005, X beat Y 9–3 in the final." — floating in a mostly empty box, while
 * a long one still has to be clamped. The size should follow the sentence, not the other way round.
 *
 * ── How the size is chosen ───────────────────────────────────────────────────────────────────────
 * By MEASURING, not by guessing from character count. Character count ignores the things that
 * actually decide whether a line fits — the font in use, the box's real width at this breakpoint, and
 * where the words happen to break — so it is wrong exactly when the box is unusual, which is the case
 * this is for. A binary search over half-point steps finds the largest size that still fits both
 * dimensions, in about six measurements.
 *
 * It re-measures whenever the box resizes, so a browser zoom, a font swap or a column change is
 * followed rather than baked in at first paint.
 *
 * ── The bounds are not decoration ────────────────────────────────────────────────────────────────
 * `max` stops two words from being rendered as a headline, and `min` stops a long entry from being
 * shrunk into something unreadable — past that point it is better to clip than to keep going. Callers
 * pick both because only the caller knows what the surrounding text looks like.
 */
export function FitText({
  text,
  href,
  min = 12,
  max = 22,
  className = '',
  linkClassName = '',
}: {
  text: string
  href?: string | null
  /** Smallest size in px. Below this, clip rather than keep shrinking. */
  min?: number
  /** Largest size in px, so a short line does not become a headline. */
  max?: number
  className?: string
  linkClassName?: string
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)

  /*
   * Layout effect, not effect: this runs before the browser paints, so the reader never sees the
   * fallback size correct itself. The size is written straight to the node rather than held in state
   * — it is a measurement of the DOM, and feeding it back through a render would mean measuring,
   * rendering, and measuring again for a value React has no other use for.
   */
  useLayoutEffect(() => {
    const box = boxRef.current
    const node = textRef.current
    if (!box || !node) return

    const fit = () => {
      const available = box.clientHeight
      const width = box.clientWidth
      if (available <= 0 || width <= 0) return

      // Half-point steps, held as integers so the search always terminates.
      let lo = Math.round(min * 2)
      let hi = Math.round(max * 2)
      let best = lo

      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2)
        node.style.fontSize = `${mid / 2}px`
        const fits = node.scrollHeight <= available && node.scrollWidth <= width
        if (fits) {
          best = mid
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }

      node.style.fontSize = `${best / 2}px`
    }

    fit()

    // Follow the box: a resize, a zoom or a late font swap all change what fits.
    const observer = new ResizeObserver(fit)
    observer.observe(box)
    return () => observer.disconnect()
  }, [text, min, max])

  return (
    <div ref={boxRef} data-fit-box className="h-full w-full overflow-hidden">
      <span
        ref={textRef}
        // A starting size for the server-rendered pass, replaced before the first paint after
        // hydration. Sitting near the top of the range suits the short entries, which are most of them.
        style={{ fontSize: `${Math.round(max * 0.8)}px`, lineHeight: 1.35 }}
        className={`block ${className}`}
      >
        {href ? (
          <Link
            href={href}
            className={`hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${linkClassName}`}
          >
            {text}
          </Link>
        ) : text}
      </span>
    </div>
  )
}
