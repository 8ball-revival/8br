import { CalendarClock } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { MatchRow } from '@/components/season/match-row'
import type { MatchData } from '@/lib/mock-data'

/** A list of matches (schedule/results). Shows an honest empty state when none. */
export function MatchList({ matches, emptyLabel }: { matches: MatchData[]; emptyLabel?: string }) {
  if (matches.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title={emptyLabel ?? 'Results not yet imported'}
        description="Match results will appear here once imported and verified from source."
      />
    )
  }
  return (
    <Card className="px-4">
      <div className="divide-y divide-border">
        {matches.map((m, i) => (
          <MatchRow key={i} match={m} />
        ))}
      </div>
    </Card>
  )
}
