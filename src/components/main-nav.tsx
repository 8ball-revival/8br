'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { PRIMARY_NAV, type NavItem } from '@/lib/nav'
import { cn } from '@/lib/utils'

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href)
}

/** Desktop primary navigation with active-route highlighting. `extraItems` (e.g. a staff-only Admin
 *  link) are appended after the public items. */
export function MainNav({ className, extraItems = [] }: { className?: string; extraItems?: NavItem[] }) {
  const pathname = usePathname()
  return (
    <nav aria-label="Primary" className={cn('items-center gap-1', className)}>
      {[...PRIMARY_NAV, ...extraItems].map((item) => {
        const active = isActive(pathname, item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative rounded-md px-3 py-2 text-sm font-medium transition-colors',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
            {active && (
              <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-brand" aria-hidden />
            )}
          </Link>
        )
      })}
    </nav>
  )
}
