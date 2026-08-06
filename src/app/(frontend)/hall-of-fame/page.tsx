import type { Metadata } from 'next'
import Link from 'next/link'
import { Trophy, ChevronRight } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/page-header'
import { pageMetadata } from '@/lib/site'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { PublicPlayerIdentity } from '@/components/identity/public-player-identity'
import { getAllChampions } from '@/lib/hall-of-fame/service'

export const metadata: Metadata = pageMetadata({
  title: 'Hall of Fame',
  description: 'Every Season champion in 8 Ball Revival history — click a champion for their group-stage and playoff record.',
  path: '/hall-of-fame',
})

export default function HallOfFamePage() {
  const champions = getAllChampions()

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Hall of Fame' }]}
        title="Hall of Fame"
        description="Every Season champion, ranked by titles won (Seasons only — Cups excluded). Select a champion to see their group-stage and playoff wins."
      />
      <Container className="py-12">
        {champions.length === 0 ? (
          <EmptyState
            icon={Trophy}
            title="No inductees yet"
            description="The Hall of Fame recognises Season champions. Once a season crowns its first champion, they will appear here."
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {champions.map((c, i) => (
              <li key={c.slug}>
                <Link
                  href={`/hall-of-fame/${c.slug}`}
                  className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-muted/40"
                >
                  <span className="tabular w-6 shrink-0 text-center text-sm font-semibold text-muted-foreground">
                    {i + 1}
                  </span>
                  <Trophy className="size-4 shrink-0 text-gold" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    <PublicPlayerIdentity preferredName={c.name} cueverseId={c.handle !== c.name ? c.handle : null} muted />
                  </span>
                  <Badge variant="gold">{c.titles === 1 ? 'Champion' : `${c.titles}× Champion`}</Badge>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Container>
    </>
  )
}
