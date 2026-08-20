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
 * opened a Seasons/Cups pair rather than navigating — and that machinery is gone with them: Seasons
 * and Cups are top-level tabs now, so there is nothing left to open.
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
              'relative rounded-md px-3 py-2 text-sm font-medium transition-colors',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {entry.label}
            {active && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-brand" aria-hidden />}
          </Link>
        )
      })}
    </nav>
  )
}
