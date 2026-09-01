import type { Metadata } from 'next'
import Link from 'next/link'

import { CreatorShell } from '@/components/creator/creator-shell'
import { CreatorSettings } from '@/components/creator/settings-panel'
import { PlayoffWorkspace } from '@/components/creator/playoff-workspace'
import { EnterPlayoffsButton } from '@/components/seasons/enter-playoffs-button'
import { ChampionBanner, NoBracketYet, ReviewWarning } from '@/components/creator/playoff-scoring'
import { SeasonPlayoffScoring } from '@/components/creator/season-playoff-scoring'
import { SeasonCompletion } from '@/components/creator/season-completion'
import { loadSeasonStage } from '@/lib/creator/season-stage'
import { updateRecordDisplayAction } from '@/lib/creator/settings-actions'
import { deleteSeasonAction } from '@/lib/seasons/actions'
import { loadSeasonSeeding, seasonChampion } from '@/lib/seasons/playoffs'
import { playoffScoringRounds, playoffNeedsReviewCount } from '@/lib/seasons/playoff-scoring-view'
import { completionReadiness } from '@/lib/seasons/close'
import { bracketTopology, startReadiness } from '@/lib/seasons/playoff-topology'
import { playoffBracketAvailability, placementAvailability } from '@/lib/archive/auto-playoffs'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/*
  Closing a competition replays the entire rating ledger inside one transaction — about five seconds
  today and growing with the archive. The Prisma timeout was raised to match (LEDGER_TX_OPTIONS);
  this raises the FUNCTION's limit so the lambda cannot be cut off first and leave the close half
  done. Two limits guard the same operation and both have to be big enough.
*/
export const maxDuration = 60
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
      deletionPlan={ctx.deletionPlan}
      onDelete={async (input) => {
        'use server'
        return deleteSeasonAction(ctx.id, input)
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
          className="inline-flex items-center cyber-clip-sm border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-brand/40 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
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
      <div className="rounded-none border border-border bg-card/40 p-5">
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

  // ── Live: the administrative scoring board ────────────────────────────────────────────────────
  if (state === 'PLAYOFFS_LIVE' || state === 'COMPLETED') {
    const [rounds, needsReview, champion, season, readiness] = await Promise.all([
      playoffScoringRounds(ctx.id),
      playoffNeedsReviewCount(ctx.id),
      seasonChampion(ctx.id),
      prisma.season.findUniqueOrThrow({ where: { id: ctx.id }, select: { finalsForfeit: true } }),
      completionReadiness(ctx.id),
    ])
    const completed = state === 'COMPLETED'

    return shell(
      <div className="space-y-3">
        {/*
          Completion sits at the top, not under the bracket.
          A 32-player draw is several screens tall, so the control that ends the Season was only
          reachable by scrolling past every match — including immediately after entering the Final
          score, which is exactly when it is wanted. Sticky, and to the right, where the other
          stage-ending actions live.
        */}
        {!completed && (
          <div className="sticky top-16 z-30 -mx-1 flex justify-end border-b border-border bg-background/95 px-1 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <SeasonCompletion seasonId={ctx.id} readiness={readiness} />
          </div>
        )}
        {champion && (
          <ChampionBanner
            champion={champion.championName}
            championCueverseId={champion.championCueverseId}
            runnerUp={champion.runnerUpName}
            runnerUpCueverseId={champion.runnerUpCueverseId}
            byForfeit={season.finalsForfeit}
          />
        )}
        {needsReview > 0 && <ReviewWarning count={needsReview} />}
        {completed && (
          <p className="rounded-none border border-border bg-card/40 px-3 py-2 text-xs text-muted-foreground">
            This Season is completed. Results are shown as recorded; correcting them happens through
            the correction workflow.
          </p>
        )}
        {rounds.length === 0 ? <NoBracketYet /> : <SeasonPlayoffScoring rounds={rounds} />}
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
