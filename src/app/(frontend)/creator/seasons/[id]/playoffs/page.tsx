import type { Metadata } from 'next'
import Link from 'next/link'

import { CreatorShell } from '@/components/creator/creator-shell'
import { CreatorSettings } from '@/components/creator/settings-panel'
import { PlayoffWorkspace } from '@/components/creator/playoff-workspace'
import { EnterPlayoffsButton } from '@/components/seasons/enter-playoffs-button'
import { SeasonLiveBracket } from '@/components/seasons/season-live-bracket'
import { loadSeasonStage } from '@/lib/creator/season-stage'
import { updateRecordDisplayAction } from '@/lib/creator/settings-actions'
import { loadSeasonSeeding, seasonPlayoffRounds } from '@/lib/seasons/playoffs'
import { bracketTopology, startReadiness } from '@/lib/seasons/playoff-topology'
import { playoffBracketAvailability, placementAvailability } from '@/lib/archive/auto-playoffs'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Playoffs · Creator', robots: { index: false } }

/**
 * Playoffs: the field, the draw, and the moment it becomes public.
 *
 * ── Three states, one route ──────────────────────────────────────────────────────────────────────
 * A Season with closed groups has not entered playoff setup yet and needs one deliberate step to do
 * so; a Season in setup gets the workspace; a live one gets the published bracket read-only, because
 * entering results belongs to the next stage rather than to this one.
 *
 * ── Readiness is computed here AND again at Start ────────────────────────────────────────────────
 * What this page renders is an explanation. The check that decides anything runs inside the
 * publishing transaction — see startSeasonPlayoffs.
 */
export default async function SeasonPlayoffsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params
  const ctx = await loadSeasonStage(raw, 'playoffs')
  const state = ctx.lifecycleState

  const settings = (
    <CreatorSettings
      summary={ctx.settings}
      onSaveDisplay={async (patch) => {
        'use server'
        return updateRecordDisplayAction('season', ctx.id, patch)
      }}
    />
  )
  const shell = (children: React.ReactNode) => (
    <CreatorShell
      kind="season"
      title={ctx.title}
      summary={ctx.summary}
      status={ctx.status}
      workflow={ctx.workflow}
      publicHref={ctx.publicHref}
      settings={settings}
      actions={
        <Link
          href="/creator"
          className="inline-flex items-center rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-brand/40 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
        >
          Save and Exit
        </Link>
      }
    >
      {children}
    </CreatorShell>
  )

  // ── Groups closed: one step into setup ────────────────────────────────────────────────────────
  if (state === 'GROUPS_CLOSED') {
    return shell(
      <div className="rounded-lg border border-border bg-card/40 p-5">
        <h2 className="font-display text-lg font-bold text-foreground">Ready for the playoffs</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          The group stage is closed and the standings are locked. Entering playoff setup selects every
          eligible entrant to begin with, so a reconstructed Season is a matter of unticking whoever
          did not play rather than finding everyone who did. Nothing becomes public at this step.
        </p>
        <div className="mt-4">
          <EnterPlayoffsButton seasonId={ctx.id} />
        </div>
      </div>,
    )
  }

  // ── Live: the published bracket, read-only here ───────────────────────────────────────────────
  if (state === 'PLAYOFFS_LIVE' || state === 'COMPLETED') {
    const rounds = await seasonPlayoffRounds(ctx.id)
    return shell(
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          The bracket is published and public. Score entry and Season completion arrive with the next
          Creator stage; results can still be recorded on the Season page in the meantime.
        </p>
        <div className="season-bracket">
          <SeasonLiveBracket rounds={rounds} canManage={false} />
        </div>
      </div>,
    )
  }

  // ── Setup: the workspace ──────────────────────────────────────────────────────────────────────
  const [seeding, topology, readiness, season, autoPlayoffs, autoPlacement] = await Promise.all([
    loadSeasonSeeding(ctx.id),
    bracketTopology(ctx.id),
    startReadiness(ctx.id),
    prisma.season.findUniqueOrThrow({ where: { id: ctx.id }, select: { playoffDoubleElim: true } }),
    ctx.archiveTemplateKey ? playoffBracketAvailability(ctx.id) : Promise.resolve({ show: false, disabledReason: null }),
    ctx.archiveTemplateKey ? placementAvailability(ctx.id) : Promise.resolve({ show: false, disabledReason: null }),
  ])

  return shell(
    <PlayoffWorkspace
      seasonId={ctx.id}
      seeding={seeding}
      topology={topology}
      readiness={readiness}
      doubleElim={season.playoffDoubleElim}
      autoPlayoffs={autoPlayoffs}
      autoPlacement={autoPlacement}
    />,
  )
}
