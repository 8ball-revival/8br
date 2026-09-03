'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

/**
 * The profile's motion primitives, and the rules that keep them cheap.
 *
 * ── Why these live in one file ──────────────────────────────────────────────────────────────────
 * Every animated thing on the profile needs the same three answers: has the visitor asked for less
 * motion, is this actually on screen, and is the tab even visible. Answered separately they drift —
 * one effect keeps running behind a hidden tab, another ignores the motion preference — so they are
 * answered once here and the rest of the profile asks this module.
 *
 * ── The performance rules, stated plainly ───────────────────────────────────────────────────────
 * · No React state is set from a pointer move. Cursor-following light is written straight to CSS
 *   custom properties inside one `requestAnimationFrame`, so a mouse crossing a panel costs one
 *   style write per frame and zero renders.
 * · Continuous animation is CSS, driven by a class. Turning it off removes the class; nothing polls.
 * · Everything registers exactly one listener and removes it in the same effect's cleanup, so
 *   repeated tab changes and expansions cannot stack handlers.
 * · Movement is `transform` and `opacity` only. Nothing animates a layout property in a loop.
 */

// ── Preferences and visibility ──────────────────────────────────────────────────────────────────

const MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const subscribeMotion = (onChange: () => void) => {
  const mq = window.matchMedia(MOTION_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

/**
 * Whether the visitor has asked for reduced motion.
 *
 * `useSyncExternalStore` rather than an effect writing state: a media query is an external source
 * that changes on its own, the server snapshot is honestly `false`, and there is no second render
 * on mount.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia(MOTION_QUERY).matches,
    () => false,
  )
}

const subscribeVisibility = (onChange: () => void) => {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

/** Whether the tab is in front. Decorative animation stops when it is not. */
export function useDocumentVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState !== 'hidden',
    () => true,
  )
}

/**
 * Whether an element is on screen.
 *
 * One observer per element, disconnected on cleanup. Used to stop the rail animation for a profile
 * that has been scrolled past — the cheapest animation is the one that is not running.
 */
export function useOnScreen<T extends HTMLElement>(ref: React.RefObject<T | null>, rootMargin = '120px'): boolean {
  const [onScreen, setOnScreen] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      ([entry]) => setOnScreen(entry.isIntersecting),
      { rootMargin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [ref, rootMargin])
  return onScreen
}

/**
 * Should decorative motion run at all?
 *
 * The single answer the frame and the avatar ring both use: not while reduced motion is asked for,
 * not while the tab is hidden, not while the profile is off screen.
 */
export function useDecorativeMotion<T extends HTMLElement>(ref: React.RefObject<T | null>): boolean {
  const reduced = usePrefersReducedMotion()
  const visible = useDocumentVisible()
  const onScreen = useOnScreen(ref)
  return !reduced && visible && onScreen
}

// ── Cursor-following light ──────────────────────────────────────────────────────────────────────

/**
 * A spotlight that follows the pointer inside a section, without a single React render.
 *
 * The handler records the last position and asks for one frame; the frame writes two custom
 * properties on the element and stops. So a pointer crossing a panel produces at most one style
 * write per displayed frame, and moving the mouse quickly produces no more work than moving it
 * slowly.
 *
 * Attached to the profile root rather than to every panel: one listener for the whole page instead
 * of one per section, with the panel found from `event.target`. That is what keeps the count from
 * growing as sections are added or as windows expand and collapse.
 *
 * Touch devices never get it. `pointerdown` from a finger would leave a spotlight stuck where it was
 * last tapped, and the brief asks for pointer effects to be off there anyway.
 *
 * ── The `selector` argument ─────────────────────────────────────────────────────────────────────
 * `.pf-panel` by default, which is every caller on the profile. The homepage's Season Progress tile
 * wants the same light but is not a profile panel and must not inherit profile styling, so it
 * passes its own class instead. A parameter rather than a second copy of this hook: the listener
 * bookkeeping — one handler, one frame in flight, cleanup that cannot leak — is the part worth
 * having once, and it is exactly the part a copy would eventually get wrong.
 */
export function usePointerSpotlight<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  enabled: boolean,
  selector = '.pf-panel',
): void {
  useEffect(() => {
    const root = ref.current
    if (!root || !enabled) return
    // A coarse pointer is a finger. Hover light means nothing there and would only stick.
    if (window.matchMedia('(hover: none)').matches) return

    let frame = 0
    let pending: { el: HTMLElement; x: number; y: number } | null = null

    const paint = () => {
      frame = 0
      if (!pending) return
      const { el, x, y } = pending
      pending = null
      el.style.setProperty('--pf-mx', `${x}px`)
      el.style.setProperty('--pf-my', `${y}px`)
    }

    const onMove = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null
      const panel = target?.closest<HTMLElement>(selector)
      if (!panel) return
      const rect = panel.getBoundingClientRect()
      pending = { el: panel, x: e.clientX - rect.left, y: e.clientY - rect.top }
      // One frame in flight at a time. Without this a fast pointer queues dozens of callbacks.
      if (!frame) frame = requestAnimationFrame(paint)
    }

    root.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      root.removeEventListener('pointermove', onMove)
      if (frame) cancelAnimationFrame(frame)
      pending = null
    }
  }, [ref, enabled, selector])
}

/**
 * A very small lean toward the pointer, for the identity header.
 *
 * Writes two unit-range custom properties on the element; the stylesheet decides what to do with
 * them (currently a three-pixel nudge of the avatar). Same discipline as the spotlight: one
 * listener, one frame in flight, no React state, and nothing at all on a touch device.
 */
export function usePointerTilt<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  enabled: boolean,
): void {
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    if (window.matchMedia('(hover: none)').matches) return

    let frame = 0
    let next: { x: number; y: number } | null = null

    const paint = () => {
      frame = 0
      if (!next) return
      el.style.setProperty('--pf-tiltx', String(next.x))
      el.style.setProperty('--pf-tilty', String(next.y))
      next = null
    }
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      // -1 .. 1 from the centre, so the stylesheet can scale it however it likes.
      next = {
        x: ((e.clientX - r.left) / r.width) * 2 - 1,
        y: ((e.clientY - r.top) / r.height) * 2 - 1,
      }
      if (!frame) frame = requestAnimationFrame(paint)
    }
    const onLeave = () => {
      next = null
      el.style.setProperty('--pf-tiltx', '0')
      el.style.setProperty('--pf-tilty', '0')
    }

    el.addEventListener('pointermove', onMove, { passive: true })
    el.addEventListener('pointerleave', onLeave)
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      if (frame) cancelAnimationFrame(frame)
      next = null
    }
  }, [ref, enabled])
}

// ── Count-up ────────────────────────────────────────────────────────────────────────────────────

/**
 * A number that counts up to its value, once.
 *
 * ── The accessibility rule this obeys ───────────────────────────────────────────────────────────
 * The DOM always contains the true value. The animation is written to a SEPARATE, `aria-hidden`
 * span, and the real figure sits beside it in a visually-hidden one. A screen reader, a search
 * engine and "view source" all see 1866 from the first paint, whatever the animation is doing.
 *
 * ── Why it never restarts ───────────────────────────────────────────────────────────────────────
 * It runs on mount and marks itself done. Changing tabs, opening a window or any other state update
 * re-renders this component, and a count-up that replayed on every render would be a flicker rather
 * than a flourish. `done` is a ref, so re-running is impossible rather than merely unlikely.
 */
export function CountUp({
  value, duration = 900, className, prefix = '', format,
}: {
  value: number
  duration?: number
  className?: string
  prefix?: string
  /** Rendered form of the true value, when it is not simply the number. */
  format?: (n: number) => string
}) {
  const reduced = usePrefersReducedMotion()
  const spanRef = useRef<HTMLSpanElement>(null)
  const done = useRef(false)
  const render = useCallback((n: number) => (format ? format(n) : String(n)), [format])

  useEffect(() => {
    if (reduced || done.current) return
    const el = spanRef.current
    if (!el) return
    done.current = true

    const from = 0
    const start = performance.now()
    let frame = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      // Ease-out: fast to begin, settling onto the real figure rather than stopping dead.
      const eased = 1 - (1 - t) ** 3
      el.textContent = prefix + render(Math.round(from + (value - from) * eased))
      if (t < 1) frame = requestAnimationFrame(step)
      else { el.textContent = prefix + render(value); frame = 0 }
    }
    frame = requestAnimationFrame(step)
    return () => { if (frame) cancelAnimationFrame(frame) }
  }, [value, duration, prefix, reduced, render])

  const text = prefix + render(value)
  return (
    <span className={className}>
      {/* The truth, for assistive technology and for indexing. Always the final value. */}
      <span className="sr-only">{text}</span>
      {/*
        The animated copy. Starts at the real value so that a reader with reduced motion, or one
        whose JavaScript has not run, sees the right number rather than a zero.
      */}
      <span ref={spanRef} aria-hidden>{text}</span>
    </span>
  )
}

// ── Entrance ────────────────────────────────────────────────────────────────────────────────────

/**
 * Reveal the profile once, on mount.
 *
 * Returns a class the root carries while the entrance plays. The stagger itself is CSS — each
 * section declares its own delay — so this is one class toggle rather than a timer per section.
 */
export function useEntrance(): string {
  const reduced = usePrefersReducedMotion()
  const [released, setReleased] = useState(false)

  useEffect(() => {
    // Nothing to release under reduced motion: the class is derived below instead.
    if (reduced) return
    // One frame, so the initial (hidden) state is painted before the transition to visible begins.
    const raf = requestAnimationFrame(() => setReleased(true))
    return () => cancelAnimationFrame(raf)
  }, [reduced])

  /*
    Derived rather than set from the effect.

    Under reduced motion the profile is simply already in place, which is a property of the
    preference — not a state change to schedule. Writing it with `setState` in the effect body cost
    a second render on every mount and is the pattern React now warns about.
  */
  return reduced || released ? 'pf-entered' : ''
}
