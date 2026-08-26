'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { type NavItem } from '@/lib/nav'
import { cn } from '@/lib/utils'

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href)
}

/**
 * Primary navigation, on the acid surface.
 *
 * ── Why the colours are inverted from everywhere else ────────────────────────────────────────────
 * This bar used to be dark, so its items were muted grey and lit yellow when active. The bar is
 * acid now, and both of those are wrong on it: grey on yellow is mud and yellow on yellow is
 * nothing. Black is the only text colour permitted on acid, so an inactive item is black held back
 * with opacity, and the ACTIVE item is red — the one other colour that survives on this surface and
 * the same red used for every piece of technical linework in the interface.
 *
 * ── The marker is not colour alone ───────────────────────────────────────────────────────────────
 * The active item also gains a solid underline and `aria-current`, so the current page is
 * identifiable without seeing the difference between black and red.
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
        return (
          <Link
            key={entry.href}
            href={entry.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative px-3 py-2 text-sm font-semibold tracking-wide transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--void)]',
              active
                ? 'text-[var(--hot-red)]'
                : 'text-[var(--acid-ink)]/75 hover:text-[var(--acid-ink)]',
            )}
          >
            {entry.label}
            {active && (
              <span
                className="absolute inset-x-2 -bottom-[2px] h-[3px] bg-[var(--hot-red)]"
                aria-hidden
              />
            )}
          </Link>
        )
      })}
    </nav>
  )
}
