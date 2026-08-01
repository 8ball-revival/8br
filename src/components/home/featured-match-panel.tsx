import Link from 'next/link'
import { Video } from 'lucide-react'

import { Panel, Flag, PlayerAvatar } from '@/components/home/primitives'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { FeaturedMatch } from '@/lib/home/fixtures'

function Competitor({ side, leading }: { side: FeaturedMatch['a']; leading: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-2 text-center">
      <PlayerAvatar name={side.name} size="lg" />
      <div>
        <p className={cn('text-sm font-semibold', leading ? 'text-gold' : 'text-foreground')}>{side.name}</p>
        <p className="mt-0.5 flex items-center justify-center gap-1 text-xs text-muted-foreground">
          <Flag code={side.country} />
          {side.rank != null && <span>#{side.rank}</span>}
        </p>
      </div>
    </div>
  )
}

export function FeaturedMatchPanel({ match }: { match: FeaturedMatch }) {
  return (
    <Panel title="Live Featured Match" live={match.live} bodyClassName="p-0">
      <div className="flex flex-col items-center px-4 pt-4">
        <span className="eyebrow rounded-full border border-border px-2.5 py-1 text-[0.6rem] text-muted-foreground">
          Race to {match.raceTo}
        </span>
        <div className="mt-4 flex w-full items-center gap-2">
          <Competitor side={match.a} leading={match.a.score > match.b.score} />
          <div className="flex shrink-0 items-center gap-2 tabular text-3xl font-bold">
            <span className={cn(match.a.score >= match.b.score ? 'text-gold' : 'text-muted-foreground')}>
              {match.a.score}
            </span>
            <span className="text-sm text-muted-foreground">vs</span>
            <span className={cn(match.b.score > match.a.score ? 'text-gold' : 'text-muted-foreground')}>
              {match.b.score}
            </span>
          </div>
          <Competitor side={match.b} leading={match.b.score > match.a.score} />
        </div>
      </div>
      <div className="mt-4 border-t border-border p-3">
        <Button asChild variant="secondary" size="sm" className="w-full">
          <Link href={match.watchHref}>
            <Video className="size-4" />
            Watch Live Stream
          </Link>
        </Button>
      </div>
    </Panel>
  )
}
