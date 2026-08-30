'use client'

import { useCallback, useEffect, useRef } from 'react'

/**
 * A scrolling frame that ends on a row boundary.
 *
 * ── The problem it solves ────────────────────────────────────────────────────────────────────────
 * A fixed pixel height on a table almost never divides evenly into its rows, so the last visible row
 * is sliced through the middle and a strip of empty panel sits under it. Neither is a rendering
 * fault exactly, but together they make a considered panel look like one that ran out of room.
 *
 * ── Why this cannot be CSS ───────────────────────────────────────────────────────────────────────
 * The rows are not the same height. A season whose champion has both a handle and a preferred name
 * takes two lines; one with only a handle takes one. So the number of rows that fit is not a
 * constant, and no `max-height` expressed in ems can know it. The height is measured instead: as
 * many whole rows as fit, and then the frame stops.
 *
 * ── What it does not do ──────────────────────────────────────────────────────────────────────────
 * It never stretches. If the whole list fits, the frame is exactly the height of the list and the
 * bottom border sits under the last row — there is no filling to match a neighbour. The cap only
 * ever takes height away.
 *
 * Rendered on the server as a plain scrolling box first; the snap is applied after mount, so a
 * reader with no JavaScript still gets a usable, scrollable panel.
 */
export function SnapScroller({
  maxHeightPx = Number.POSITIVE_INFINITY,
  className,
  children,
  ...rest
}: React.ComponentProps<'div'> & {
  /**
   * A ceiling on the frame, if the caller wants one.
   *
   * Unset by default, which leaves the viewport as the only limit: the frame grows until it reaches
   * the bottom of the window and then stops on a row boundary. That is what makes it end on the same
   * line as a neighbouring panel that fills the page, WITHOUT being stretched to get there — the
   * height still comes from whole rows, there is just room for more of them on a taller screen.
   */
  maxHeightPx?: number
}) {
  const ref = useRef<HTMLDivElement>(null)

  const snap = useCallback(() => {
    const box = ref.current
    if (!box) return
    const head = box.querySelector('thead')
    const rows = [...box.querySelectorAll<HTMLElement>('tbody tr')]
    if (!rows.length) { box.style.height = ''; return }

    /*
     * Never past the bottom of the window.
     *
     * Measured from where the frame actually starts rather than from a guess at the header's height,
     * so a wrapped navigation or a taller summary moves the cap with it instead of pushing the panel
     * off the screen.
     */
    const top = box.getBoundingClientRect().top
    const room = Math.max(160, window.innerHeight - top - 24)
    const cap = Math.min(maxHeightPx, room)
    // Everything fits: no cap, no scrollbar, and the border lands under the last row.
    const content = (head ? head.getBoundingClientRect().height : 0)
      + [...box.querySelectorAll<HTMLElement>('tbody tr')].reduce((a, r) => a + r.getBoundingClientRect().height, 0)
    if (content <= cap) { box.style.height = `${Math.ceil(content)}px`; return }

    const headH = head ? head.getBoundingClientRect().height : 0
    let height = headH
    let fitted = 0
    for (const row of rows) {
      const next = height + row.getBoundingClientRect().height
      // The last row must be whole. One that would be sliced is left for the scroll.
      if (next > cap) break
      height = next
      fitted++
    }
    // Room for fewer than one row is a degenerate case; show one and let it scroll.
    if (fitted === 0) height = headH + rows[0].getBoundingClientRect().height
    box.style.height = `${Math.ceil(height)}px`
  }, [maxHeightPx])

  useEffect(() => {
    snap()
    const onResize = () => snap()
    window.addEventListener('resize', onResize)
    // Rows can change height after fonts load or when the data changes, so the frame follows them.
    const ro = new ResizeObserver(() => snap())
    if (ref.current) ro.observe(ref.current)
    const body = ref.current?.querySelector('tbody')
    if (body) ro.observe(body)
    return () => { window.removeEventListener('resize', onResize); ro.disconnect() }
  }, [snap])

  return (
    <div ref={ref} className={className} {...rest}>
      {children}
    </div>
  )
}
