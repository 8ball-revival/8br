import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

import { requireCreator } from '@/lib/creator/access'
import { STRUCTURES } from '@/lib/creator/setup'
import { listAllCompetitions } from '@/lib/competitions/service'
import { currentCompetitionYear } from '@/lib/competition/competition-year'
import { SetupForm } from '@/components/creator/setup-form'

export const metadata: Metadata = {
  title: 'Create a Season or Cup',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

/**
 * Creator setup.
 *
 * The gate runs here for itself rather than trusting a layout — see the note in `creator/access`.
 * The Competition list is read server-side so a client can never nominate a Competition that does
 * not exist; the action re-checks it regardless.
 */
export default async function CreatorNewPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>
}) {
  await requireCreator()
  const { type } = await searchParams
  const competitions = await listAllCompetitions()

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Link
        href="/creator"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Creator
      </Link>

      <h1 className="font-display text-2xl font-bold">Create a Season or Cup</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">
        A record is created empty. Nothing is published, and no results are invented — entrants and
        results are entered in the next step.
      </p>

      <SetupForm
        competitions={competitions.map((c) => ({ id: c.id, name: c.name }))}
        structures={STRUCTURES.map((s) => ({ ...s }))}
        initialType={type === 'cup' ? 'cup' : 'season'}
        currentYear={currentCompetitionYear()}
      />
    </div>
  )
}
