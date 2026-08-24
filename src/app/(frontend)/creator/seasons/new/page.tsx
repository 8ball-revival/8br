import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { Wide } from '@/components/primitives'
import { requireCreator } from '@/lib/creator/access'
import { structuresForCreation } from '@/lib/creator/setup'
import { listAllCompetitions } from '@/lib/competitions/service'
import { currentCompetitionYear } from '@/lib/competition/competition-year'
import { SeasonCreateForm } from '@/components/creator/season-create-form'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'New Season · Creator', robots: { index: false } }

/**
 * Create a Season.
 *
 * The structure list comes from `structuresForCreation`, not from everything the database
 * recognises: Groups only is still valid history and is no longer an option.
 */
export default async function NewSeasonPage() {
  await requireCreator()
  const competitions = (await listAllCompetitions()).map((c) => ({ id: c.id, name: c.name }))
  const structures = structuresForCreation('season').map((s) => ({ id: s.id, label: s.label, hint: s.hint }))

  return (
    <Wide name="creator" className="py-6">
      <Link
        href="/creator"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/60"
      >
        <ArrowLeft className="size-4" aria-hidden /> Back to Creator
      </Link>
      <h1 className="mt-3 font-display text-2xl font-bold tracking-tight">Create New Season</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        A group stage into a playoff bracket. Entrants come next.
      </p>
      <div className="mt-6">
        <SeasonCreateForm
          competitions={competitions}
          structures={structures}
          defaultYear={currentCompetitionYear()}
        />
      </div>
    </Wide>
  )
}
