'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { type NavItem } from '@/lib/nav'
import { cn } from '@/lib/utils'

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href)
}

/**
 * Primary navigation, on the navigation surface — whatever that surface currently is.
 *
 * ── Why the colours are named rather than picked ─────────────────────────────────────────────────
 * This has now been three different bars: dark with yellow items, warm-white with black items, and
 * graphite with warm-white items. Each time, the ink was written against the surface of the day —
 * most recently as `--acid-ink`, which is near-black — so the day the bar became graphite every link
 * in it turned black on black and vanished while remaining perfectly present in the DOM.
 *
 * So it asks for a ROLE instead. `--nav-inactive` and `--nav-foreground` are declared next to
 * `--nav-bg` and move with it, and verify-acid-contrast measures all three against each other. A
 * future bar of any colour brings its own legible ink or fails the check.
 *
 * Opacity is gone with it: an inactive item is a dimmer token, not the active one at 75%. Alpha over
 * an unknown ground is how a contrast ratio stops being knowable.
 *
 * ── The marker is not colour alone ───────────────────────────────────────────────────────────────
 * The active item also gains a solid underline and `aria-current`, so the current page is
 * identifiable without seeing the difference between the two colours.
 */
export function MainNav({
  className, entries, extraItems = [],
}: {
  className?: string
  entries: NavItem[]
  extraItems?: NavItem[]
}) {
  const pathname = usePathname()
  const all: NavItem[] = [...entries, ...extraItems]

  return (
    <nav aria-label="Primary" className={cn('items-center gap-1', className)}>
      {all.map((entry) => {
        const active = isActive(pathname, entry.href)
        const link = (
          <Link
            href={entry.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative px-3 py-2 text-sm font-semibold tracking-wide transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
              active
                ? 'text-[var(--nav-active)]'
                : 'text-[var(--nav-inactive)] hover:text-[var(--nav-foreground)]',
            )}
          >
            {entry.label}
            {active && (
              <span
                className="absolute inset-x-2 -bottom-[2px] h-[3px] bg-[var(--nav-active)]"
                aria-hidden
              />
            )}
          </Link>
        )

        if (!entry.children?.length) return <span key={entry.href}>{link}</span>

        /*
          A dropdown, with no JavaScript in it.

          ── Why CSS rather than state ─────────────────────────────────────────────────────────────
          `group-hover` opens it for a pointer and `focus-within` opens it for a keyboard, which
          between them cover everybody without a click handler, without an open/closed state to get
          stuck, and without the menu being absent from the markup until something runs. That last
          part matters beyond tidiness: a menu that only exists after hydration is a menu a crawler,
          a reader-mode view and a browser with a slow connection never see.

          The children are therefore always in the DOM and only ever hidden visually — which is also
          what lets the integration suite assert that a published nested menu genuinely renders.
        */
        return (
          <span key={entry.href} className="group relative inline-flex">
            {link}
            <span className="pointer-events-none absolute left-0 top-full z-50 hidden min-w-[12rem] pt-1 group-hover:block group-focus-within:block">
              <span className="pointer-events-auto block border border-[var(--line-strong)] bg-[var(--graphite)] py-1 shadow-lg">
                {entry.children.map((child) => (
                  <Link
                    key={child.href}
                    href={child.href}
                    target={child.newTab ? '_blank' : undefined}
                    rel={child.newTab ? 'noopener noreferrer' : undefined}
                    className={cn(
                      'block px-3 py-1.5 text-sm font-semibold tracking-wide transition-colors',
                      isActive(pathname, child.href)
                        ? 'text-[var(--hot-red)]'
                        : 'text-muted-foreground hover:bg-[var(--selected-surface)] hover:text-foreground',
                    )}
                  >
                    {child.label}
                  </Link>
                ))}
              </span>
            </span>
          </span>
        )
      })}
    </nav>
  )
}
