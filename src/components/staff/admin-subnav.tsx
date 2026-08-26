'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface AdminNavItem { key: string; label: string; href: string }

/** Compact Admin subnavigation (styled like the Groups/Playoffs toggles). The tab strip WRAPS
 *  rather than scrolling horizontally — with a short section list a scroll affordance is just
 *  noise, and wrapping keeps every tab reachable at any width. Narrow viewports still get the
 *  "Admin sections" dropdown. No full-height sidebar — the page keeps the normal 8BR chrome. */
export function AdminSubnav({ items, active }: { items: AdminNavItem[]; active: string }) {
  const [open, setOpen] = useState(false)
  const current = items.find((i) => i.key === active)

  return (
    <div className="mt-3">
      {/* Mobile: dropdown */}
      <div className="relative sm:hidden">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between rounded-none border border-border bg-card/50 px-3 py-2 text-sm font-semibold">
          {current?.label ?? 'Admin sections'} <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
        </button>
        {open && (
          <ul className="absolute z-30 mt-1 w-full space-y-0.5 rounded-none border border-border bg-popover p-1 shadow-lg">
            {items.map((i) => (
              <li key={i.key}>
                <Link href={i.href} onClick={() => setOpen(false)} className={cn('block rounded px-3 py-2 text-sm', i.key === active ? 'bg-[var(--selected-surface)] font-semibold text-brand' : 'hover:bg-muted')}>{i.label}</Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Desktop / tablet: horizontal scroll strip */}
      <nav aria-label="Admin sections" className="hidden flex-wrap gap-1 rounded-none border border-border bg-card/40 p-1 sm:flex">
        {items.map((i) => (
          <Link
            key={i.key}
            href={i.href}
            aria-current={i.key === active ? 'page' : undefined}
            className={cn(
              'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50',
              i.key === active ? 'bg-brand text-white' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {i.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
