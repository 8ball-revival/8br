import Link from 'next/link'
import { Trophy } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PlayerAvatar } from '@/components/primitives'
import { cn } from '@/lib/utils'
import type { TournamentView } from '@/lib/tournaments/service'

export function TournamentCard({ cup }: { cup: TournamentView }) {
  const live = cup.status === 'live'
  return (
    <Link href={`/tournaments/${cup.number}`} className="group block">
      <Card
        className={cn(
          'flex h-full flex-col p-5 transition-colors group-hover:border-brand/50',
          live && 'border-brand/40 ring-1 ring-brand/20',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="eyebrow text-muted-foreground">Tournament {cup.number}</span>
          {live ? (
            <Badge variant="destructive">Live</Badge>
          ) : (
            cup.year && <span className="tabular text-xs text-muted-foreground">{cup.year}</span>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h3 className="font-display text-xl font-bold tracking-tight transition-colors group-hover:text-brand">
            {cup.name}
          </h3>
          <Badge variant="default">{cup.format}</Badge>
        </div>

        <div className="mt-4 border-t border-border pt-4">
          {live ? (
            <p className="text-sm text-muted-foreground">
              {cup.currentRound ? `In progress · ${cup.currentRound}` : 'In progress'}
            </p>
          ) : cup.champion ? (
            <div className="flex items-center gap-2.5">
              <Trophy className="size-4 shrink-0 text-brand" aria-hidden />
              <PlayerAvatar name={cup.champion.name} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {cup.champion.name}
                  {cup.finalScore && (
                    <span className="ml-1.5 tabular text-xs font-normal text-muted-foreground">{cup.finalScore}</span>
                  )}
                </p>
                {cup.champion.handle && <p className="truncate text-xs text-muted-foreground">{cup.champion.handle}</p>}
              </div>
              <span className="eyebrow ml-auto shrink-0 text-[0.55rem] text-brand">Champion</span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Champion pending</p>
          )}
        </div>
      </Card>
    </Link>
  )
}
