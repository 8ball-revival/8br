import { cn } from '@/lib/utils'
import type { BracketMatch, BracketRound, BracketSlot } from '@/lib/tournaments/service'
import { TeamName } from './team-popover'

function Slot({ slot, won, dim }: { slot?: BracketSlot; won?: boolean; dim?: boolean }) {
  const label = slot?.name ?? 'TBD'
  const hasMembers = !!slot?.members?.length
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2.5 py-1.5',
        won && 'bg-brand/[0.08]',
        !slot?.name && 'text-muted-foreground',
      )}
    >
      {slot?.seed != null && (
        <span className="tabular w-4 shrink-0 text-right text-[0.6rem] text-muted-foreground">{slot.seed}</span>
      )}
      <span className="min-w-0 flex-1">
        {hasMembers ? (
          // TEAM slot: show ONLY the team name (truncating); the roster/ratings/record live in the
          // hover/focus/click details popover so the row stays compact and scannable.
          <TeamName
            name={label}
            seed={slot!.seed}
            members={slot!.members!}
            record={slot!.record}
            avgRating={slot!.avgRating}
            won={won}
            dim={dim}
          />
        ) : (
          // 1v1 slot: CueVerse ID stays inline, no popover.
          <>
            <span className={cn('block truncate text-sm leading-tight', won ? 'font-semibold text-brand' : dim ? 'text-muted-foreground' : 'text-foreground')}>
              {label}
            </span>
            {slot?.handle && slot.handle !== slot.name && (
              <span className="block truncate text-[0.6rem] leading-tight text-muted-foreground">{slot.handle}</span>
            )}
          </>
        )}
      </span>
      {slot?.score != null && (
        <span className={cn('tabular self-start pt-0.5 text-sm', won ? 'font-bold text-brand' : 'text-muted-foreground')}>{slot.score}</span>
      )}
    </div>
  )
}

export function MatchBox({ match }: { match: BracketMatch }) {
  return (
    <div className="w-full">
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <Slot slot={match.a} won={match.winner === 'a'} dim={match.winner === 'b'} />
        <div className="h-px bg-border" />
        <Slot slot={match.b} won={match.winner === 'b'} dim={match.winner === 'a'} />
      </div>
      {match.note && (
        <p className="mt-1 text-center text-[0.55rem] uppercase tracking-wide text-muted-foreground">{match.note}</p>
      )}
    </div>
  )
}

/**
 * Single-elimination bracket — one template for every cup. Renders each round as
 * a column; the number of rounds/matches (and thus the width/height) scales with
 * the entrant count. Scrolls horizontally on small screens.
 */
export function Bracket({
  rounds,
  currentRound,
  fluid = false,
}: {
  rounds: BracketRound[]
  currentRound?: string
  /** Fill the available width (columns flex to fit) instead of fixed-width columns
   *  that scroll. Used by the wide tournament Playoffs canvas; tournaments keep fixed columns. */
  fluid?: boolean
}) {
  return (
    <div className="scrollbar-brand overflow-x-auto pb-2">
      <div className={cn('flex items-stretch', fluid ? 'min-w-full gap-2 sm:gap-3 xl:gap-4' : 'min-w-max gap-8')}>
        {rounds.map((round, ri) => {
          const active = currentRound && round.name.toLowerCase() === currentRound.toLowerCase()
          return (
            <div key={ri} className={cn('flex flex-col', fluid ? 'min-w-[9rem] flex-1' : 'w-52')}>
              <p className={cn('eyebrow mb-3 text-center', active ? 'text-brand' : 'text-muted-foreground')}>
                {round.name}
              </p>
              <div className="flex flex-1 flex-col justify-around gap-4">
                {round.matches.map((m, mi) => (
                  <MatchBox key={mi} match={m} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
