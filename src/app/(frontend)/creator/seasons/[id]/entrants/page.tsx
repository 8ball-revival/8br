import type { Metadata } from 'next'
import Link from 'next/link'

import { CreatorShell } from '@/components/creator/creator-shell'
import { CreatorSettings } from '@/components/creator/settings-panel'
import { SeasonEntrantsBoard, type CreatorEntrant } from '@/components/creator/season-entrants-board'
import { prisma } from '@/lib/prisma'
import { loadSeasonStage } from '@/lib/creator/season-stage'
import { updateRecordDisplayAction } from '@/lib/creator/settings-actions'
import { autoEntrantsAvailability } from '@/lib/archive/auto-entrants'
import { seasonRatingsByPlayerId } from '@/lib/seasons/service'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Entrants · Creator', robots: { index: false } }

/**
 * Entrants: who is in this Season.
 *
 * ── The rating column is not the snapshot ────────────────────────────────────────────────────────
 * While registration is open this shows each entrant's CURRENT Rankings rating, which is what
 * closing will capture. Once it is closed the stored snapshot is shown instead, because that is what
 * the seeding actually used — continuing to show a live figure would mean the number on this page
 * quietly stopped being the number the draw was made from.
 */
export default async function SeasonEntrantsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params
  const ctx = await loadSeasonStage(raw, 'entrants')
  const isOpen = ctx.lifecycleState === 'REGISTRATION_OPEN'

  const rows = await prisma.seasonEntrant.findMany({
    where: { seasonId: ctx.id, status: { not: 'WITHDRAWN' } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true, playerId: true, displayName: true, username: true, cueverseId: true,
      ratingSnapshot: true,
    },
  })

  // Live ratings only while they still matter; a closed Season reads its own snapshot.
  const live = isOpen
    ? await seasonRatingsByPlayerId(rows.map((r) => r.playerId))
    : new Map<string, number>()

  const entrants: CreatorEntrant[] = rows.map((r) => ({
    entrantId: r.id,
    playerId: r.playerId,
    name: r.displayName ?? r.username,
    cueverseId: r.cueverseId,
    rating: isOpen
      ? (r.playerId ? live.get(r.playerId) ?? null : null)
      : r.ratingSnapshot,
  }))

  const auto = ctx.archiveTemplateKey
    ? await autoEntrantsAvailability(ctx.id)
    : { show: false, disabledReason: null }

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
      <SeasonEntrantsBoard
        seasonId={ctx.id}
        entrants={entrants}
        isOpen={isOpen}
        showAutoAdd={auto.show}
        autoAddDisabledReason={auto.disabledReason}
      />
    </CreatorShell>
  )
}
