import { cn } from '@/lib/utils'
import type { BracketMatch, BracketRound, BracketSlot } from '@/lib/cups/fixtures'

function Slot({ slot, won, dim }: { slot?: BracketSlot; won?: boolean; dim?: boolean }) {
  const label = slot?.name ?? 'TBD'
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2.5 py-1.5',
        won && 'bg-gold/[0.08]',
        !slot?.name && 'text-muted-foreground',
      )}
    >
      {slot?.seed != null && (
        <span className="tabular w-4 text-right text-[0.6rem] text-muted-foreground">{slot.seed}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-sm leading-tight', won ? 'font-semibold text-gold' : dim ? 'text-muted-foreground' : 'text-foreground')}>
          {label}
        </span>
        {slot?.handle && slot.handle !== slot.name && (
          <span className="block truncate text-[0.6rem] leading-tight text-muted-foreground">{slot.handle}</span>
        )}
      </span>
      {slot?.score != null && (
        <span className={cn('tabular text-sm', won ? 'font-bold text-gold' : 'text-muted-foreground')}>{slot.score}</span>
      )}
    </div>
  )
}

function MatchBox({ match }: { match: BracketMatch }) {
  return (
    <div className="w-52">
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
export function Bracket({ rounds, currentRound }: { rounds: BracketRound[]; currentRound?: string }) {
  return (
    <div className="scrollbar-gold overflow-x-auto pb-2">
      <div className="flex min-w-max items-stretch gap-8">
        {rounds.map((round, ri) => {
          const active = currentRound && round.name.toLowerCase() === currentRound.toLowerCase()
          return (
            <div key={ri} className="flex flex-col">
              <p className={cn('eyebrow mb-3 text-center', active ? 'text-gold' : 'text-muted-foreground')}>
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
