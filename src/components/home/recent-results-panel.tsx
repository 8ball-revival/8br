import { Panel, Flag } from '@/components/home/primitives'
import { cn } from '@/lib/utils'
import type { ResultRow } from '@/lib/home/fixtures'

const TONE: Record<ResultRow['competitionTone'], string> = {
  season: 'text-gold',
  cup: 'text-[var(--chart-3)]',
  invitational: 'text-[var(--chart-2)]',
  special: 'text-[var(--chart-5)]',
}

function Side({ name, country, score, won }: { name: string; country: string; score: number; won: boolean }) {
  return (
    <div className={cn('flex items-center gap-1.5', won ? 'text-foreground' : 'text-muted-foreground')}>
      <Flag code={country} />
      <span className={cn('truncate text-sm', won && 'font-semibold')}>{name}</span>
      <span className={cn('tabular text-sm', won ? 'font-bold text-gold' : '')}>{score}</span>
    </div>
  )
}

export function RecentResultsPanel({ rows }: { rows: ResultRow[] }) {
  return (
    <Panel title="Recent Results" actionLabel="View all results" actionHref="/seasons" bodyClassName="p-0">
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.id} className="px-4 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className={cn('eyebrow truncate text-[0.6rem]', TONE[r.competitionTone])}>{r.competition}</span>
              <span className="shrink-0 text-[0.65rem] text-muted-foreground">{r.date}</span>
            </div>
            <div className="mt-1.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <Side name={r.a.name} country={r.a.country} score={r.a.score} won={r.winner === 'a'} />
              <span className="text-[0.6rem] text-muted-foreground">–</span>
              <div className="justify-self-end">
                <Side name={r.b.name} country={r.b.country} score={r.b.score} won={r.winner === 'b'} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
