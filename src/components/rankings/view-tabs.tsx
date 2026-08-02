import Link from 'next/link'

import { cn } from '@/lib/utils'

type Mode = 'current' | 'historical' | 'all-time'

const TABS: { mode: Mode; label: string; href: string }[] = [
  { mode: 'current', label: 'Current', href: '/rankings' },
  { mode: 'historical', label: 'Historical', href: '/rankings?view=historical' },
  { mode: 'all-time', label: 'All-Time', href: '/rankings?view=all-time' },
]

export function ViewTabs({ mode }: { mode: Mode }) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-card/40 p-1">
      {TABS.map((t) => (
        <Link
          key={t.mode}
          href={t.href}
          className={cn(
            'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
            mode === t.mode
              ? 'bg-gold/15 text-gold'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  )
}

export function YearSelector({ years, active }: { years: number[]; active: number }) {
  if (!years.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="eyebrow mr-1 text-[0.6rem] text-muted-foreground">Year</span>
      {years.map((y) => (
        <Link
          key={y}
          href={`/rankings?view=historical&year=${y}`}
          className={cn(
            'tabular rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
            y === active
              ? 'border-gold/40 bg-gold/10 text-gold'
              : 'border-border text-muted-foreground hover:text-foreground',
          )}
        >
          {y}
        </Link>
      ))}
    </div>
  )
}
