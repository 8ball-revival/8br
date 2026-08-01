import { Panel, Flag } from '@/components/home/primitives'
import { cn } from '@/lib/utils'
import type { StandingEntry } from '@/lib/home/fixtures'

function rankColor(rank: number) {
  if (rank === 1) return 'text-gold'
  if (rank <= 3) return 'text-gold-soft'
  return 'text-muted-foreground'
}

export function StandingsPanel({ rows }: { rows: StandingEntry[] }) {
  return (
    <Panel title="Current Standings" actionLabel="View full standings" actionHref="/rankings" bodyClassName="p-0">
      <ol className="divide-y divide-border/70">
        {rows.map((r) => (
          <li
            key={r.rank}
            className={cn(
              'flex items-center gap-2.5 px-4 py-2',
              r.you && 'bg-gold/[0.06]',
            )}
          >
            <span className={cn('tabular w-5 text-right text-sm font-bold', rankColor(r.rank))}>{r.rank}</span>
            <Flag code={r.country} />
            <span className={cn('min-w-0 flex-1 truncate text-sm font-medium', r.you ? 'text-gold' : 'text-foreground')}>
              {r.name}
            </span>
            <span className="tabular w-10 text-right text-xs text-muted-foreground">
              {r.wins}–{r.losses}
            </span>
            <span className="tabular w-12 text-right text-sm font-semibold text-foreground">
              {r.rating.toLocaleString('en-US')}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  )
}
