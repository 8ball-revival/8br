import { Layers } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { ConfidenceBadge } from '@/components/confidence-badge'
import { EmptyState } from '@/components/ui/empty-state'
import type { StageInfo } from '@/lib/preview-competitions'

/** Ordered stages of a competition (e.g. Group stage → Playoffs), each with a
 *  format and archive confidence. Supports any combination of formats. */
export function StageOverview({ stages }: { stages: StageInfo[] }) {
  if (stages.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="Stage structure pending verification"
        description="The competition's stages will appear here once verified."
      />
    )
  }
  return (
    <ol className="grid gap-4 sm:grid-cols-2">
      {stages.map((s, i) => (
        <li key={i}>
          <Card>
            <CardContent className="flex items-start justify-between gap-3 p-5">
              <div>
                <div className="flex items-center gap-2">
                  <span className="tabular text-xs text-muted-foreground">{i + 1}</span>
                  <span className="font-display font-semibold">{s.name}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{s.format}</p>
                {s.note && <p className="mt-1 text-xs text-muted-foreground">{s.note}</p>}
              </div>
              <ConfidenceBadge level={s.confidence} />
            </CardContent>
          </Card>
        </li>
      ))}
    </ol>
  )
}
