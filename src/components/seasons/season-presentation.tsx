import { Diamond, Trophy } from 'lucide-react'

import { cn } from '@/lib/utils'
import { identityLines } from '@/lib/identity/display'
import { SEASON_STATE_LABEL, type SeasonState } from '@/lib/seasons/shared'
import { SeasonStandingsMatrix } from '@/components/seasons/season-standings-matrix'
import type { StageGroup } from '@/lib/seasons/views'

/**
 * The public face of a Season: header, metadata pills, champion callout, and then either the group
 * matrices or the playoff bracket.
 *
 * Everything here is rendered from the registry row it is handed. A Season is public from the
 * moment it is created — there is no separate draft/publish switch — so this has to read well at
 * every stage, from "registration is open and there is nothing to show yet" through to a closed
 * Season with a champion.
 */

export function SeasonHeadline({
  competitionName,
  number,
  year,
  subtitle,
  state,
  entrantsCount,
  groupCount,
  champion,
}: {
  competitionName: string
  number: number
  year: number
  subtitle: string | null
  state: SeasonState
  entrantsCount: number
  groupCount: number
  champion: { cueverseId: string | null; preferredName: string | null; runnerUp: string | null; finalScore: string | null } | null
}) {
  const champLines = champion ? identityLines({ cueverseId: champion.cueverseId, preferredName: champion.preferredName }) : null

  return (
    <header className="border-b border-border pb-5 pt-7">
      <p className="text-[0.62rem] font-extrabold uppercase tracking-[0.12em] text-[var(--gold)]">
        {competitionName}
      </p>
      <h1 className="mt-1.5 font-display text-3xl font-bold tracking-tight text-foreground">
        Season {number} <span className="text-[var(--gold)]">·</span> {year}
      </h1>
      {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}

      <div className="mt-3.5 flex flex-wrap gap-2">
        <Pill tone={state === 'COMPLETED' ? 'gold' : 'live'}>{SEASON_STATE_LABEL[state]}</Pill>
        <Pill>Entrants <b className="text-foreground">{entrantsCount}</b></Pill>
        {groupCount > 0 && <Pill>Groups <b className="text-foreground">{groupCount}</b></Pill>}
        {/* An unfinished Season is explicitly marked as not counting yet, because the Rankings
            boundary is invisible otherwise and people reasonably assume live results count. */}
        {state !== 'COMPLETED' && <Pill>Not yet counted towards Rankings</Pill>}
      </div>

      {champLines && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--gold-dim)] bg-gradient-to-r from-[color-mix(in_oklch,var(--gold)_9%,transparent)] to-transparent px-4 py-3">
          <Diamond className="size-5 fill-[var(--gold-soft)] text-[var(--gold-soft)]" aria-hidden />
          <div className="min-w-0">
            <p className="text-[0.6rem] font-extrabold uppercase tracking-[0.14em] text-[var(--gold)]">Season Champion</p>
            <p className="font-display text-lg font-bold text-foreground">{champLines.primary}</p>
            {champLines.secondary && <p className="text-xs text-muted-foreground">{champLines.secondary}</p>}
          </div>
          {champion?.runnerUp && (
            <p className="ml-auto text-sm text-muted-foreground">
              def. {champion.runnerUp}{champion.finalScore ? ` · ${champion.finalScore}` : ''}
            </p>
          )}
        </div>
      )}
    </header>
  )
}

function Pill({ children, tone }: { children: React.ReactNode; tone?: 'gold' | 'live' }) {
  return (
    <span className={cn(
      'whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[0.72rem]',
      tone === 'gold' ? 'border-[var(--gold-dim)] text-[var(--gold-soft)]'
        : tone === 'live' ? 'border-[var(--gold-dim)]/60 text-[var(--gold-soft)]'
          : 'border-border text-muted-foreground',
    )}>
      {children}
    </span>
  )
}

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
        <SeasonStandingsMatrix key={g.id} group={g} groupStageGames={groupStageGames} qualified={qualified} />
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
