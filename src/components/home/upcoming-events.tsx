import { CalendarClock, Users, Swords, Trophy, type LucideIcon } from 'lucide-react'

import { Panel } from '@/components/home/primitives'
import type { UpcomingEvent } from '@/lib/home/fixtures'

// Distinct icon color per event kind (via defined --chart-* tokens), neutral chip.
const KIND: Record<UpcomingEvent['kind'], { icon: LucideIcon; color: string }> = {
  registration: { icon: CalendarClock, color: 'text-[var(--chart-5)]' },
  group: { icon: Users, color: 'text-[var(--chart-2)]' },
  playoff: { icon: Swords, color: 'text-[var(--chart-3)]' },
  final: { icon: Trophy, color: 'text-gold' },
}

export function UpcomingEvents({ items }: { items: UpcomingEvent[] }) {
  return (
    <Panel title="Upcoming Events" actionLabel="View all" actionHref="/seasons" bodyClassName="p-0">
      <ul className="divide-y divide-border">
        {items.map((e) => {
          const k = KIND[e.kind]
          const Icon = k.icon
          return (
            <li key={e.id} className="flex items-center gap-3 px-4 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                <Icon className={`size-4 ${k.color}`} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{e.title}</p>
                <p className="truncate text-xs text-muted-foreground">{e.subtitle}</p>
              </div>
              <div className="text-right">
                <span className="tabular block text-lg font-bold leading-none text-foreground">{e.days}</span>
                <span className="eyebrow text-[0.55rem] text-muted-foreground">Days</span>
              </div>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}
