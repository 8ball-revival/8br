import { Trophy } from 'lucide-react'

import { type SeasonState } from '@/lib/seasons/shared'
import { SeasonStandingsMatrix } from '@/components/seasons/season-standings-matrix'
import type { StageGroup } from '@/lib/seasons/views'

/**
 * The body of a Season: the group matrices, or the playoff bracket's stand-in when there is not one
 * to show yet. The masthead above it is `season-masthead`.
 *
 * Everything here is rendered from the registry row it is handed. A Season is public from the
 * moment it is created — there is no separate draft/publish switch — so this has to read well at
 * every stage, from "registration is open and there is nothing to show yet" through to a closed
 * Season with a champion.
 */

/** The Groups view: one matrix per published group, stacked full width. */
export function SeasonGroupsView({
  groups,
  groupStageGames,
  qualified,
  state,
  seasonId,
  canManage = false,
}: {
  groups: StageGroup[]
  groupStageGames: number
  qualified: Set<number>
  state: SeasonState
  seasonId?: number
  /** Staff only: enables the per-group rename control in each table header. */
  canManage?: boolean
}) {
  if (groups.length === 0) {
    return (
      <EmptyPanel
        title="Groups Not Published Yet"
        body={
          state === 'REGISTRATION_OPEN' || state === 'REGISTRATION_SCHEDULED'
            ? 'Registration is still open. Group tables appear here as soon as the groups are published.'
            : 'The groups are being set up. They appear here as soon as they are published.'
        }
      />
    )
  }
  return (
    <div className="flex flex-col gap-7">
      {groups.map((g) => (
        <SeasonStandingsMatrix
          key={g.id}
          group={g}
          groupStageGames={groupStageGames}
          qualified={qualified}
          seasonId={seasonId}
          canManage={canManage}
        />
      ))}
    </div>
  )
}

/**
 * Shown when Playoffs is selected on a Season that has not produced a public bracket yet.
 *
 * The toggle stays live either way — being told plainly that the groups are still running is more
 * use than a control that silently refuses to work.
 */
export function GroupsStillInProgress() {
  return (
    <div className="flex min-h-[16rem] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-6 py-14 text-center">
      <Trophy className="size-6 text-[var(--gold-dim)]" aria-hidden />
      <p className="font-display text-xl font-bold text-foreground">Groups Still In Progress</p>
      <p className="max-w-md text-sm text-muted-foreground">
        The playoff bracket appears here once the group stage is complete and the bracket is published.
      </p>
    </div>
  )
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-[14rem] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <p className="font-display text-lg font-bold text-foreground">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
    </div>
  )
}
