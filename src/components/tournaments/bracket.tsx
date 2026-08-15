import type { CSSProperties } from 'react'
import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BracketMatch, BracketRound, BracketSlot } from '@/lib/tournaments/service'
import { TeamName } from './team-popover'

function Slot({ slot, won, dim }: { slot?: BracketSlot; won?: boolean; dim?: boolean }) {
  const label = slot?.name ?? 'TBD'
  const hasMembers = !!slot?.members?.length
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2.5 py-2',
        won && 'bracket-winner-row',
        dim && 'bracket-loser-row',
        !slot?.name && 'text-muted-foreground',
      )}
    >
      {slot?.seed != null && (
        <span className="tabular w-4 shrink-0 text-right text-[0.72rem] text-muted-foreground/80">{slot.seed}</span>
      )}
      {/* Winner marker: only for a completed match's CONFIRMED winner (`won` derives from the
          authoritative match.winner, never from the scores). Decorative — the row already reads as the
          winner — so hidden from screen readers. Sits between the seed and the name. */}
      {won && slot?.name && (
        <CheckCircle2 aria-hidden="true" className="size-3.5 shrink-0" style={{ color: '#D6AE42' }} />
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
          // 1v1 slot: Preferred Name on top; the CueVerse ID sits beneath it in italic (only when a
          // preferred name has actually been chosen, i.e. it differs from the ID — otherwise the ID
          // is the single primary line and needs no italic echo). The whole name links to the player's
          // profile (by CueVerse ID), the same target the Rankings ladder uses.
          (() => {
            const nameEl = (
              <span className={cn(
                'block truncate text-[1.02rem] leading-snug tracking-tight',
                won ? 'font-bold text-foreground' : dim ? 'bracket-loser-name font-bold italic' : 'font-medium text-foreground',
              )}>
                {label}
              </span>
            )
            const subEl = slot?.handle && slot.handle !== slot.name ? (
              <span className={cn('block truncate text-[0.75rem] italic leading-tight', dim ? 'text-muted-foreground/70' : 'text-muted-foreground')}>{slot.handle}</span>
            ) : null
            const profile = slot?.slug ?? slot?.handle
            return profile ? (
              <Link href={`/players/${encodeURIComponent(profile)}`} className="block rounded outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-brand/50">
                {nameEl}
                {subEl}
              </Link>
            ) : (
              <>{nameEl}{subEl}</>
            )
          })()
        )}
      </span>
      {slot?.score != null && (
        <span className={cn('tabular self-start pt-0.5 text-[0.95rem]', won ? 'font-bold text-foreground' : dim ? 'text-foreground/70' : 'text-muted-foreground')}>{slot.score}</span>
      )}
    </div>
  )
}

export function MatchBox({ match }: { match: BracketMatch }) {
  return (
    <div className="w-full">
      {/* Frame is transparent (no card fill): only the WINNER row paints a dark background; the loser
          row stays see-through to the page. */}
      <div className="overflow-hidden rounded-md border border-border">
        <Slot slot={match.a} won={match.winner === 'a'} dim={match.winner === 'b'} />
        <div className="h-px bg-border" />
        <Slot slot={match.b} won={match.winner === 'b'} dim={match.winner === 'a'} />
      </div>
      <div className="mt-1 flex items-center justify-center gap-2 text-[0.55rem] uppercase tracking-wide text-muted-foreground">
        {match.raceLength != null && (match.a || match.b) && <span>Race to {match.raceLength}</span>}
        {match.note && <span>{match.note}</span>}
      </div>
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
    <div className="scrollbar-themed overflow-x-auto pb-2">
      <div className="bkt-tree" style={{ ['--bkt-col-max']: fluid ? '22rem' : '14rem' } as CSSProperties}>
        {rounds.map((round, ri) => {
          const active = currentRound && round.name.toLowerCase() === currentRound.toLowerCase()
          const isFirst = ri === 0
          const isLast = ri === rounds.length - 1
          return (
            <div key={ri} className="bkt-round">
              <p className={cn('eyebrow mb-3 text-center', active ? 'text-brand' : 'text-muted-foreground')}>
                {round.name}
              </p>
              {/* .bkt-feeds draws the outgoing elbow to the next round; .bkt-receives draws the incoming
                  stub. The first column only feeds, the last only receives; middles do both. */}
              <div className={cn('bkt-body', !isLast && 'bkt-feeds', !isFirst && 'bkt-receives')}>
                {round.matches.map((m, mi) => (
                  <div key={mi} className="bkt-cell">
                    <MatchBox match={m} />
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
