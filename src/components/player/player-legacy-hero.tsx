import Link from 'next/link'
import { ArrowLeft, ShieldQuestion, Star } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { Badge } from '@/components/ui/badge'
import { Breadcrumbs } from '@/components/ui/breadcrumb'
import { cn } from '@/lib/utils'
import { formatPct } from '@/lib/format'
import { activeYears, activityStatus, isHallOfFame, legacyClassification } from '@/lib/players/legacy'
import type { PlayerPreview, PreviewHof } from '@/lib/preview-players'

function rankFor(hof: PreviewHof[], category: string): number | null {
  return hof.find((h) => h.category === category)?.rank ?? null
}

function Metric({
  value,
  label,
  rank,
  gold,
}: {
  value: React.ReactNode
  label: string
  rank: number | null
  gold?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-4',
        gold ? 'border-gold/30 bg-gold/[0.06]' : 'border-border bg-card/50',
      )}
    >
      <div
        className={cn(
          'tabular text-3xl font-bold tracking-tight sm:text-4xl',
          gold ? 'text-gold' : 'text-foreground',
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
      {rank != null && (
        <div className={cn('mt-1 text-xs font-semibold', rank === 1 ? 'text-gold' : 'text-muted-foreground')}>
          #{rank} All-Time
        </div>
      )}
    </div>
  )
}

/**
 * Full-width legacy hero: identity on the left, the four most meaningful legacy
 * metrics (with all-time rank underneath) on the right. Championships get the
 * strongest gold treatment; routine stats stay neutral.
 */
export function PlayerLegacyHero({ player }: { player: PlayerPreview }) {
  const initials = player.primaryName.slice(0, 2).toUpperCase()
  const years = activeYears(player)
  const status = activityStatus(player)
  const statusWord = status.status === 'inactive' ? 'Inactive' : 'Status unknown'
  const hof = isHallOfFame(player.hof)
  const classification = legacyClassification(player)
  const c = player.career

  const metaParts = [player.country, statusWord, years].filter(Boolean) as string[]

  const metrics = [
    {
      key: 'titles',
      value: c?.championships ?? '—',
      label: 'Championships',
      rank: rankFor(player.hof, 'championships'),
      gold: true,
    },
    { key: 'wins', value: c?.totalWins ?? '—', label: 'Career Wins', rank: rankFor(player.hof, 'total_wins') },
    {
      key: 'finals',
      value: c?.finals ?? '—',
      label: 'Finals',
      rank: rankFor(player.hof, 'finals_appearances'),
    },
    {
      key: 'winrate',
      value: c?.totalWinPct != null ? formatPct(c.totalWinPct / 100) : '—',
      label: 'Win Rate',
      rank: null,
    },
  ]

  return (
    <div className="border-b border-border bg-card/30">
      <Container className="py-8 sm:py-10">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Breadcrumbs
            items={[
              { label: 'Home', href: '/' },
              { label: 'Players', href: '/players' },
              { label: player.primaryName },
            ]}
          />
          <Link
            href="/players"
            className="inline-flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden /> Back to Players
          </Link>
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-center">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <div className="flex size-20 shrink-0 items-center justify-center rounded-xl border border-border bg-muted font-display text-2xl font-bold sm:size-24">
              {initials}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {hof && (
                  <Badge variant="gold">
                    <Star className="size-3" aria-hidden /> Hall of Fame
                  </Badge>
                )}
                {classification && <Badge variant="outline">{classification}</Badge>}
              </div>
              <h1 className="mt-2 font-display text-4xl font-bold tracking-tight break-words sm:text-5xl">
                {player.primaryName}
              </h1>
              {metaParts.length > 0 && (
                <p className="mt-2 text-sm text-muted-foreground">{metaParts.join(' · ')}</p>
              )}
              <div className="mt-3">
                <Badge variant="muted">
                  <ShieldQuestion className="size-3" aria-hidden /> Archive preview · pending verification
                </Badge>
              </div>
              <p className="tabular mt-2 text-xs text-muted-foreground">
                Archive ID {player.playerId} · {player.aliases.length} known aliases
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {metrics.map((m) => (
              <Metric key={m.key} value={m.value} label={m.label} rank={m.rank} gold={m.gold} />
            ))}
          </div>
        </div>
      </Container>
    </div>
  )
}
