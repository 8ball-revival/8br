import { Trophy } from 'lucide-react'

import { Panel } from '@/components/home/primitives'
import { cn } from '@/lib/utils'
import type { SeasonPlayerStat } from '@/lib/stats/season-stats'

function rankColor(rank: number) {
  if (rank === 1) return 'text-gold'
  if (rank <= 3) return 'text-gold-soft'
  return 'text-muted-foreground'
}

export function Top10Panel({ players, className }: { players: SeasonPlayerStat[]; className?: string }) {
  return (
    <Panel
      title="Top 10 All Time"
      actionLabel="Hall of Fame"
      actionHref="/hall-of-fame"
      bodyClassName="flex flex-col p-0"
      className={className}
    >
      <p className="border-b border-border px-4 py-2 text-[0.65rem] text-muted-foreground">
        Ranked by verified Season championships (Seasons only — Cups excluded)
      </p>
      <ol className="divide-y divide-border/70">
        {players.map((p) => (
          <li key={p.id} className="flex items-center gap-2.5 px-4 py-2">
            <span className={cn('tabular w-5 text-right text-sm font-bold', rankColor(p.rank))}>{p.rank}</span>
            <div className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-sm font-medium text-foreground">{p.name}</span>
              {p.aliases[0] && <span className="truncate text-[0.65rem] text-muted-foreground">{p.aliases[0]}</span>}
            </div>
            <div className="flex shrink-0 flex-col items-end leading-tight">
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-foreground">
                {p.championships}
                <Trophy className="size-3.5 text-gold" aria-hidden />
              </span>
              <span className="tabular text-[0.65rem] text-muted-foreground">
                {p.playoffWins}–{p.playoffLosses} · {p.playoffWinPct}%
              </span>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  )
}
