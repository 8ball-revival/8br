import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

import { Wide } from '@/components/primitives'
import { RecordDetail } from '@/components/creator/record-detail'
import { prisma } from '@/lib/prisma'
import { DraftForm } from '@/components/creator/draft-form'
import { listAllCompetitions } from '@/lib/competitions/service'
import { requireCreator } from '@/lib/creator/access'
import { completionReview } from '@/lib/competition/correction'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Season · Creator', robots: { index: false } }

/**
 * One Season inside Creator.
 *
 * Authorisation is re-checked here rather than left to an ancestor: a layout gate does not run for
 * this page's own data fetch, and this page's data is the record itself.
 *
 * The page is a READ. `completionReview` opens no transaction and writes nothing, so merely opening
 * a completed Season cannot move it, change the Rankings, or leave an audit trail suggesting
 * somebody did something they did not.
 */
export default async function CreatorSeasonPage({ params }: { params: Promise<{ id: string }> }) {
  await requireCreator()
  const { id: raw } = await params
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const review = await completionReview('season', id)
  if (!review) notFound()

  const row = await prisma.season.findUnique({
    where: { id },
    select: {
      lifecycleState: true, subtitle: true, competitionYear: true, competitionSeriesId: true,
      number: true, division: true, description: true, groupStageGames: true,
      earlyRaceTo: true, semifinalRaceTo: true, finalRaceTo: true, entrantsCount: true,
    },
  })
  const state = String(row?.lifecycleState ?? '')
  const finished = state === 'COMPLETED'

  // Only a record still being built gets an editing surface. A completed Season is corrected through
  // the reopen workflow, which is a deliberate act with its own confirmation — not a form that saves
  // as you type.
  const competitions = finished ? [] : await listAllCompetitions()

  /**
   * Where the work is right now.
   *
   * A record before its group stage needs its entrants, not its bracket, and offering every section
   * at every phase would send the operator to a page that has nothing on it yet. Each link goes to
   * the EXISTING management surface for that phase — Creator adds no second editor.
   */
  const sections = finished
    ? [
        { label: 'Setup', href: `/seasons/${id}/settings`, hint: 'Title, year, division, description, match format' },
        { label: 'Groups', href: `/seasons/${id}?view=groups`, hint: 'Group tables and group results' },
        { label: 'Playoffs', href: `/seasons/${id}?view=playoffs`, hint: 'Bracket placement and playoff results' },
      ]
    : [
        { label: 'Setup', href: `/seasons/${id}/settings`, hint: 'Title, year, division, description, match format' },
        { label: 'Entrants', href: `/seasons/${id}`, hint: 'Add entrants, then close entry to build the groups' },
        { label: 'Groups', href: `/seasons/${id}?view=groups`, hint: 'Group tables and group results' },
        { label: 'Playoffs', href: `/seasons/${id}?view=playoffs`, hint: 'Bracket placement and playoff results' },
      ]

  return (
    <Wide name="creator-season" className="py-6">
      <Link
        href={finished ? '/creator/completed' : '/creator'}
        className="mb-3 inline-flex items-center gap-1.5 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
      >
        <ArrowLeft className="size-3.5" aria-hidden />{finished ? 'Completed records' : 'Creator'}
      </Link>

      {!finished && row && (
        <div className="mb-5">
          <DraftForm
            seasonId={id}
            competitions={competitions.map((c) => ({ id: c.id, name: c.name }))}
            initial={{
              title: row.subtitle ?? '',
              competitionYear: String(row.competitionYear ?? ''),
              competitionSeriesId: String(row.competitionSeriesId ?? ''),
              number: String(row.number ?? ''),
              division: row.division ?? '',
              description: row.description ?? '',
              groupStageGames: String(row.groupStageGames ?? ''),
              earlyRaceTo: String(row.earlyRaceTo ?? ''),
              semifinalRaceTo: String(row.semifinalRaceTo ?? ''),
              finalRaceTo: String(row.finalRaceTo ?? ''),
            }}
            // Save and Continue goes to whatever this draft actually needs next: entrants while it
            // has none, otherwise the stage it has reached.
            continueHref={row.entrantsCount === 0 ? `/seasons/${id}` : `/seasons/${id}?view=groups`}
            continueLabel={row.entrantsCount === 0 ? 'Save and Continue to Entrants' : 'Save and Continue'}
          />
        </div>
      )}

      <RecordDetail
        review={review}
        publicHref={`/seasons/${id}`}
        // Corrections happen on the EXISTING management surfaces. There is no second Season editor:
        // building one would mean two places where a result can be changed, and two chances for
        // them to disagree.
        sections={sections}
      />
    </Wide>
  )
}
