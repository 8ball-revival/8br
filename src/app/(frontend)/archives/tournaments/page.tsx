import type { Metadata } from 'next'

import { Wide } from '@/components/primitives'
import { ArchiveBrowser } from '@/components/competition/archive-browser'
import { getArchivedTournaments } from '@/lib/competition/surface'
import { pageMetadata } from '@/lib/site'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = pageMetadata({
  title: 'Archived Tournaments',
  description: 'Every completed Tournament in the 8 Ball Registry.',
  path: '/archives/tournaments',
})

const int = (v: string | undefined) => {
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.floor(n) : null
}

/** Completed Tournaments. Read-only, like the rest of Archives. */
export default async function ArchivedTournamentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const one = (k: string) => { const v = sp[k]; return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined }

  const page = await getArchivedTournaments({
    year: int(one('year')),
    search: one('q') ?? null,
    player: one('player') ?? null,
    sort: one('sort') === 'oldest' ? 'oldest' : 'newest',
    page: int(one('page')) ?? 1,
  })

  return (
    <Wide name="archives-tournaments" className="py-6">
      <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Archived Tournaments</h1>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">
        Completed Tournaments, ordered by the year they were played.
      </p>
      <ArchiveBrowser page={page} kind="tournaments" />
    </Wide>
  )
}
