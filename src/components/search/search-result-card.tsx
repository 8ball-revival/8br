import Link from 'next/link'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { SearchResult, SearchType } from '@/lib/search'

const TYPE_LABEL: Record<SearchType, string> = {
  player: 'Player',
  competition: 'Competition',
  season: 'Season',
  news: 'News',
}

function StatusBadgeFor({ badge }: { badge: SearchResult['badge'] }) {
  if (badge === 'archive') return <Badge variant="muted">Archive preview</Badge>
  if (badge === 'pending') return <Badge variant="muted">Pending verification</Badge>
  if (badge === 'ego') return <Badge variant="gold">8 Ball Revival</Badge>
  return null
}

export function SearchResultCard({ result }: { result: SearchResult }) {
  return (
    <Link href={result.href} className="group block">
      <Card className="transition-colors group-hover:border-gold/40">
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-medium transition-colors group-hover:text-gold">
                {result.title}
              </span>
              <Badge variant="outline">{TYPE_LABEL[result.type]}</Badge>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{result.subtitle}</p>
            {result.matchedAlias && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                matched alias: <span className="text-foreground">{result.matchedAlias}</span>
              </p>
            )}
          </div>
          <StatusBadgeFor badge={result.badge} />
        </CardContent>
      </Card>
    </Link>
  )
}
