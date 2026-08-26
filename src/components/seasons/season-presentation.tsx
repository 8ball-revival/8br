import { Trophy } from 'lucide-react'

import { type SeasonState } from '@/lib/seasons/shared'
import { SeasonStandingsMatrix } from '@/components/seasons/season-standings-matrix'
import type { StageGroup } from '@/lib/seasons/views'
import { CommandDeck } from '@/components/command-deck'

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
}: {
  groups: StageGroup[]
  groupStageGames: number
  qualified: Set<number>
  state: SeasonState
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
   * The readout above the tables.
   *
   * Every one of these numbers was already on the page, spread across eight tables — how far the
   * stage has got could only be worked out by scrolling and counting. Hoisting them into the deck
   * answers "where is this up to" before any table is read, and it is the same readout the bracket
   * and the ladder use, so the answer is always in the same place.
   */
  const matches = groups.flatMap((g) => g.matches)
  const played = matches.filter((m) => m.status !== 'SCHEDULED').length
  const players = groups.reduce((n, g) => n + g.standings.length, 0)

  return (
    <>
      <CommandDeck
        eyebrow="Group Stage"
        title="Groups"
        stats={[
          { label: 'Groups', value: groups.length },
          { label: 'Players', value: players },
          { label: 'Matches', value: `${played}/${matches.length}` },
          { label: 'Qualified', value: qualified.size },
        ]}
      />
      <div className="flex flex-col gap-7">
        {groups.map((g) => (
          <SeasonStandingsMatrix
            key={g.id}
            group={g}
            groupStageGames={groupStageGames}
            qualified={qualified}
          />
        ))}
      </div>
    </>
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
