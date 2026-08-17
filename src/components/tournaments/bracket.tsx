'use client'

import type { CSSProperties } from 'react'
import Link from 'next/link'
import { Check, Crown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BracketMatch, BracketRound, BracketSlot } from '@/lib/tournaments/service'
import { TeamName } from './team-popover'
import { identityLines, fromNameHandle } from '@/lib/identity/display'

/** Optional admin inline-edit API for the SEASON live playoff bracket. Tournaments never pass this,
 *  so their brackets stay read-only and unchanged. */
/**
 * Click-to-swap on a DRAFT bracket. Click one slot to pick it up, click another to swap the two.
 *
 * Optional everywhere: tournaments and published season brackets pass nothing and stay read-only.
 */
export interface BracketSwapApi {
  selected: { matchId: number; side: 'home' | 'away' } | null
  pick(matchId: number, side: 'home' | 'away'): void
}

export interface BracketEditApi {
  draft(matchId: number): { home: string; away: string }
  set(matchId: number, side: 'home' | 'away', value: string): void
  dirty(matchId: number): boolean
  saving(matchId: number): boolean
  error(matchId: number): string | null
  save(matchId: number): void
}

function Slot({ slot, won, dim, champion, edit, swap, matchId, side }: { slot?: BracketSlot; won?: boolean; dim?: boolean; champion?: boolean; edit?: BracketEditApi; swap?: BracketSwapApi; matchId?: number; side?: 'home' | 'away' }) {
  // The CueVerse ID is what tells competitors apart (the archive has two Mikes in one group and
  // several different Chis), so it is the line that leads; the preferred name sits beneath it.
  const lines = identityLines(fromNameHandle(slot))
  const label = slot ? lines.primary : 'TBD'
  const hasMembers = !!slot?.members?.length
  const editable = !!edit && matchId != null && side != null && !!slot?.name && slot.name !== 'Bye'
  const swappable = !!swap && matchId != null && side != null && slot?.name !== 'Bye'
  const picked = !!swap?.selected && swap.selected.matchId === matchId && swap.selected.side === side
  return (
    <div
      role={swappable ? 'button' : undefined}
      tabIndex={swappable ? 0 : undefined}
      aria-pressed={swappable ? picked : undefined}
      title={swappable ? (picked ? 'Click another slot to swap' : `Move ${slot?.name ?? 'this slot'}`) : undefined}
      onClick={swappable ? () => swap!.pick(matchId!, side!) : undefined}
      onKeyDown={swappable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); swap!.pick(matchId!, side!) } } : undefined}
      className={cn(
        'flex items-center gap-2 px-2.5 py-2',
        won && 'bracket-winner-row bg-gold/[0.08]',
        dim && 'bracket-loser-row',
        !slot?.name && 'text-muted-foreground',
        swappable && 'cursor-pointer hover:bg-[color-mix(in_oklab,var(--gold)_12%,transparent)]',
        picked && 'ring-2 ring-[var(--gold)] ring-inset bg-[color-mix(in_oklab,var(--gold)_16%,transparent)]',
      )}
    >
      {slot?.seed != null && (
        <span className="tabular w-4 shrink-0 text-right text-[0.7rem] text-muted-foreground">{slot.seed}</span>
      )}
      {champion && (
        <Crown
          aria-label="Champion"
          className="size-4 shrink-0 fill-[var(--gold-soft)] text-[var(--gold-soft)] drop-shadow-[0_0_5px_color-mix(in_oklch,var(--gold)_75%,transparent)]"
        />
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
          // 1v1 slot: CueVerse ID on top, preferred name beneath it in italic when one exists and
          // differs from the ID. The whole name links to the player's profile (by CueVerse ID), the
          // same target the Rankings ladder uses.
          (() => {
            // An unfilled or bye slot reads as quiet placeholder text rather than a competitor.
            if (!slot?.name || slot.name === 'Bye') {
              return (
                <span className="block truncate text-[0.95rem] italic leading-tight text-muted-foreground">
                  {slot?.name === 'Bye' ? 'bye' : 'TBD'}
                </span>
              )
            }
            const nameEl = (
              <span className={cn(
                'block truncate text-[0.95rem] leading-snug',
                won ? 'font-bold text-gold' : dim ? 'font-medium text-foreground/75' : 'font-medium text-foreground',
              )}>
                {label}
              </span>
            )
            const subEl = slot && lines.secondary ? (
              <span className="block truncate text-[0.72rem] leading-tight text-muted-foreground">{lines.secondary}</span>
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
      {/* Admins editing the live Season bracket get a score input beside each confirmed player; members
          (and every Tournament bracket) see the plain read-only score. */}
      {editable ? (
        <input
          value={edit!.draft(matchId!)[side!]}
          onChange={(e) => edit!.set(matchId!, side!, e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); edit!.save(matchId!) } }}
          disabled={edit!.saving(matchId!)}
          inputMode="numeric"
          aria-label={`${label} score`}
          className={cn(
            'h-5 w-9 shrink-0 self-center rounded border bg-card/70 text-center text-[0.78rem] tabular outline-none focus-visible:border-brand disabled:opacity-50',
            edit!.dirty(matchId!) ? 'border-[var(--gold)] ring-1 ring-[var(--gold)]/40' : 'border-input',
          )}
        />
      ) : slot?.score != null ? (
        <span className={cn('tabular shrink-0 text-[0.95rem]', won ? 'font-bold text-gold' : 'font-medium text-foreground/70')}>{slot.score}</span>
      ) : null}
    </div>
  )
}

export function MatchBox({ match, edit, swap, isFinal }: { match: BracketMatch; edit?: BracketEditApi; swap?: BracketSwapApi;
  /** Last round of the bracket — its winner is the champion and gets the crown. */
  isFinal?: boolean }) {
  // Editable only when this is a real, both-sides-known Season playoff matchup.
  const bothKnown = !!match.a?.name && match.a.name !== 'Bye' && !!match.b?.name && match.b.name !== 'Bye'
  const canEdit = !!edit && match.id != null && bothKnown
  const matchId = match.id
  const dirty = canEdit && edit!.dirty(matchId!)
  const saving = canEdit && edit!.saving(matchId!)
  const err = canEdit ? edit!.error(matchId!) : null
  const decided = match.winner === 'a' || match.winner === 'b'
  return (
    <div className="w-full">
      {/* A plain bordered card. The winner is told by the gold name, the gold score and a faint gold
          wash on that row — the frame itself stays neutral, so a full bracket reads as a run of
          results rather than a grid of highlighted boxes. */}
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <Slot slot={match.a} won={match.winner === 'a'} dim={match.winner === 'b'} champion={isFinal && match.winner === 'a'} edit={canEdit ? edit : undefined} swap={swap} matchId={matchId} side="home" />
        <div className="h-px bg-border" />
        <Slot slot={match.b} won={match.winner === 'b'} dim={match.winner === 'a'} champion={isFinal && match.winner === 'b'} edit={canEdit ? edit : undefined} swap={swap} matchId={matchId} side="away" />
      </div>
      {canEdit && (dirty || err) && (
        <div className="mt-1 flex items-center justify-between gap-2">
          {err ? <span className="text-[0.6rem] text-destructive">{err}</span> : <span />}
          {dirty && (
            <button type="button" onClick={() => edit!.save(matchId!)} disabled={saving} aria-label="Save result" className="inline-flex items-center gap-1 rounded bg-[var(--gold)] px-1.5 py-0.5 text-[0.6rem] font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {saving ? <span className="size-2.5 animate-spin rounded-full border border-white/40 border-t-white" aria-hidden /> : <Check className="size-3" aria-hidden />} Save
            </button>
          )}
        </div>
      )}
      {/* The race length is worth stating while a tie is still to be played; once it is decided the
          score says everything, and repeating it under every box only makes the bracket taller. */}
      {((!decided && match.raceLength != null && (match.a || match.b)) || match.note) && (
        <div className="mt-0.5 flex items-center justify-center gap-2 text-[0.5rem] uppercase tracking-wide text-muted-foreground/80">
          {!decided && match.raceLength != null && (match.a || match.b) && <span>Race to {match.raceLength}</span>}
          {match.note && <span>{match.note}</span>}
        </div>
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
  edit,
  swap,
}: {
  rounds: BracketRound[]
  currentRound?: string
  /** Fill the available width (columns flex to fit) instead of fixed-width columns
   *  that scroll. Used by the wide tournament Playoffs canvas; tournaments keep fixed columns. */
  fluid?: boolean
  /** SEASON live playoffs only: enables admin inline score entry per matchup. */
  edit?: BracketEditApi
  /** SEASON draft bracket only: click one slot then another to swap them. */
  swap?: BracketSwapApi
}) {
  return (
    <div className="scrollbar-themed overflow-x-auto pb-2">
      <div className="bkt-tree" style={{ ['--bkt-col-max']: fluid ? '20rem' : '14rem' } as CSSProperties}>
        {rounds.map((round, ri) => {
          const active = currentRound && round.name.toLowerCase() === currentRound.toLowerCase()
          const isFirst = ri === 0
          const isLast = ri === rounds.length - 1
          return (
            <div key={ri} className="bkt-round">
              <p className={cn('eyebrow mb-3 text-center', active ? 'text-gold' : 'text-muted-foreground')}>
                {round.name}
              </p>
              {/* .bkt-feeds draws the outgoing elbow to the next round; .bkt-receives draws the incoming
                  stub. The first column only feeds, the last only receives; middles do both. */}
              <div className={cn('bkt-body', !isLast && 'bkt-feeds', !isFirst && 'bkt-receives')}>
                {round.matches.map((m, mi) => (
                  <div key={mi} className="bkt-cell">
                    <MatchBox match={m} edit={edit} swap={swap} isFinal={isLast} />
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
