import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, Trophy } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { Badge } from '@/components/ui/badge'
import { PlayerAvatar } from '@/components/home/primitives'
import { Bracket } from '@/components/cups/bracket'
import { getCup, getCups, cupBracket } from '@/lib/cups/fixtures'

export const dynamicParams = false

export function generateStaticParams() {
  return getCups().map((c) => ({ number: String(c.number) }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ number: string }>
}): Promise<Metadata> {
  const { number } = await params
  const cup = getCup(Number(number))
  const title = cup ? `${cup.name} — Cup ${cup.number}` : 'Cup'
  return { title, alternates: { canonical: `/cups/${number}` } }
}

export default async function CupDetailPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params
  const cup = getCup(Number(number))
  if (!cup) return null // dynamicParams=false → unknown numbers 404 before here

  const live = cup.status === 'live'
  const rounds = cupBracket(cup)
  const shellOnly = !cup.bracket?.length

  return (
    <Container className="py-10">
      <Link
        href="/cups"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Cups
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <span className="eyebrow text-muted-foreground">Cup {cup.number}</span>
        <Badge variant="gold">{cup.format}</Badge>
        {live ? (
          <Badge variant="destructive">Live · {cup.currentRound ?? 'In progress'}</Badge>
        ) : (
          <Badge variant="muted">Completed</Badge>
        )}
        {cup.year && <span className="tabular text-sm text-muted-foreground">{cup.year}</span>}
      </div>

      <h1 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">{cup.name}</h1>

      {cup.champion && !live && (
        <div className="mt-4 inline-flex items-center gap-2.5 rounded-lg border border-gold/25 bg-gold/[0.06] px-4 py-2.5">
          <Trophy className="size-5 text-gold" aria-hidden />
          <PlayerAvatar name={cup.champion.name} size="sm" />
          <div>
            <p className="text-sm font-semibold text-foreground">
              {cup.champion.name}
              {cup.finalScore && <span className="ml-2 tabular text-xs font-normal text-muted-foreground">{cup.finalScore}</span>}
            </p>
            {cup.champion.handle && <p className="text-xs text-muted-foreground">{cup.champion.handle}</p>}
          </div>
          <span className="eyebrow ml-2 text-[0.55rem] text-gold">Champion</span>
        </div>
      )}

      <section className="mt-8">
        <h2 className="eyebrow mb-4 text-foreground">Bracket</h2>
        {rounds ? (
          <>
            <Bracket rounds={rounds} currentRound={cup.currentRound} />
            {shellOnly && (
              <p className="mt-3 text-xs text-muted-foreground">
                Bracket layout ({cup.entrants} entrants) — matchups and scores will populate as results are added.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Bracket not on record yet{cup.champion ? ` — ${cup.name} was won by ${cup.champion.name}.` : '.'}
          </p>
        )}
      </section>
    </Container>
  )
}
