import { FileSearch } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import type { SeasonSourceRef } from '@/lib/mock-data'

const KIND_LABEL: Record<SeasonSourceRef['kind'], string> = {
  file_row: 'File',
  url: 'URL',
  wayback: 'Archive',
  manual_review: 'Review',
  pending: 'Pending',
}

/** Source references backing a season's records. Honest empty state when none. */
export function SourceList({ sources }: { sources: SeasonSourceRef[] }) {
  if (sources.length === 0) {
    return (
      <EmptyState
        icon={FileSearch}
        title="Source review pending"
        description="Source references for this season are still being reviewed and will be listed here with exact citations."
      />
    )
  }
  return (
    <Card>
      <CardContent className="divide-y divide-border p-0">
        {sources.map((s, i) => (
          <div key={i} className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{s.label}</p>
              {s.locator && <p className="truncate text-xs text-muted-foreground">{s.locator}</p>}
            </div>
            <Badge variant="muted">{KIND_LABEL[s.kind]}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
