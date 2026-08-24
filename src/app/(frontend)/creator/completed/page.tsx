import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { Wide } from '@/components/primitives'
import { CompletedList } from '@/components/creator/completed-list'
import { requireCreator } from '@/lib/creator/access'
import { listCompleted } from '@/lib/creator/completed'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Completed records · Creator', robots: { index: false } }

const int = (v: string | undefined) => {
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.floor(n) : null
}

/**
 * Completed Seasons and Tournaments, for management.
 *
 * Filter and page state lives in the query string, so a view can be refreshed, shared and returned
 * to with the back button. The list is read-only: correcting a record happens on its own page,
 * behind a confirmation, so nothing here can change the record by accident.
 */
export default async function CreatorCompletedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireCreator()
  const sp = await searchParams
  const one = (k: string) => { const v = sp[k]; return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined }
  const type = one('type')

  const page = await listCompleted({
    type: type === 'seasons' || type === 'cups' ? type : 'all',
    competitionSeriesId: int(one('comp')),
    year: int(one('year')),
    division: one('division') ?? null,
    search: one('q') ?? null,
    sort: one('sort') === 'oldest' ? 'oldest' : 'newest',
    page: int(one('page')) ?? 1,
  })

  return (
    <Wide name="creator-completed" className="py-6">
      <Link
        href="/creator"
        className="mb-3 inline-flex items-center gap-1.5 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/60"
      >
        <ArrowLeft className="size-3.5" aria-hidden />Creator
      </Link>
      <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Completed records</h1>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">
        Everything that has been completed and finalised. These are in the public Archives and count
        towards the Rankings. Open one to correct it.
      </p>
      <CompletedList page={page} />
    </Wide>
  )
}
