import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, Trophy } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { Badge } from '@/components/ui/badge'
import { PlayerAvatar } from '@/components/home/primitives'
import { getTop10, getHofPlayer, formatSeasonId } from '@/lib/hall-of-fame/fixtures'

export const dynamicParams = false

export function generateStaticParams() {
  return getTop10().map((p) => ({ slug: p.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const p = getHofPlayer(slug)
  return {
    title: p ? `${p.name} — Hall of Fame` : 'Hall of Fame',
    alternates: { canonical: `/hall-of-fame/${slug}` },
  }
}

function seasonSort(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true })
}

export default async function HofPlayerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const player = getHofPlayer(slug)
  if (!player) return null // dynamicParams=false → unknown slugs 404

  const rank = getTop10().findIndex((p) => p.slug === slug) + 1
  const seasons = [...player.yearsWon].sort(seasonSort)

  return (
    <Container className="py-10">
      <Link
        href="/hall-of-fame"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Hall of Fame
      </Link>

      <div className="flex items-center gap-4">
        <PlayerAvatar name={player.name} size="xl" />
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{player.name}</h1>
            {rank > 0 && <Badge variant="gold">All-Time #{rank}</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{player.handle}</p>
        </div>
      </div>

      <div className="mt-6 flex items-center gap-2 rounded-lg border border-gold/25 bg-gold/[0.06] px-4 py-3">
        <Trophy className="size-5 text-gold" aria-hidden />
        <span className="tabular text-2xl font-bold text-gold">{player.titles}</span>
        <span className="text-sm text-muted-foreground">
          Season {player.titles === 1 ? 'Title' : 'Titles'} · group + season play only
        </span>
      </div>

      <section className="mt-8">
        <h2 className="eyebrow mb-4 text-foreground">Championship History</h2>
        <ol className="space-y-2">
          {seasons.map((s) => (
            <li key={s} className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-3">
              <Trophy className="size-4 shrink-0 text-gold" aria-hidden />
              <span className="text-sm font-medium text-foreground">{formatSeasonId(s)}</span>
              <span className="eyebrow ml-auto text-[0.55rem] text-muted-foreground">Champion</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-xs text-muted-foreground">
          Cup titles are tracked separately under Cups and are not counted here.
        </p>
      </section>
    </Container>
  )
}
