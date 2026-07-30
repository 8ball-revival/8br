import { Database } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PLAYER_PREVIEW_SOURCE } from '@/lib/preview-players'

/** Provenance for the preview data shown on this profile. */
export function SourcePanel({ playerId }: { playerId: string }) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="flex items-start gap-3">
          <Database className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <p className="text-sm font-medium">{PLAYER_PREVIEW_SOURCE}</p>
            <p className="tabular mt-0.5 text-xs text-muted-foreground">Archive record {playerId}</p>
          </div>
        </div>
        <Badge variant="muted">Unverified</Badge>
      </CardContent>
    </Card>
  )
}
