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

/**
 * "By the Numbers" + "On This Day", the closing block of the homepage.
 *
 * One row on desktop: seven equal statistic cards and a double-width On This Day of exactly the same
 * height. The equal widths come from an eight-column grid where On This Day spans two, so the tiles
 * cannot drift apart as numbers get longer, and `items-stretch` makes every card adopt the row's
 * height rather than each sizing to its own content.
 *
 * Below the desktop breakpoint the row scrolls horizontally instead of squeezing eight cards into
 * unreadable slivers, and on a phone it becomes two columns with On This Day spanning both.
 *
 * Every figure comes from the live competition database (see lib/stats/registry-stats.ts); nothing
 * here reads an archive file or a static total. Server-rendered, so the cards arrive filled in.
 */

const HEADING = '8 Ball Registry by the Numbers'

/** Group separators make a five-figure total readable at a glance. */
const format = (n: number): string => n.toLocaleString('en-US')

function StatCard({
  label, value, sub, Icon,
}: { label: string; value: number; sub: string | null; Icon: typeof Crown }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card/40 px-3 py-4 text-center">
      <span
        aria-hidden
        className="inline-flex size-9 items-center justify-center rounded-full bg-brand/10 text-brand"
      >
        <Icon className="size-4" />
      </span>
      <span className="font-display text-2xl font-bold leading-none tabular-nums">{format(value)}</span>
      <span className="text-[0.6rem] font-semibold uppercase leading-tight tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      {sub && <span className="text-[0.65rem] leading-none text-muted-foreground/80">{sub}</span>}
    </div>
  )
}

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
    <section aria-labelledby="by-the-numbers-heading" className="border-t border-border py-10 lg:py-12">
      <Wide>
        <h2
          id="by-the-numbers-heading"
          className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-brand"
        >
          {HEADING}
        </h2>

        {/*
          One row from the small breakpoint upward. The track minimums are what keep the cards
          readable: nine tracks with a floor of 8.5rem (and 17rem for the double-width card) need
          roughly 1320px, so anything narrower overflows and the container scrolls rather than
          squeezing eight cards into slivers. `-mx-4 px-4` lets that scroll reach the edge of the
          viewport instead of stopping inside the container's padding.

          A phone gets two columns instead, because a scrolling row of nine is not a thing to hand
          somebody on a 390px screen.
        */}
        <div className="mt-4 -mx-4 overflow-x-auto px-4 pb-2 sm:pb-1 xl:mx-0 xl:overflow-visible xl:px-0 xl:pb-0">
          <div className="grid auto-rows-fr grid-cols-2 items-stretch gap-3 sm:grid-cols-[repeat(7,minmax(8.5rem,1fr))_minmax(17rem,2fr)]">
            {cards.map((c) => <StatCard key={c.label} {...c} />)}
            {/* Both columns on a phone, two tracks of nine above that — always the same height. */}
            <div className="col-span-2 sm:col-span-1">
              <OnThisDayCard events={events} />
            </div>
          </div>
        </div>
      </Wide>
    </section>
  )
}
