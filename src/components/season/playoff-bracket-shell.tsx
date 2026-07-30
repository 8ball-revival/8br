import { GitFork } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import type { BracketMatchData, PlayoffData } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

function Competitor({ name, score }: { name: string | null; score: number | null }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={cn('truncate', name && name !== 'TBD' ? 'font-medium' : 'text-muted-foreground')}>
        {name ?? 'Bye'}
      </span>
      <span className="tabular shrink-0 text-muted-foreground">{score ?? '—'}</span>
    </div>
  )
}

function BracketMatch({ match }: { match: BracketMatchData }) {
  return (
    <div className="rounded-md border border-border bg-card p-3 text-sm">
      <Competitor name={match.a} score={match.scoreA} />
      <div className="my-1.5 border-t border-border" />
      <Competitor name={match.b} score={match.scoreB} />
      {match.resolution !== 'played' && (
        <div className="mt-2">
          <Badge variant="muted">
            {match.resolution === 'bye'
              ? 'Bye'
              : match.resolution === 'walkover'
                ? 'Walkover'
                : match.resolution === 'forfeit'
                  ? 'Forfeit'
                  : 'Pending'}
          </Badge>
        </div>
      )}
    </div>
  )
}

/**
 * Responsive bracket SHELL (not an engine). Rounds render as horizontally
 * scrollable columns; supports TBD competitors, byes, walkovers/forfeits, and
 * missing scores. A 'pending' playoff shows an honest empty state. This structure
 * can later back single-elim, double-elim (winners/losers), and grand-final resets.
 */
export function PlayoffBracketShell({ playoff }: { playoff: PlayoffData }) {
  if (playoff.state === 'pending' || playoff.rounds.length === 0) {
    return (
      <EmptyState
        icon={GitFork}
        title="Official playoff bracket pending source verification"
        description="The bracket will reflect the official seeding and results used at the time, once verified from source."
      />
    )
  }

  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">Format: {playoff.format}</p>
      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-max gap-6">
          {playoff.rounds.map((round) => (
            <div key={round.name} className="w-60 shrink-0">
              <h3 className="eyebrow mb-3 text-muted-foreground">{round.name}</h3>
              <div className="flex flex-col gap-4">
                {round.matches.map((m, i) => (
                  <BracketMatch key={i} match={m} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
