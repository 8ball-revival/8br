import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { Wide } from '@/components/primitives'
import { requireCreator } from '@/lib/creator/access'
import { listAllCompetitions } from '@/lib/competitions/service'
import { currentCompetitionYear } from '@/lib/competition/competition-year'
import { TournamentCreateForm } from '@/components/creator/tournament-create-form'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'New Tournament · Creator', robots: { index: false } }

/** Create a Tournament. Every format the canonical engine supports, and nothing it does not. */
export default async function NewTournamentPage() {
  await requireCreator()
  const competitions = (await listAllCompetitions()).map((c) => ({ id: c.id, name: c.name }))

  return (
    <Wide name="creator" className="py-6">
      <Link
        href="/creator"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
      >
        <ArrowLeft className="size-4" aria-hidden /> Back to Creator
      </Link>
      <h1 className="mt-3 font-display text-2xl font-bold tracking-tight">Create New Tournament</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Choose the format and who plays. Entrants come next.
      </p>
      <div className="mt-6">
        <TournamentCreateForm competitions={competitions} defaultYear={currentCompetitionYear()} />
      </div>
    </Wide>
  )
}
