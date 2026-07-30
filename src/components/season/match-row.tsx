import { Badge } from '@/components/ui/badge'
import type { MatchData } from '@/lib/mock-data'

const RESOLUTION_LABEL: Record<MatchData['resolution'], string> = {
  played: '',
  forfeit: 'Forfeit',
  walkover: 'Walkover',
  bye: 'Bye',
  pending: 'Pending',
}

/** A single match line: competitors + score, or an honest non-played/pending state. */
export function MatchRow({ match }: { match: MatchData }) {
  const played = match.resolution === 'played' && match.scoreA != null && match.scoreB != null

  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0 text-sm">
        <span className="font-medium">{match.a}</span>
        <span className="text-muted-foreground"> vs </span>
        <span className="font-medium">{match.b ?? 'Bye'}</span>
      </div>
      <div className="shrink-0">
        {played ? (
          <span className="tabular rounded-md bg-muted px-2.5 py-1 text-sm font-semibold">
            {match.scoreA}–{match.scoreB}
          </span>
        ) : match.resolution === 'pending' ? (
          <span className="text-sm text-muted-foreground">—</span>
        ) : (
          <Badge variant="muted">{RESOLUTION_LABEL[match.resolution]}</Badge>
        )}
      </div>
    </div>
  )
}
