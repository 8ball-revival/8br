import Link from 'next/link'
import { Trophy } from 'lucide-react'

import { Panel } from '@/components/home/primitives'
import { cn } from '@/lib/utils'
import type { HofPlayer } from '@/lib/hall-of-fame/fixtures'

function rankColor(rank: number) {
  if (rank === 1) return 'text-gold'
  if (rank <= 3) return 'text-gold-soft'
  return 'text-muted-foreground'
}

export function Top10Panel({ players, className }: { players: HofPlayer[]; className?: string }) {
  return (
    <Panel
      title="Top 10 All Time"
      actionLabel="Hall of Fame"
      actionHref="/hall-of-fame"
      bodyClassName="flex flex-col p-0"
      className={className}
    >
      <p className="border-b border-border px-4 py-2 text-[0.65rem] text-muted-foreground">
        Based only on Group + Season play
      </p>
      <ol className="divide-y divide-border/70">
        {players.map((p, i) => (
          <li key={p.slug} className="flex items-center gap-2.5 px-4 py-2">
            <span className={cn('tabular w-5 text-right text-sm font-bold', rankColor(i + 1))}>{i + 1}</span>
            <div className="flex min-w-0 flex-1 items-baseline gap-2">
              <Link
                href={`/hall-of-fame/${p.slug}`}
                className="shrink-0 text-sm font-medium text-foreground transition-colors hover:text-gold"
              >
                {p.name}
              </Link>
              <span className="truncate text-xs text-muted-foreground">{p.handle}</span>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-foreground">
              {p.titles}
              <Trophy className="size-3.5 text-gold" aria-hidden />
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  )
}
