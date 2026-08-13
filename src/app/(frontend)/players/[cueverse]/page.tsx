import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, TrendingDown, TrendingUp } from 'lucide-react'

import { pageMetadata } from '@/lib/site'
import { Container } from '@/components/ui/container'
import { cn } from '@/lib/utils'
import { resolveIdentity } from '@/lib/stats/identity'
import { getPlayerRankingProfile, getAllTimeRankings } from '@/lib/stats/rankings'
import { tournamentStore, loadTournamentContext } from '@/lib/tournaments/prime'

type Params = Promise<{ cueverse: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { cueverse } = await params
  const handle = decodeURIComponent(cueverse)
  return pageMetadata({
    title: handle,
    description: `Public World Cue Championships profile for ${handle} — Ladder rating, rank, and competitive record.`,
    path: `/players/${cueverse}`,
  })
}

/** A single headline metric tile. */
function Stat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className={cn('text-2xl font-bold tabular-nums', accent ? 'text-brand' : 'text-foreground')}>{value}</div>
      <div className="mt-0.5 text-[0.65rem] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  )
}

export default async function PlayerProfilePage({ params }: { params: Params }) {
  const { cueverse } = await params
  const handle = decodeURIComponent(cueverse)

  tournamentStore.enterWith(await loadTournamentContext()) // prime the tournament snapshot before ranking reads
  const identity = resolveIdentity(handle, handle, { unknownAsSelf: true })
  if (!identity) notFound()

  const profile = getPlayerRankingProfile(identity.id)
  const all = getAllTimeRankings()
  const row = [...all.rows, ...(all.unranked ?? [])].find((r) => r.id === identity.id)

  // The display name (canonical) and the CueVerse ID the visitor arrived by.
  const displayName = row?.name ?? profile?.name ?? identity.name ?? handle
  const rating = row?.rating ?? null
  const rank = row && all.rows.some((r) => r.id === row.id) ? row.rank : null
  const wins = profile?.wins ?? row?.wins ?? 0
  const losses = profile?.losses ?? row?.losses ?? 0
  const draws = profile?.draws ?? row?.draws ?? 0
  const played = wins + losses + draws
  const winPct = played ? Math.round((wins / played) * 100) : 0
  const form = (profile?.recentForm ?? row?.recentForm ?? []).slice(0, 5)
  const trend = profile?.trend ?? row?.trend ?? 0

  return (
    <Container className="py-10">
      <Link href="/rankings" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-brand">
        <ArrowLeft className="size-4" /> Rankings
      </Link>

      <p className="eyebrow text-muted-foreground">Player</p>
      <h1 className="mt-1 font-display text-3xl font-bold tracking-tight sm:text-4xl">{displayName}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {displayName !== handle ? <>CueVerse ID · {handle}</> : 'CueVerse ID'}
      </p>

      {rating == null && played === 0 ? (
        <p className="mt-6 rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
          {handle} hasn&apos;t recorded any completed WCC tournament matches yet. Their Ladder rating appears
          here once results are in.
        </p>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Ladder Rating" value={rating != null ? Math.round(rating) : '—'} accent />
            <Stat label="All-Time Rank" value={rank != null ? `#${rank}` : 'Unranked'} />
            <Stat label="Record (W–L–D)" value={`${wins}–${losses}–${draws}`} />
            <Stat label="Win %" value={`${winPct}%`} />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-6 text-sm">
            {form.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Recent form</span>
                <span className="flex gap-1">
                  {form.map((r, i) => (
                    <span
                      key={i}
                      className={cn(
                        'flex size-5 items-center justify-center rounded text-[0.65rem] font-bold',
                        r === 'W' ? 'bg-success/20 text-success' : r === 'L' ? 'bg-destructive/20 text-destructive' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {r}
                    </span>
                  ))}
                </span>
              </div>
            )}
            {trend !== 0 && (
              <span className={cn('inline-flex items-center gap-1', trend > 0 ? 'text-success' : 'text-destructive')}>
                {trend > 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
                {trend > 0 ? '+' : ''}{Math.round(trend)} last event
              </span>
            )}
          </div>
        </>
      )}
    </Container>
  )
}
