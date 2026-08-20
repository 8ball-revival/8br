import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

import { pageMetadata } from '@/lib/site'
import { Container } from '@/components/ui/container'
import { getPlayerProfile } from '@/lib/stats/ladder'
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

export default async function PlayerProfilePage({ params }: { params: Params }) {
  const { cueverse } = await params
  const profile = await getPlayerProfile(decodeURIComponent(cueverse))
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
      <PlayerProfile profile={profile} />
    </Container>
  )
}
