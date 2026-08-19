'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { isMenu, type NavEntry, type NavItem, type NavMenu } from '@/lib/nav'
import { cn } from '@/lib/utils'

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href)
}

/** A menu is highlighted while the reader is on any of its destinations. */
function menuActive(pathname: string, menu: NavMenu) {
  return menu.items.some((i) => isActive(pathname, i.href))
}

/**
 * How long the panel stays open after the pointer leaves.
 *
 * There is a gap between the trigger and the panel, and a diagonal path from one to the other
 * leaves both for a frame or two. Closing instantly makes the menu feel like it is dodging the
 * cursor; this is the shortest delay that stops that without the panel lingering.
 */
const CLOSE_DELAY_MS = 220

/**
 * Primary navigation.
 *
 * Live and Archives are TRIGGERS, not destinations: they open a two-option panel and only the
 * option navigates. That is deliberate — there is no useful "all archives" page mixing a Season
 * with a Tournament, and a trigger that also navigated would send half the readers somewhere they
 * did not choose.
 *
 * Keyboard operation is the same menu everywhere: Enter/Space/ArrowDown opens and focuses the first
 * option, arrows move between options, Escape closes and returns focus to the trigger, and Tab
 * leaves. The pointer and the keyboard drive the same state, so nothing works one way only.
 */
export function MainNav({
  className, entries, extraItems = [],
}: {
  className?: string
  entries: NavEntry[]
  extraItems?: NavItem[]
}) {
  const pathname = usePathname()
  const [openLabel, setOpenLabel] = useState<string | null>(null)

  // One timer for the whole bar: moving from one trigger to another must cancel the first close.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelClose = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
  }, [])
  const scheduleClose = useCallback(() => {
    cancelClose()
    closeTimer.current = setTimeout(() => setOpenLabel(null), CLOSE_DELAY_MS)
  }, [cancelClose])
  useEffect(() => cancelClose, [cancelClose])

  // Outside click closes. Escape is handled on the menu itself so focus can be returned properly.
  const barRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!openLabel) return
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpenLabel(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [openLabel])

  const all: NavEntry[] = [...entries, ...extraItems]

  return (
    <nav ref={barRef} aria-label="Primary" className={cn('items-center gap-1', className)}>
      {all.map((entry) => {
        if (!isMenu(entry)) {
          const active = isActive(pathname, entry.href)
          return (
            <Link
              key={entry.href}
              href={entry.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {entry.label}
              {active && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-brand" aria-hidden />}
            </Link>
          )
        }
        return (
          <NavDropdown
            key={entry.label}
            menu={entry}
            open={openLabel === entry.label}
            active={menuActive(pathname, entry)}
            onOpen={() => { cancelClose(); setOpenLabel(entry.label) }}
            onScheduleClose={scheduleClose}
            onCancelClose={cancelClose}
            onClose={() => setOpenLabel(null)}
          />
        )
      })}
    </nav>
  )
}

function NavDropdown({
  menu, open, active, onOpen, onClose, onScheduleClose, onCancelClose,
}: {
  menu: NavMenu
  open: boolean
  active: boolean
  onOpen: () => void
  onClose: () => void
  onScheduleClose: () => void
  onCancelClose: () => void
}) {
  const panelId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([])

  const focusItem = (index: number) => {
    const items = itemRefs.current.filter(Boolean)
    if (items.length === 0) return
    const i = (index + items.length) % items.length
    items[i]?.focus()
  }

  const closeAndReturnFocus = () => { onClose(); triggerRef.current?.focus() }

  return (
    <div
      className="relative"
      onMouseEnter={onOpen}
      onMouseLeave={onScheduleClose}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? onClose() : onOpen())}
        onFocus={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen()
            // Wait a frame so the panel exists before its first option is focused.
            requestAnimationFrame(() => focusItem(0))
          } else if (e.key === 'Escape') {
            onClose()
          }
        }}
        className={cn(
          'relative flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60',
          active || open ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {menu.live && <LiveDot />}
        {menu.label}
        {active && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-brand" aria-hidden />}
      </button>

      {open && (
        <div
          id={panelId}
          role="menu"
          aria-label={menu.label}
          // The panel sits directly under the trigger with no gap, and keeps the menu open while the
          // pointer is inside it — travelling from the trigger into the panel must not close it.
          onMouseEnter={onCancelClose}
          onMouseLeave={onScheduleClose}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); closeAndReturnFocus(); return }
            const items = itemRefs.current.filter(Boolean)
            const current = items.findIndex((el) => el === document.activeElement)
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); focusItem(current + 1) }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); focusItem(current - 1) }
            if (e.key === 'Home') { e.preventDefault(); focusItem(0) }
            if (e.key === 'End') { e.preventDefault(); focusItem(items.length - 1) }
          }}
          className="absolute left-1/2 top-full z-50 -translate-x-1/2 pt-1"
        >
          <div
            className={cn(
              'flex overflow-hidden rounded-md border border-border bg-card shadow-xl',
              // One option takes the full panel width rather than sitting beside an empty half.
              menu.items.length === 1 ? 'w-44' : 'w-[19rem]',
            )}
          >
            {menu.items.map((item, i) => (
              <Link
                key={item.href}
                ref={(el) => { itemRefs.current[i] = el }}
                role="menuitem"
                href={item.href}
                // Closed by the click that navigates rather than by an effect watching the route:
                // the click is what the reader did, and the panel must not hang over the page they
                // just asked for.
                onClick={onClose}
                className={cn(
                  'flex-1 px-4 py-2.5 text-center text-sm font-medium text-muted-foreground transition-colors',
                  'hover:bg-white/[0.06] hover:text-[var(--gold)]',
                  'focus-visible:bg-white/[0.06] focus-visible:text-[var(--gold)] focus-visible:outline-none',
                  i > 0 && 'border-l border-border',
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The live indicator.
 *
 * A small gold dot with a slow pulse — restrained enough to sit in a black-and-gold header without
 * shouting. The pulse is a `motion-safe` variant, so a reader who has asked for reduced motion gets
 * the dot and no animation. The dot is never the only signal: the word "Live" is right beside it.
 */
function LiveDot() {
  return (
    <span className="relative flex size-1.5" aria-hidden>
      <span className="absolute inline-flex size-full rounded-full bg-[var(--gold)] opacity-60 motion-safe:animate-ping" />
      <span className="relative inline-flex size-1.5 rounded-full bg-[var(--gold)]" />
    </span>
  )
}
