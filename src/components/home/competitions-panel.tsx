import Link from 'next/link'
import { Trophy, ArrowRight } from 'lucide-react'

import { Badge } from '@/components/ui/badge'

export interface CompetitionItem {
  title: string
  meta: string
  href: string
  status: 'live' | 'open' | 'upcoming' | 'closed'
}

const STATUS: Record<CompetitionItem['status'], { label: string; variant: 'gold' | 'success' | 'muted' | 'destructive' }> = {
  live: { label: 'Live', variant: 'destructive' },
  open: { label: 'Registration open', variant: 'gold' },
  upcoming: { label: 'Upcoming', variant: 'muted' },
  closed: { label: 'In progress', variant: 'muted' },
}

/** Hero side panel: current & upcoming competitions (replaces the old registered-player list). */
export function CompetitionsPanel({ items }: { items: CompetitionItem[] }) {
  return (
    <div className="rounded-xl border border-border bg-card/60 backdrop-blur">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 font-display text-sm font-semibold">
          <Trophy className="size-4 text-gold" /> Competitions
        </h2>
        <Link href="/cups" className="text-xs text-muted-foreground transition-colors hover:text-foreground">All cups</Link>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">No active competitions right now.</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((c, i) => (
            <li key={i}>
              <Link href={c.href} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{c.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{c.meta}</p>
                </div>
                <Badge variant={STATUS[c.status].variant}>{STATUS[c.status].label}</Badge>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
