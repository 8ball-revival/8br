import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { CreatorShell } from '@/components/creator/creator-shell'
import { CreatorSettings } from '@/components/creator/settings-panel'
import { TournamentWorkspace } from '@/components/tournaments/tournament-workspace'
import { loadTournamentStage } from '@/lib/creator/tournament-stage'
import { updateRecordDisplayAction } from '@/lib/creator/settings-actions'
import { updateTournamentDetailsAction } from '@/lib/creator/record-details'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getTournamentWorkspace } from '@/lib/tournaments/live'
import { getTournamentHistory } from '@/lib/competition/tournament-lifecycle'
import { tournamentStore, loadTournamentContext } from '@/lib/tournaments/prime'
import type { StageId } from '@/lib/creator/workflow'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Tournament · Creator', robots: { index: false } }

/**
 * Every Tournament stage, on its own URL, rendering the canonical workspace.
 *
 * ── One page, not seven ──────────────────────────────────────────────────────────────────────────
 * Setup, entrants, teams, groups, swiss, playoffs and complete are the same workspace entered at
 * different tabs. Seven near-identical files would each load the same data and differ by one string,
 * and they would drift. A single dynamic segment keeps the URLs the specification asks for and one
 * place to change when the workspace does.
 *
 * ── The stage guard is the loader's ──────────────────────────────────────────────────────────────
 * `loadTournamentStage` refuses a stage this record has not reached and redirects to the one it has,
 * exactly as the Season loader does — so /swiss on a single-elimination Tournament lands somewhere
 * useful instead of rendering an empty page.
 */

/** Creator stage → the workspace tab that does that work. */
const TAB_FOR: Record<string, 'overview' | 'roster' | 'groups' | 'swiss' | 'bracket' | 'results' | 'settings'> = {
  setup: 'overview',
  entrants: 'roster',
  teams: 'roster',
  groups: 'groups',
  swiss: 'swiss',
  playoffs: 'bracket',
  complete: 'results',
}

const STAGE_IDS = new Set(['setup', 'entrants', 'teams', 'groups', 'swiss', 'playoffs', 'complete'])

export default async function CreatorTournamentStagePage({
  params,
}: {
  params: Promise<{ id: string; stage: string }>
}) {
  const { id, stage } = await params
  if (!STAGE_IDS.has(stage)) notFound()

  // The live TournamentView revision has to be resolved before the workspace data is read; see the
  // note in lib/tournaments/context about why this must be inlined in the page frame.
  tournamentStore.enterWith(await loadTournamentContext())

  /*
   * `teams` is not a workflow stage — it is the roster tab under a different name, offered only for
   * a team Tournament. Mapping it to `entrants` for the reachability check keeps the workflow bar
   * honest while still giving teams their own URL.
   */
  const asked = (stage === 'teams' ? 'entrants' : stage) as StageId
  const ctx = await loadTournamentStage(id, asked)
  if (stage === 'teams' && !ctx.isTeam) notFound()

  const access = await resolveStaffAccess()
  const canManage = access.status === 'ok' && access.actor.can('manage_competitions')
  const canEditResults = access.status === 'ok' && access.actor.can('edit_results')
  const isOwner = access.status === 'ok' && access.actor.isOwner

  const ws = ctx.number != null ? await getTournamentWorkspace(ctx.number) : null

  return (
    <CreatorShell
      kind="tournament"
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
            return updateRecordDisplayAction('tournament', ctx.id, patch)
          }}
          onSaveDetails={async (patch) => {
            'use server'
            return updateTournamentDetailsAction(ctx.id, patch)
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
      {ws ? (
        <TournamentWorkspace
          data={ws}
          canManage={canManage}
          canEditResults={canEditResults}
          isOwner={isOwner}
          history={await getTournamentHistory(ctx.id, { admin: true })}
          initialTab={TAB_FOR[stage]}
        />
      ) : (
        <p className="cyber-clip border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          This Tournament has no live workspace yet. It may be an imported record whose data lives in
          the archive snapshot rather than in the live tables.
        </p>
      )}
    </CreatorShell>
  )
}
