'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { type NavItem } from '@/lib/nav'
import { cn } from '@/lib/utils'

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href)
}

/**
 * Primary navigation.
 *
 * Every entry is a destination. This used to carry a dropdown for Live and Archives — triggers that
 * opened a Seasons/Tournaments pair rather than navigating — and that machinery is gone with them: Seasons
 * and Tournaments are top-level tabs now, so there is nothing left to open.
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
              'relative rounded-none px-3 py-2 text-sm font-medium uppercase tracking-wide transition-all duration-200',
              active
                ? 'text-[var(--neon-yellow)] [text-shadow:var(--glow-yellow)]'
                : 'text-muted-foreground hover:text-[var(--neon-cyan)] hover:[text-shadow:var(--glow-cyan)]',
            )}
          >
            {entry.label}
            {/* The active marker is a lit bar rather than a rounded pill — the same edge the panels use. */}
            {active && (
              <span
                className="absolute inset-x-2 -bottom-px h-[2px] bg-[var(--neon-yellow)] [box-shadow:var(--glow-yellow)]"
                aria-hidden
              />
            )}
          </Link>
        )
      })}
    </nav>
  )
}
