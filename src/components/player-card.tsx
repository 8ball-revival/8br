import Link from 'next/link'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { Player } from '@/lib/mock-data'
import { formatPct } from '@/lib/format'

export function PlayerCard({ player }: { player: Player }) {
  const initials = player.handle.slice(0, 2).toUpperCase()
  return (
    <Link href={`/players/${player.slug}`} className="group block">
      <Card className="h-full transition-colors group-hover:border-gold/40">
        <CardContent className="flex items-center gap-4 p-5">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-full border border-border bg-muted font-display text-sm font-semibold">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-display font-semibold transition-colors group-hover:text-gold">
                {player.handle}
              </span>
              {player.country && <span className="text-xs text-muted-foreground">{player.country}</span>}
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
              <span>{player.seasonsPlayed} seasons</span>
              <span className="tabular">{formatPct(player.matchWinPct)} win rate</span>
            </div>
          </div>
          {player.titles > 0 && <Badge variant="gold">{player.titles}×</Badge>}
        </CardContent>
      </Card>
    </Link>
  )
}
