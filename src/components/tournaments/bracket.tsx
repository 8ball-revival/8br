'use client'

import { useState } from 'react'

import type { CSSProperties } from 'react'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BracketMatch, BracketRound, BracketSlot } from '@/lib/tournaments/service'
import { TeamDetails } from './team-popover'
import {
  BracketCard, BracketIdentity, BracketRow, BracketRowDivider, BracketRoundHeading,
  BracketScore, BracketSeed, BracketTeamIdentity, rowAccessibleName, slotState,
} from '@/components/bracket/primitives'

/** Optional admin inline-edit API for the SEASON live playoff bracket. Tournaments never pass this,
 *  so their brackets stay read-only and unchanged. */
/**
 * Click-to-swap on a DRAFT bracket. Click one slot to pick it up, click another to swap the two.
 *
 * Optional everywhere: tournaments and published season brackets pass nothing and stay read-only.
 */
export interface BracketSwapApi {
  /** Drag-and-drop: move `from` onto `to`, exchanging them. Falls back to pick() when absent. */
  drop?: (from: { matchId: number; side: 'home' | 'away' }, to: { matchId: number; side: 'home' | 'away' }) => void
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

function Slot({ slot, won, edit, swap, matchId, side }: { slot?: BracketSlot; won?: boolean; edit?: BracketEditApi; swap?: BracketSwapApi; matchId?: number; side?: 'home' | 'away' }) {
  const label = slot?.name ?? 'TBD'
  const hasMembers = !!slot?.members?.length
  const editable = !!edit && matchId != null && side != null && !!slot?.name && slot.name !== 'Bye'
  // A bye is an empty slot, not a player. It can be dropped ONTO — that is how a player is moved into
  // one — but it can never be picked up, because there is nobody there to pick up.
  const occupied = !!slot?.name && slot.name !== 'Bye'
  const swappable = !!swap && matchId != null && side != null
  const movable = swappable && occupied
  const picked = !!swap?.selected && swap.selected.matchId === matchId && swap.selected.side === side

  /*
    Two ways to move a player, over the same swap call.

    Dragging is the one people reach for on a bracket, so it is the primary gesture: pick a slot up,
    drop it on another, they exchange places. Click-to-swap is kept rather than replaced — dragging
    does not exist on touch, and it is not reachable from a keyboard, so removing it would take the
    feature away from anyone not using a mouse.

    An empty slot is a valid drop target: dropping onto TBD, or onto a bye, is how you move somebody
    into a gap. Neither is draggable, because a gap is the absence of a player rather than one.
  */
  const [dragOver, setDragOver] = useState(false)
  const dragData = (e: React.DragEvent) => {
    try { return JSON.parse(e.dataTransfer.getData('application/x-bracket-slot') || 'null') } catch { return null }
  }

  const state = slotState(slot)

  return (
    <BracketRow
      role={swappable ? 'button' : undefined}
      tabIndex={swappable ? 0 : undefined}
      aria-pressed={swappable ? picked : undefined}
      draggable={movable}
      title={swappable
        ? picked ? 'Click another slot to swap'
          : movable ? `Drag to move ${slot!.name}, or click to pick it up`
            : 'Drop a player here, or click to pick this empty slot up'
        : undefined}
      onClick={swappable ? () => swap!.pick(matchId!, side!) : undefined}
      onKeyDown={swappable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); swap!.pick(matchId!, side!) } } : undefined}
      onDragStart={movable ? (e) => {
        e.dataTransfer.setData('application/x-bracket-slot', JSON.stringify({ matchId, side }))
        e.dataTransfer.effectAllowed = 'move'
      } : undefined}
      onDragOver={swappable ? (e) => {
        // preventDefault is what marks this element as a valid drop target at all.
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setDragOver(true)
      } : undefined}
      onDragLeave={swappable ? () => setDragOver(false) : undefined}
      onDragEnd={movable ? () => setDragOver(false) : undefined}
      onDrop={swappable ? (e) => {
        e.preventDefault()
        setDragOver(false)
        const from = dragData(e)
        if (!from || typeof from.matchId !== 'number') return
        // Dropping a slot on itself is a no-op rather than a wasted round trip to the server.
        if (from.matchId === matchId && from.side === side) return
        swap!.drop?.(from, { matchId: matchId!, side: side! })
      } : undefined}
      className={cn(
        swappable && 'cursor-copy',
        movable && 'cursor-grab active:cursor-grabbing',
        picked && 'ring-2 ring-[var(--bracket-focus)] ring-inset bg-[var(--bracket-surface-raised)]',
        dragOver && 'ring-2 ring-[var(--bracket-focus)] ring-inset bg-[var(--bracket-surface-raised)]',
      )}
      won={won}
      state={state}
      interactive={swappable}
      aria-label={rowAccessibleName(slot, state)}
    >
      <BracketSeed seed={slot?.seed} />
      <span className="min-w-0 flex-1">
        {hasMembers ? (
          /* A team carries its roster's CueVerse IDs on the row; the popover keeps ratings and
             record, which are detail rather than identity. */
          <BracketTeamIdentity
            slot={slot}
            won={won}
            extra={<TeamDetails name={label} seed={slot!.seed} members={slot!.members!} record={slot!.record} avgRating={slot!.avgRating} />}
          />
        ) : (
          <BracketIdentity slot={slot} won={won} state={state} />
        )}
      </span>
      {/* Admins editing the live Season bracket get a score input beside each confirmed player;
          members (and every Tournament bracket) see the plain read-only score. */}
      {editable ? (
        <input
          value={edit!.draft(matchId!)[side!]}
          onChange={(e) => edit!.set(matchId!, side!, e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); edit!.save(matchId!) } }}
          disabled={edit!.saving(matchId!)}
          inputMode="numeric"
          aria-label={`${label} score`}
          className={cn(
            'h-5 w-9 shrink-0 self-center rounded border bg-[var(--bracket-canvas)] text-center text-[0.78rem] tabular text-[var(--bracket-text)] outline-none focus-visible:border-[var(--bracket-focus)] disabled:opacity-50',
            edit!.dirty(matchId!) ? 'border-[var(--bracket-winner)] ring-1 ring-[var(--bracket-winner)]/40' : 'border-[var(--bracket-outline)]',
          )}
        />
      ) : (
        <BracketScore slot={slot} won={won} state={state} />
      )}
    </BracketRow>
  )
}

export function MatchBox({ match, edit, swap }: { match: BracketMatch; edit?: BracketEditApi; swap?: BracketSwapApi }) {
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
      {/* One card, two rows. The Final uses this same card: the gold path arriving at it is what
          makes the champion obvious, so it needs no crown, circle or halo of its own. */}
      <BracketCard>
        <Slot slot={match.a} won={match.winner === 'a'} edit={canEdit ? edit : undefined} swap={swap} matchId={matchId} side="home" />
        <BracketRowDivider />
        <Slot slot={match.b} won={match.winner === 'b'} edit={canEdit ? edit : undefined} swap={swap} matchId={matchId} side="away" />
      </BracketCard>
      {canEdit && (dirty || err) && (
        <div className="mt-1 flex items-center justify-between gap-2">
          {err ? <span className="text-[0.66rem] text-[var(--bracket-review)]">{err}</span> : <span />}
          {dirty && (
            <button type="button" onClick={() => edit!.save(matchId!)} disabled={saving} aria-label="Save result" className="inline-flex items-center gap-1 rounded bg-[var(--bracket-winner)] px-1.5 py-0.5 text-[0.66rem] font-semibold text-black hover:opacity-90 disabled:opacity-50">
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
    <div className="scrollbar-themed overflow-x-auto pb-2" role="group" aria-label="Bracket">
      <div className="bkt-tree" style={{ ['--bkt-col-max']: fluid ? '20rem' : '14rem' } as CSSProperties}>
        {rounds.map((round, ri) => {
          const active = currentRound && round.name.toLowerCase() === currentRound.toLowerCase()
          const isFirst = ri === 0
          const isLast = ri === rounds.length - 1
          return (
            <div key={ri} className="bkt-round">
              <BracketRoundHeading name={round.name} matchCount={round.matches.length} active={!!active} />
              {/* .bkt-feeds draws the outgoing elbow to the next round; .bkt-receives draws the incoming
                  stub. The first column only feeds, the last only receives; middles do both. */}
              <div className={cn('bkt-body', !isLast && 'bkt-feeds', !isFirst && 'bkt-receives')}>
                {round.matches.map((m, mi) => {
                  /*
                   * The connector either carries somebody or it does not.
                   *
                   * `data-advanced` says this match produced a winner, so its outgoing elbow is part
                   * of a real path. `data-fed` says a winner has arrived here, which is the same
                   * segment seen from the far end. A match still to be played sets neither and its
                   * connectors stay grey.
                   */
                  const decided = m.winner === 'a' || m.winner === 'b'
                  const fed = !isFirst && (!!m.a?.name || !!m.b?.name)
                  return (
                    <div
                      key={mi}
                      className="bkt-cell"
                      data-advanced={decided ? 'true' : undefined}
                      data-fed={fed ? 'true' : undefined}
                    >
                      <MatchBox match={m} edit={edit} swap={swap} />
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
