'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * One expansion system, used by every Overview card that has a "View All".
 *
 * ── Why one system and not four modals ──────────────────────────────────────────────────────────
 * Seasons, Tournaments, Achievements and CueVerse all do the same thing: a summary card that opens
 * into a large reading window. Written separately they drift — one traps focus and another does
 * not, one closes on Escape and another only on the button, one animates and one appears. Written
 * once, every window behaves identically and a fix reaches all of them.
 *
 * ── Why it is not a dialog ──────────────────────────────────────────────────────────────────────
 * The brief is explicit that the navigation and the sidebar stay visible, so this is deliberately
 * NOT `role="dialog"` and deliberately does not trap focus or hide the rest of the page from
 * assistive technology. It is a region that grows inside the profile — the page is still the page,
 * and a reader can still tab to the sidebar or the nav. It gets `role="region"`, an accessible name
 * and initial focus, which is what an expanding region should have.
 *
 * ── The animation is a measurement, not a guess ─────────────────────────────────────────────────
 * The card's position is read before the window renders, and the window is then transformed to sit
 * exactly on top of that card and released. So it genuinely grows out of the card that was clicked
 * and shrinks back into it — a fade would not survive the brief's word "morph".
 *
 * Under `prefers-reduced-motion` there is no transform and no transition at all: the window is
 * simply there. Not a shortened animation — none.
 */

export interface ExpandingCard {
  key: string
  /** Card heading, and the accessible name of the window it opens. */
  title: string
  /** The card face. */
  preview: React.ReactNode
  /** The window body. Rendered only while open, so nothing offscreen is mounted. */
  window: React.ReactNode
  /** Hidden when there is nothing to show, rather than opening onto an empty window. */
  disabled?: boolean
  /** Replaces "View All" when another word fits better. */
  actionLabel?: string
}

const MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const DURATION = 260

export function ExpandingCards({ cards, className }: { cards: ExpandingCard[]; className?: string }) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  /** 'entering' runs the grow, 'open' is settled, 'leaving' runs the shrink before unmount. */
  const [phase, setPhase] = useState<'closed' | 'entering' | 'open' | 'leaving'>('closed')
  const [minHeight, setMinHeight] = useState<number | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const triggerRefs = useRef(new Map<string, HTMLButtonElement | null>())
  const cardRefs = useRef(new Map<string, HTMLDivElement | null>())
  /** The card's rectangle at the moment it was clicked, in container coordinates. */
  const originRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const baseId = useId()

  const reducedMotion = () =>
    typeof window !== 'undefined' && window.matchMedia(MOTION_QUERY).matches

  /** Put the panel exactly over the card it came from, or release it to its own position. */
  const applyOrigin = useCallback((collapsed: boolean) => {
    const panel = panelRef.current
    const origin = originRef.current
    if (!panel) return
    if (!collapsed || !origin) {
      panel.style.transform = ''
      panel.style.opacity = '1'
      return
    }
    const rect = panel.getBoundingClientRect()
    const parent = containerRef.current?.getBoundingClientRect()
    if (!parent || rect.width === 0 || rect.height === 0) return
    // The panel's own offset inside the container, so the translation is card-minus-panel.
    const panelX = rect.left - parent.left
    const panelY = rect.top - parent.top
    panel.style.transformOrigin = 'top left'
    panel.style.transform =
      `translate(${origin.x - panelX}px, ${origin.y - panelY}px)`
      + ` scale(${origin.w / rect.width}, ${origin.h / rect.height})`
    panel.style.opacity = '0.35'
  }, [])

  const open = useCallback((key: string) => {
    const card = cardRefs.current.get(key)
    const parent = containerRef.current
    if (card && parent) {
      const c = card.getBoundingClientRect()
      const p = parent.getBoundingClientRect()
      originRef.current = { x: c.left - p.left, y: c.top - p.top, w: c.width, h: c.height }
      // Hold the grid's height so the page does not jump as the cards are replaced.
      setMinHeight(parent.getBoundingClientRect().height)
    } else {
      originRef.current = null
    }
    setOpenKey(key)
    setPhase(reducedMotion() ? 'open' : 'entering')
  }, [])

  const close = useCallback(() => {
    if (!openKey) return
    const returnTo = triggerRefs.current.get(openKey)
    if (reducedMotion()) {
      setOpenKey(null)
      setPhase('closed')
      setMinHeight(null)
      returnTo?.focus()
      return
    }
    setPhase('leaving')
    applyOrigin(true)
    window.setTimeout(() => {
      setOpenKey(null)
      setPhase('closed')
      setMinHeight(null)
      // Focus goes back to the control that opened the window, not to the top of the document.
      returnTo?.focus()
    }, DURATION)
  }, [openKey, applyOrigin])

  /*
    Grow: mount at the final position, jump to the card's box without a transition, then release.

    The double frame is load-bearing. Setting the collapsed transform and removing it in the same
    frame is one style computation and the browser animates nothing.
  */
  useEffect(() => {
    if (phase !== 'entering') return
    const panel = panelRef.current
    if (!panel) return
    panel.style.transition = 'none'
    applyOrigin(true)
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        panel.style.transition = `transform ${DURATION}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${DURATION}ms ease`
        applyOrigin(false)
        window.setTimeout(() => setPhase('open'), DURATION)
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [phase, applyOrigin])

  /** Escape closes, from anywhere inside the window. */
  useEffect(() => {
    if (!openKey) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [openKey, close])

  /** Move focus into the window once it exists, so a keyboard reader is taken there. */
  useEffect(() => {
    if (phase === 'entering' || phase === 'open') headingRef.current?.focus()
    // Only on the transition into a window, not on every settle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey])

  const active = cards.find((c) => c.key === openKey) ?? null

  return (
    <div
      ref={containerRef}
      className={cn('relative', className)}
      style={openKey && minHeight ? { minHeight } : undefined}
    >
      {/*
        The cards stay mounted while a window is open — they hold the grid's shape, and the window
        shrinks back into a card that is still in the same place. `inert` keeps them out of the tab
        order and away from a screen reader while they are only scenery.
      */}
      <div
        className={cn(
          'grid gap-4 transition-opacity duration-200 sm:grid-cols-2 xl:grid-cols-3',
          openKey ? 'pointer-events-none opacity-0' : 'opacity-100',
        )}
        {...(openKey ? { inert: '' as unknown as boolean } : {})}
        aria-hidden={openKey ? true : undefined}
      >
        {cards.map((card) => (
          <div
            key={card.key}
            ref={(el) => { cardRefs.current.set(card.key, el) }}
            className="dl-surface flex flex-col border border-border bg-card"
          >
            <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <h3 className="eyebrow text-foreground">{card.title}</h3>
              {!card.disabled && (
                <button
                  type="button"
                  ref={(el) => { triggerRefs.current.set(card.key, el) }}
                  onClick={() => open(card.key)}
                  aria-expanded={openKey === card.key}
                  aria-controls={`${baseId}-window`}
                  className="inline-flex items-center gap-1 text-[0.7rem] font-medium uppercase tracking-wide text-brand transition-colors hover:text-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                >
                  {card.actionLabel ?? 'View All'}
                </button>
              )}
            </header>
            <div className="flex-1 p-4">{card.preview}</div>
          </div>
        ))}
      </div>

      {active && (
        <div
          ref={panelRef}
          id={`${baseId}-window`}
          role="region"
          aria-label={active.title}
          className={cn(
            'dl-surface absolute inset-0 z-30 flex flex-col overflow-hidden border border-[var(--line-strong)] bg-card shadow-2xl',
            // A window is worth reading at length; on a phone it takes the height it needs.
            'min-h-[70vh]',
          )}
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-[var(--surface-plaque,transparent)] px-4 py-3">
            <h3
              ref={headingRef}
              tabIndex={-1}
              className="font-display text-base font-bold text-foreground outline-none sm:text-lg"
            >
              {active.title}
            </h3>
            <button
              type="button"
              onClick={close}
              className="inline-flex items-center gap-1.5 border border-border px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:border-[var(--line-strong)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              <X className="size-3.5" aria-hidden />
              Close
            </button>
          </header>
          {/* The window scrolls inside itself; the page behind it does not move. */}
          <div className="min-h-0 flex-1 overflow-auto">{active.window}</div>
        </div>
      )}
    </div>
  )
}
