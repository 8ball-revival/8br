import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

import { pageMetadata } from '@/lib/site'
import { Container } from '@/components/ui/container'
import { getPlayerProfile, getUnrankedHistory } from '@/lib/stats/ladder'
import { UnrankedBadge } from '@/components/platform/platform-badge'
import { PlayerProfile } from '@/components/rankings/player-profile'

export const dynamic = 'force-dynamic'

type Params = Promise<{ cueverse: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { cueverse } = await params
  const handle = decodeURIComponent(cueverse)
  return pageMetadata({
    title: handle,
    description: `Public 8 Ball Registry profile for ${handle} — Rating, rank, and competitive record.`,
    path: `/players/${encodeURIComponent(cueverse)}`,
    index: false,
  })
}

export default async function PlayerProfilePage({
  params, searchParams,
}: {
  params: Params
  searchParams: Promise<{ platform?: string }>
}) {
  const { cueverse } = await params
  const sp = await searchParams
  /*
   * One identity, three records.
   *
   * CueVerse Career is the default and the most prominent, because it is the present. Yahoo Archive
   * is the ranked history from the old platform, replayed separately. Unranked History is Division
   * B: real matches, real champions, and no contribution to either ladder.
   */
  const platform = sp.platform?.toUpperCase() === 'YAHOO' ? 'YAHOO' : 'CUEVERSE'
  const id = decodeURIComponent(cueverse)
  const [profile, unranked] = await Promise.all([
    getPlayerProfile(id, new Date(), platform),
    getUnrankedHistory(id),
  ])
  if (!profile) notFound()

  // A merged secondary has no independent public profile — send visitors to the primary it now
  // belongs to, so old links and bookmarks keep working.
  const { primaryOfMergedPlayer } = await import('@/lib/players/merge')
  const primary = await primaryOfMergedPlayer(profile.playerId)
  if (primary) redirect(`/players/${encodeURIComponent(primary.cueverseId ?? primary.playerId)}`)

  return (
    <Container className="py-8">
      <Link href="/rankings" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-brand">
        <ArrowLeft className="size-4" /> Rankings
      </Link>
      {/* The career being read. Two tabs, not a merge: a combined rating would be neither. */}
      <div role="group" aria-label="Career" className="mb-4 inline-flex overflow-hidden rounded-md border border-border">
        {(['CUEVERSE', 'YAHOO'] as const).map((pf) => (
          <Link
            key={pf}
            href={`/players/${encodeURIComponent(cueverse)}${pf === 'YAHOO' ? '?platform=yahoo' : ''}`}
            aria-current={platform === pf ? 'page' : undefined}
            className={
              'px-3 py-1.5 text-sm transition-colors '
              + (platform === pf ? 'bg-[var(--gold)] font-semibold text-black' : 'text-muted-foreground hover:text-foreground')
            }
          >
            {pf === 'CUEVERSE' ? 'CueVerse Career' : 'Yahoo Archive'}
          </Link>
        ))}
      </div>

      <PlayerProfile profile={profile} />

      {unranked.length > 0 && (
        /*
         * Below both ranked careers, and clearly labelled. These Seasons are real and worth showing
         * — somebody played them and somebody won them — but nothing here reaches a rating, and the
         * heading says so rather than leaving it to be inferred from an absent number.
         */
        <section className="mt-8" aria-labelledby="unranked-history">
          <div className="mb-2 flex flex-wrap items-baseline gap-2">
            <h2 id="unranked-history" className="font-display text-lg font-bold text-foreground">Unranked History</h2>
            <UnrankedBadge />
            <p className="text-xs text-muted-foreground">
              Recorded in full. Contributes to no rating, rank, streak or ranked appearance.
            </p>
          </div>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {unranked.map((u) => (
              <li key={u.seasonId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <Link href={`/seasons/${u.seasonId}`} className="font-medium text-foreground hover:text-[var(--gold)]">
                  {u.competitionYear} Season {u.number}
                </Link>
                {u.division && <span className="text-xs text-muted-foreground">Division {u.division}</span>}
                <span className="text-xs text-muted-foreground">{u.lifecycleState}</span>
                {u.isChampion && <span className="text-xs font-semibold text-[var(--gold)]">Champion</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </Container>
  )
}
