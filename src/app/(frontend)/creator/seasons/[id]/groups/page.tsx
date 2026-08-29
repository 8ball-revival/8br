import type { Metadata } from 'next'
import Link from 'next/link'

import { CreatorShell } from '@/components/creator/creator-shell'
import { CreatorSettings } from '@/components/creator/settings-panel'
import { SeasonGroupSetup } from '@/components/seasons/season-group-setup'
import { SeasonGroupStage } from '@/components/seasons/season-group-stage'
import { UnsavedGroupsProvider } from '@/components/seasons/unsaved-groups'
import { GroupStageControls, GroupsClosedControls } from '@/components/creator/group-controls'
import { loadSeasonStage } from '@/lib/creator/season-stage'
import { updateRecordDisplayAction } from '@/lib/creator/settings-actions'
import { deleteSeasonAction } from '@/lib/seasons/actions'
import { getSeasonGroupSetup, getSeasonGroupStage } from '@/lib/seasons/views'
import { autoAssignAvailability } from '@/lib/archive/auto-assign'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Groups · Creator', robots: { index: false } }

/**
 * Groups: drafting them, playing them, and closing them.
 *
 * ── One route, three faces ───────────────────────────────────────────────────────────────────────
 * Setup, live and closed are three views of the same stage, not three places. A separate route per
 * lifecycle state would mean three URLs that each 404 for two thirds of a Season's life, and an
 * operator who has to know which one applies before they can navigate. The lifecycle already knows;
 * the route asks it.
 *
 * ── The boards are the existing ones ─────────────────────────────────────────────────────────────
 * `SeasonGroupSetup` and `SeasonGroupStage` are reused as they are, including the public group table
 * design. Creator supplies the frame and the stage-ending controls; it does not fork the tables.
 * A second group editor would be a second place a score can be changed.
 */
export default async function SeasonGroupsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params
  const ctx = await loadSeasonStage(raw, 'groups')
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
  const actions = (
    <Link
      href="/creator"
      className="inline-flex items-center cyber-clip-sm border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-brand/40 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
    >
      Save and Exit
    </Link>
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
      actions={actions}
    >
      {children}
    </CreatorShell>
  )

  // ── Drafting ──────────────────────────────────────────────────────────────────────────────────
  if (state === 'REGISTRATION_CLOSED' || state === 'GROUP_SETUP') {
    const [view, auto] = await Promise.all([
      getSeasonGroupSetup(ctx.id),
      ctx.archiveTemplateKey
        ? autoAssignAvailability(ctx.id, 'entrants')
        : Promise.resolve({ show: false, disabledReason: null }),
    ])
    return shell(
      <>
        <p className="mb-1 text-sm text-muted-foreground">
          Groups are private until you make the group stage live. Nothing here is visible on the
          Season page.
        </p>
        <SeasonGroupSetup seasonId={ctx.id} view={view} autoAssign={auto} />
      </>,
    )
  }

  // ── Playing, and closed ───────────────────────────────────────────────────────────────────────
  const live = state === 'GROUP_STAGE_LIVE'
  const closed = state === 'GROUPS_CLOSED'
  const [groups, auto, format] = await Promise.all([
    getSeasonGroupStage(ctx.id),
    live && ctx.archiveTemplateKey
      ? autoAssignAvailability(ctx.id, 'scores')
      : Promise.resolve({ show: false, disabledReason: null }),
    prisma.season.findUniqueOrThrow({ where: { id: ctx.id }, select: { groupStageGames: true } }),
  ])

  return shell(
    <UnsavedGroupsProvider>
      {live && <GroupStageControls seasonId={ctx.id} canClose />}
      {closed && <GroupsClosedControls seasonId={ctx.id} playoffsHref={`/creator/seasons/${ctx.id}/playoffs`} />}
      <SeasonGroupStage
        seasonId={ctx.id}
        groups={groups}
        groupStageGames={format.groupStageGames}
        autoAssign={auto}
        // Score entry belongs to the live stage only. A closed Season shows the same tables, read
        // only, so the final standings are still here to look at.
        canManage={live}
        // The stage-ending controls are Creator's, below — the board does not draw its own.
        canClose={false}
        canReopen={false}
      />
    </UnsavedGroupsProvider>,
  )
}
