import type { Metadata } from 'next'
import Link from 'next/link'

import { CreatorShell } from '@/components/creator/creator-shell'
import { CreatorSettings } from '@/components/creator/settings-panel'
import { DraftForm } from '@/components/creator/draft-form'
import { prisma } from '@/lib/prisma'
import { listAllCompetitions } from '@/lib/competitions/service'
import { loadSeasonStage } from '@/lib/creator/season-stage'
import { updateRecordDisplayAction } from '@/lib/creator/settings-actions'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Setup · Creator', robots: { index: false } }

/**
 * Setup: the record's own details.
 *
 * The editing form is the EXISTING `DraftForm`. Creator frames it rather than replacing it, because
 * a second Season editor would be a second place a title or a race length can be changed, and two
 * places that write the same field are two places that can disagree about what it says.
 */
export default async function SeasonSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params
  const ctx = await loadSeasonStage(raw, 'setup')

  const [row, competitions] = await Promise.all([
    prisma.season.findUniqueOrThrow({
      where: { id: ctx.id },
      select: {
        subtitle: true, competitionYear: true, competitionSeriesId: true, number: true,
        division: true, description: true, groupStageGames: true, earlyRaceTo: true,
        semifinalRaceTo: true, finalRaceTo: true,
      },
    }),
    listAllCompetitions(),
  ])

  return (
    <CreatorShell
      kind="season"
      title={ctx.title}
      summary={ctx.summary}
      status={ctx.status}
      workflow={ctx.workflow}
      publicHref={ctx.publicHref}
      settings={
        <CreatorSettings
          summary={ctx.settings}
          onSaveDisplay={async (patch) => {
            'use server'
            return updateRecordDisplayAction('season', ctx.id, patch)
          }}
        />
      }
      actions={
        <Link
          href="/creator"
          className="inline-flex items-center cyber-clip-sm border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-brand/40 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
        >
          Save and Exit
        </Link>
      }
    >
      <DraftForm
        seasonId={ctx.id}
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
        continueHref={`/creator/seasons/${ctx.id}/entrants`}
        continueLabel="Save and Continue to Entrants"
      />
    </CreatorShell>
  )
}
