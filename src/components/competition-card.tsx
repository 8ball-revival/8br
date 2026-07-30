import Link from 'next/link'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/status-badge'
import type { Competition } from '@/lib/mock-data'

export function CompetitionCard({ competition }: { competition: Competition }) {
  return (
    <Link href={`/competitions/${competition.slug}`} className="group block">
      <Card className="h-full transition-colors group-hover:border-gold/40">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <Badge variant="outline">{competition.type}</Badge>
            <StatusBadge status={competition.status} />
          </div>
          <CardTitle className="transition-colors group-hover:text-gold">{competition.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p>{competition.date}</p>
          <p className="text-xs">{competition.format}</p>
        </CardContent>
      </Card>
    </Link>
  )
}
