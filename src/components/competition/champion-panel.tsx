import Link from 'next/link'
import { Trophy } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfidenceBadge } from '@/components/confidence-badge'
import type { ChampionInfo, RunnerUpInfo } from '@/lib/preview-competitions'

function NameLink({ name, slug }: { name: string; slug: string | null }) {
  return slug ? (
    <Link href={`/players/${slug}`} className="transition-colors hover:text-gold">
      {name}
    </Link>
  ) : (
    <span>{name}</span>
  )
}

/** Champion (and runner-up) with confidence — clearly marks inferred champions. */
export function ChampionPanel({
  champion,
  runnerUp,
}: {
  champion: ChampionInfo | null
  runnerUp: RunnerUpInfo | null
}) {
  if (!champion) {
    return (
      <EmptyState
        icon={Trophy}
        title="Champion pending verification"
        description="The champion for this competition has not yet been verified from source."
      />
    )
  }
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex size-12 items-center justify-center rounded-full bg-gold/10 text-gold">
            <Trophy className="size-6" aria-hidden />
          </div>
          <div>
            <div className="eyebrow text-muted-foreground">Champion</div>
            <div className="font-display text-2xl font-bold tracking-tight">
              <NameLink name={champion.name} slug={champion.slug} />
            </div>
            {runnerUp && (
              <div className="mt-1 text-sm text-muted-foreground">
                Runner-up: <NameLink name={runnerUp.name} slug={runnerUp.slug} />
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {champion.inferred && <Badge variant="muted">Inferred from records</Badge>}
          <ConfidenceBadge level={champion.confidence} />
        </div>
      </CardContent>
    </Card>
  )
}
