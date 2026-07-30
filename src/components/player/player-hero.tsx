import { ShieldQuestion } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { Badge } from '@/components/ui/badge'
import { Breadcrumbs } from '@/components/ui/breadcrumb'
import type { PlayerPreview } from '@/lib/preview-players'
import { formatPct } from '@/lib/format'

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="tabular text-2xl font-semibold tracking-tight">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

/** Player identity header: primary alias, canonical id, region, activity, quick stats. */
export function PlayerHero({ player }: { player: PlayerPreview }) {
  const initials = player.primaryName.slice(0, 2).toUpperCase()
  const years =
    player.firstYear && player.lastYear
      ? player.firstYear === player.lastYear
        ? `${player.firstYear}`
        : `${player.firstYear}–${player.lastYear}`
      : null
  const c = player.career

  return (
    <div className="border-b border-border bg-card/30">
      <Container className="py-10">
        <Breadcrumbs
          items={[
            { label: 'Home', href: '/' },
            { label: 'Players', href: '/players' },
            { label: player.primaryName },
          ]}
          className="mb-6"
        />
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="flex size-20 shrink-0 items-center justify-center rounded-xl border border-border bg-muted font-display text-2xl font-bold">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
                {player.primaryName}
              </h1>
              <span className="tabular rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {player.playerId}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {player.country && <span>{player.country}</span>}
              {years && <span>Active {years}</span>}
              <span>{player.aliases.length} known aliases</span>
            </div>
            <div className="mt-3">
              <Badge variant="muted">
                <ShieldQuestion className="size-3" aria-hidden /> Archive preview · pending verification
              </Badge>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-6 sm:border-l sm:border-border sm:pl-8">
            <Stat label="Titles" value={c?.championships ?? '—'} />
            <Stat label="Seasons" value={c?.seasonsPlayed ?? '—'} />
            <Stat
              label="Win rate"
              value={c?.totalWinPct != null ? formatPct(c.totalWinPct / 100) : '—'}
            />
          </div>
        </div>
      </Container>
    </div>
  )
}
