import { History, Trophy, Swords, Users, Crown, Globe, CircleDot, type LucideIcon } from 'lucide-react'

import type { StatItem } from '@/lib/home/fixtures'

const ICONS: Record<StatItem['icon'], LucideIcon> = {
  history: History,
  seasons: Trophy,
  matches: Swords,
  players: Users,
  champions: Crown,
  countries: Globe,
  games: CircleDot,
}

export function ByTheNumbers({ stats }: { stats: StatItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
      {stats.map((s) => {
        const Icon = ICONS[s.icon]
        return (
          <div
            key={s.id}
            className="flex flex-col items-center rounded-lg border border-border bg-card px-3 py-4 text-center"
          >
            <span className="mb-2 flex size-9 items-center justify-center rounded-full bg-gold/10">
              <Icon className="size-5 text-gold" />
            </span>
            <span className="tabular text-2xl font-bold leading-none text-foreground">{s.value}</span>
            <span className="eyebrow mt-1.5 text-[0.58rem] text-muted-foreground">{s.label}</span>
            {s.sub && <span className="mt-0.5 text-[0.6rem] text-muted-foreground/70">{s.sub}</span>}
          </div>
        )
      })}
    </div>
  )
}
