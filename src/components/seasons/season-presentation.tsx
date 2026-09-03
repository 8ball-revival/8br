import { Trophy } from 'lucide-react'

import { type SeasonState, SEASON_STATE_LABEL } from '@/lib/seasons/shared'
import { GroupBoards } from '@/components/seasons/season-groups-view'
import { getGroupBoard } from '@/lib/seasons/group-board'
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

/** The Groups view: the season overview, the group navigation, and one board per published group. */
export async function SeasonGroupsView({
  seasonId,
  groups,
  groupStageGames,
  state,
  group,
}: {
  seasonId: number
  groups: StageGroup[]
  groupStageGames: number
  state: SeasonState
  /** `?group=` from the URL, validated below. Absent or unknown means every group. */
  group?: string | null
}) {
  if (groups.length === 0) {
    return (
      <EmptyPanel
        /*
         * Three different silences, told apart.
         *
         * "No groups yet" means something different before entry closes than after it. Once
         * registration is closed the field is settled and the delay is the draw being made, which is
         * a wait with an end — so the panel says that, rather than repeating a generic "not
         * published" that reads as though the Season has stalled.
         */
        title={
          state === 'REGISTRATION_CLOSED' || state === 'GROUP_SETUP'
            ? 'Registration Closed'
            : 'Groups Not Published Yet'
        }
        body={
          state === 'REGISTRATION_OPEN' || state === 'REGISTRATION_SCHEDULED'
            ? 'Registration is still open. Group tables appear here as soon as the groups are published.'
            : state === 'REGISTRATION_CLOSED' || state === 'GROUP_SETUP'
              ? 'Groups will be published shortly.'
              : 'The groups are being set up. They appear here as soon as they are published.'
        }
      />
    )
  }

  /*
   * Every figure the view shows, derived once on the server.
   *
   * The component below is a client one — it owns the group navigation and the board motion — and
   * it renders what it is handed. Nothing about a standing, a percentage or a clinch is decided in
   * the browser.
   */
  const board = await getGroupBoard(seasonId, groups, groupStageGames)

  /* Validated against the groups that actually exist, so `?group=Z` cannot produce an empty page. */
  const initialGroup = group && board.groups.some((g) => g.code === group) ? group : 'all'

  return (
    <GroupBoards
      board={board}
      initialGroup={initialGroup}
      status={{
        label: SEASON_STATE_LABEL[state] ?? 'In progress',
        note: STAGE_NOTE[state] ?? 'Group matches are being played and results appear as they are entered.',
        live: LIVE_STATES.has(state),
      }}
    />
  )
}

/** Whether the stage is currently running, for the status badge's colour. */
const LIVE_STATES = new Set<SeasonState>([
  'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'GROUP_SETUP', 'GROUP_STAGE_LIVE', 'GROUPS_CLOSED', 'PLAYOFF_SETUP', 'PLAYOFFS_LIVE',
])

/** A sentence for each stage, so the overview explains the badge beside it rather than repeating it. */
const STAGE_NOTE: Partial<Record<SeasonState, string>> = {
  REGISTRATION_SCHEDULED: 'Registration has not opened yet. Groups appear once the field is drawn.',
  REGISTRATION_OPEN: 'Registration is open. Group tables appear as soon as the groups are published.',
  REGISTRATION_CLOSED: 'The field is settled and the draw is being made.',
  GROUP_SETUP: 'The groups are being arranged and will be published shortly.',
  GROUP_STAGE_LIVE: 'Group matches are being played and results appear as they are entered. A champion appears here once the final is decided.',
  GROUPS_CLOSED: 'The group stage is complete. The playoff bracket follows shortly.',
  PLAYOFF_SETUP: 'The playoff field is being confirmed.',
  PLAYOFFS_LIVE: 'The playoffs are under way. These are the group tables they were seeded from.',
  COMPLETED: 'This Season is complete. These are its final group tables.',
}

/**
 * Shown when Playoffs is selected on a Season that has not produced a public bracket yet.
 *
 * The toggle stays live either way — being told plainly that the groups are still running is more
 * use than a control that silently refuses to work.
 */
export function GroupsStillInProgress() {
  return (
    <div className="flex min-h-[16rem] flex-col items-center justify-center gap-2 cyber-clip border border-dashed border-[var(--neon-line)] px-6 py-14 text-center">
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
    <div className="flex min-h-[14rem] flex-col items-center justify-center gap-2 cyber-clip border border-dashed border-[var(--neon-line)] px-6 py-12 text-center">
      <p className="font-display text-lg font-bold text-foreground">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
    </div>
  )
}
