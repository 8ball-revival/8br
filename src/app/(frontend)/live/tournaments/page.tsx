import type { Metadata } from 'next'

import { Wide } from '@/components/primitives'
import { CompetitionCardView } from '@/components/competition/competition-card'
import { getLiveTournaments } from '@/lib/competition/surface'
import { pageMetadata } from '@/lib/site'

// Live must reflect the moment. A completed competition has to leave this page immediately, not
// when a cache happens to expire, so this page is never cached.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata: Metadata = pageMetadata({
  title: 'Live Tournaments',
  description: 'Tournaments currently under way at the 8 Ball Registry.',
  path: '/live/tournaments',
})

/** Seasons under way. Viewing only — every management control lives in Creator. */
export default async function LiveSeasonsPage() {
  const cards = await getLiveTournaments()
  return (
    <Wide name="live-tournaments" className="py-6">
      <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Live Tournaments</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Tournaments with registration open or play under way.
      </p>

      {cards.length === 0 ? (
        <p className="mt-8 rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          No Tournaments are running right now. Completed Tournaments are in the{' '}
          <a href="/archives/tournaments" className="text-[var(--gold)] hover:underline">Archives</a>.
        </p>
      ) : (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {cards.map((c) => <CompetitionCardView key={c.id} card={c} live />)}
        </div>
      )}
    </Wide>
  )
}
