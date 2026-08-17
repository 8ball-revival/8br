import {
  CalendarRange,
  Crown,
  Flag,
  Layers,
  Swords,
  Target,
  Users,
} from 'lucide-react'

import { Wide } from '@/components/primitives'
import type { RegistryStats } from '@/lib/stats/registry-stats'
import type { OnThisDayEvent } from '@/lib/stats/on-this-day'
import { OnThisDayCard } from './on-this-day-card'

const HEADING = '8 BALL REGISTRY BY THE NUMBERS'
const EMPTY_ON_THIS_DAY = 'No events recorded for this date yet'

/**
 * "By the Numbers" + "On This Day", the closing block of the homepage.
 *
 * Every figure comes from the live competition database (see lib/stats/registry-stats.ts); nothing
 * here reads an archive file or a static total. Server-rendered, so the cards arrive filled in
 * rather than as seven client fetches.
 */
export function ByTheNumbers({
  stats,
  events,
}: {
  stats: RegistryStats
  events: OnThisDayEvent[]
}) {
  const cards = [
    {
      label: 'Years of History',
      value: stats.yearsOfHistory,
      sub: stats.since ? `Since ${stats.since}` : null,
      Icon: CalendarRange,
    },
    { label: 'Seasons', value: stats.seasons, sub: null, Icon: Layers },
    { label: 'Matches Played', value: stats.matchesPlayed, sub: null, Icon: Swords },
    { label: 'Players', value: stats.players, sub: null, Icon: Users },
    { label: 'Champions', value: stats.champions, sub: null, Icon: Crown },
    { label: 'Countries', value: stats.countries, sub: null, Icon: Flag },
    { label: 'Games Played', value: stats.gamesPlayed, sub: null, Icon: Target },
  ]

  return (
    <section className="border-t border-border py-12 lg:py-16">
      <Wide>
        <h2 className="font-display text-2xl font-bold uppercase tracking-tight text-foreground sm:text-3xl">
          {HEADING}
        </h2>

        {/* Stats grid beside the larger On This Day card on wide screens; stacked below it. */}
        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:col-span-2 lg:grid-cols-3">
            {cards.map(({ label, value, sub, Icon }) => (
              <div key={label} className="rounded-xl border border-border bg-card p-4">
                <Icon className="size-4 text-gold" aria-hidden />
                <p className="mt-3 font-display text-2xl font-bold tabular-nums text-foreground sm:text-3xl">
                  {value.toLocaleString()}
                </p>
                <p className="mt-1 text-xs font-medium text-muted-foreground">{label}</p>
                {sub && <p className="mt-0.5 text-[0.7rem] text-gold">{sub}</p>}
              </div>
            ))}
          </div>

          <OnThisDayCard events={events} emptyText={EMPTY_ON_THIS_DAY} />
        </div>
      </Wide>
    </section>
  )
}
