import type { Metadata } from 'next'

import { Wide } from '@/components/primitives'
import { ArchiveBrowser } from '@/components/competition/archive-browser'
import { CompetitionCardView } from '@/components/competition/competition-card'
import { getLiveTournaments, getArchivedTournaments } from '@/lib/competition/surface'
import { pageMetadata } from '@/lib/site'

/*
 * A running Cup has to leave this page the moment it completes, not when a cache happens to expire,
 * so the page is not cached.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata: Metadata = pageMetadata({
  title: 'Cups',
  description: 'Cups at the 8 Ball Registry — running now, and every completed Cup.',
  path: '/cups',
})

const int = (v: string | undefined) => {
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.floor(n) : null
}

/**
 * Cups — one page for every Cup, running or finished.
 *
 * Previously this route only redirected to Archives, and a running Cup was somewhere else entirely.
 * Same reasoning as Seasons: one destination per competition type, leading with what is under way.
 *
 * Read-only. Every management control lives in Creator.
 */
export default async function CupsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const one = (k: string) => { const v = sp[k]; return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined }

  const [live, archive] = await Promise.all([
    getLiveTournaments(),
    getArchivedTournaments({
      competitionSeriesId: int(one('comp')),
      year: int(one('year')),
      search: one('q') ?? null,
      player: one('player') ?? null,
      sort: one('sort') === 'oldest' ? 'oldest' : 'newest',
      page: int(one('page')) ?? 1,
    }),
  ])

  return (
    <Wide name="cups" className="py-6">
      <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Cups</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Knockout competitions. Running Cups first, then the completed ones.
      </p>

      {live.length > 0 && (
        <section aria-labelledby="live-cups-heading" className="mt-6">
          <h2 id="live-cups-heading" className="font-display text-lg font-bold tracking-tight">
            Now Playing
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {live.map((c) => <CompetitionCardView key={c.id} card={c} live />)}
          </div>
        </section>
      )}

      <section aria-labelledby="completed-cups-heading" className="mt-8">
        <h2 id="completed-cups-heading" className="font-display text-lg font-bold tracking-tight">
          Completed
        </h2>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">
          Ordered by the year they were played.
        </p>
        <ArchiveBrowser page={archive} kind="cups" />
      </section>
    </Wide>
  )
}
