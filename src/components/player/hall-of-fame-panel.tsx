import { Medal } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import type { PreviewHof } from '@/lib/preview-players'

function prettyCategory(c: string) {
  return c.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}

/** All-time archive leaderboard positions for the player (real archive data). */
export function HallOfFamePanel({ entries }: { entries: PreviewHof[] }) {
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={Medal}
        title="No Hall of Fame or leaderboard positions in archive preview"
        description="Recognition and all-time leaderboard placements will appear here."
      />
    )
  }
  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">All-time archive leaderboard positions.</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((e, i) => (
          <Card key={i}>
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div>
                <div className="text-sm font-medium">{prettyCategory(e.category)}</div>
                <div className="text-xs text-muted-foreground">{e.value}</div>
              </div>
              <Badge variant={e.rank === 1 ? 'gold' : 'muted'}>#{e.rank ?? '—'}</Badge>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
