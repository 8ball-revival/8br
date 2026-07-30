import Link from 'next/link'
import { Trophy, Users } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/status-badge'
import type { Season } from '@/lib/mock-data'

export function SeasonCard({ season }: { season: Season }) {
  return (
    <Link href={`/seasons/${season.slug}`} className="group block">
      <Card className="h-full transition-colors group-hover:border-gold/40">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <span className="eyebrow text-muted-foreground">{season.year}</span>
            <StatusBadge status={season.status} />
          </div>
          <CardTitle className="text-lg transition-colors group-hover:text-gold">{season.name}</CardTitle>
          {season.originalName && (
            <p className="text-xs text-muted-foreground">originally {season.originalName}</p>
          )}
        </CardHeader>
        <CardContent className="flex items-center gap-5 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Users className="size-4" aria-hidden />
            {season.participants || '—'} players
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Trophy className="size-4" aria-hidden />
            {season.championHandle ?? 'TBD'}
          </span>
        </CardContent>
      </Card>
    </Link>
  )
}
