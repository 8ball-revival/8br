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
  /**
   * Tailwind column span within the twelve-column Overview grid.
   *
   * The reference gives each row a deliberate weighting — Career wider than Seasons and
   * Tournaments, CueVerse wider than Achievements — so the span belongs to the card rather than to
   * a rule about position that would break the moment a card was reordered.
   */
  span?: string
}

const MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const DURATION = 260

export function ExpandingCards({ cards, before, className }: {
  cards: ExpandingCard[]
  /**
   * Static content above the cards — the rows that have no window of their own.
   *
   * It lives inside this component rather than beside it so that an expanded window covers the
   * WHOLE Overview area, which is what makes the window feel like the profile opening up rather
   * than a panel appearing in its lower half.
   */
  before?: React.ReactNode
  className?: string
}) {
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
      /*
        The container holds the window's height, and the window fills the container.

        Two things have to be true at once: the page must not jump as the cards are replaced, and the
        window must be tall enough to read. So the container takes whichever is larger — the height
        the cards already occupied, or a comfortable reading height — and the frame grows with it
        rather than the window spilling out of the bottom of the table.
      */
      const cardsHeight = parent.getBoundingClientRect().height
      const comfortable = Math.min(window.innerHeight * 0.7, 704)
      setMinHeight(Math.round(Math.max(cardsHeight, comfortable)))
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
          'transition-opacity duration-200',
          openKey ? 'pointer-events-none opacity-0' : 'opacity-100',
        )}
        {...(openKey ? { inert: '' as unknown as boolean } : {})}
        aria-hidden={openKey ? true : undefined}
      >
        {before}
        {/*
          Twelve columns, so each row can be weighted the way the reference weights it while every
          rectangle still shares one gap and one alignment. Below `md` it is a single column: the
          weighting is a desktop idea, and three narrow boxes side by side is not a hierarchy.
        */}
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-12">
          {cards.map((card) => (
            <div
              key={card.key}
              ref={(el) => { cardRefs.current.set(card.key, el) }}
              className={cn('pf-panel flex flex-col', card.span ?? 'md:col-span-4')}
            >
              <header className="mb-2 flex items-center justify-between gap-2">
                <h3 className="pf-heading">{card.title}</h3>
                {!card.disabled && (
                  <button
                    type="button"
                    ref={(el) => { triggerRefs.current.set(card.key, el) }}
                    onClick={() => open(card.key)}
                    aria-expanded={openKey === card.key}
                    aria-controls={`${baseId}-window`}
                    className="pf-action inline-flex items-center gap-1 transition-colors"
                  >
                    {card.actionLabel ?? 'View All'}
                    <span aria-hidden>→</span>
                  </button>
                )}
              </header>
              <div className="flex-1">{card.preview}</div>
            </div>
          ))}
        </div>
      </div>

      {active && (
        <div
          ref={panelRef}
          id={`${baseId}-window`}
          role="region"
          aria-label={active.title}
          className="pf-panel pf-window z-30 flex flex-col overflow-hidden p-0"
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3 pf-rule" style={{ borderBottomWidth: 1 }}>
            <h3 ref={headingRef} tabIndex={-1} className="pf-heading outline-none">
              {active.title}
            </h3>
            <button type="button" onClick={close} className="pf-btn inline-flex items-center gap-1.5 px-2.5 py-1.5">
              <X className="size-3.5" aria-hidden />
              Close
            </button>
          </header>
          {/*
            The window scrolls inside itself; the page behind it does not move, which is what keeps
            the profile from ending up with a scrollbar inside a scrollbar.
          */}
          <div className="pf-scroll min-h-0 flex-1 overflow-auto">{active.window}</div>
        </div>
      )}
    </div>
  )
}
