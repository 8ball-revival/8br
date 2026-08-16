'use client'

import type { CSSProperties } from 'react'
import Link from 'next/link'
import { CheckCircle2, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BracketMatch, BracketRound, BracketSlot } from '@/lib/tournaments/service'
import { TeamName } from './team-popover'

/** Optional admin inline-edit API for the SEASON live playoff bracket. Tournaments never pass this,
 *  so their brackets stay read-only and unchanged. */
export interface BracketEditApi {
  draft(matchId: number): { home: string; away: string }
  set(matchId: number, side: 'home' | 'away', value: string): void
  dirty(matchId: number): boolean
  saving(matchId: number): boolean
  error(matchId: number): string | null
  save(matchId: number): void
}

function Slot({ slot, won, dim, edit, matchId, side }: { slot?: BracketSlot; won?: boolean; dim?: boolean; edit?: BracketEditApi; matchId?: number; side?: 'home' | 'away' }) {
  const label = slot?.name ?? 'TBD'
  const hasMembers = !!slot?.members?.length
  const editable = !!edit && matchId != null && side != null && !!slot?.name && slot.name !== 'Bye'
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
        <CheckCircle2 aria-hidden="true" className="size-3.5 shrink-0" style={{ color: 'var(--gold)' }} />
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
            'h-6 w-10 shrink-0 self-center rounded border bg-card/70 text-center text-[0.85rem] tabular outline-none focus-visible:border-brand disabled:opacity-50',
            edit!.dirty(matchId!) ? 'border-[var(--gold)] ring-1 ring-[var(--gold)]/40' : 'border-input',
          )}
        />
      ) : slot?.score != null ? (
        <span className={cn('tabular self-start pt-0.5 text-[0.95rem]', won ? 'font-bold text-foreground' : dim ? 'text-foreground/70' : 'text-muted-foreground')}>{slot.score}</span>
      ) : null}
    </div>
  )
}

export function MatchBox({ match, edit }: { match: BracketMatch; edit?: BracketEditApi }) {
  // Editable only when this is a real, both-sides-known Season playoff matchup.
  const bothKnown = !!match.a?.name && match.a.name !== 'Bye' && !!match.b?.name && match.b.name !== 'Bye'
  const canEdit = !!edit && match.id != null && bothKnown
  const matchId = match.id
  const dirty = canEdit && edit!.dirty(matchId!)
  const saving = canEdit && edit!.saving(matchId!)
  const err = canEdit ? edit!.error(matchId!) : null
  return (
    <div className="w-full">
      {/* Frame is transparent (no card fill): only the WINNER row paints a dark background; the loser
          row stays see-through to the page. */}
      <div className="overflow-hidden rounded-md border border-border">
        <Slot slot={match.a} won={match.winner === 'a'} dim={match.winner === 'b'} edit={canEdit ? edit : undefined} matchId={matchId} side="home" />
        <div className="h-px bg-border" />
        <Slot slot={match.b} won={match.winner === 'b'} dim={match.winner === 'a'} edit={canEdit ? edit : undefined} matchId={matchId} side="away" />
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
  edit,
}: {
  rounds: BracketRound[]
  currentRound?: string
  /** Fill the available width (columns flex to fit) instead of fixed-width columns
   *  that scroll. Used by the wide tournament Playoffs canvas; tournaments keep fixed columns. */
  fluid?: boolean
  /** SEASON live playoffs only: enables admin inline score entry per matchup. */
  edit?: BracketEditApi
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
                    <MatchBox match={m} edit={edit} />
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
