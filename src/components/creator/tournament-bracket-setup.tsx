'use client'

/**
 * A Tournament's draw, arranged in private before anybody sees it.
 *
 * ── The same board as a Season's, and different surroundings ────────────────────────────────────
 * The draw board is shared — the same two halves, the same drag-or-click swap, the same refusal to
 * touch a position decided by an earlier match. What is around it is not, because the two records
 * settle a field differently: a Season chooses which qualifiers are included and how many rounds to
 * play, while a Tournament's field is simply everybody who entered.
 *
 * So there is no Select column here, and no elimination-type control: the format was chosen when
 * the Tournament was created and changing it now would mean redrawing a bracket somebody has just
 * arranged by hand. The list on the left says who is placed and who is not, which is the question
 * this screen actually has to answer.
 *
 * ── Private until it is started ─────────────────────────────────────────────────────────────────
 * Nothing here is visible to anybody else. The bracket becomes public at Start, which is the one
 * control that asks first.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { cn } from '@/lib/utils'
import { DraftBracket } from './draft-bracket'
import { applySwap, describeSwap, canPlaceInto, sameSlot, type SlotRef } from '@/lib/seasons/bracket-swap'
import type { EntrySlot } from '@/lib/seasons/playoff-topology'
import type { TournamentTopology } from '@/lib/tournaments/bracket-topology'
import {
  swapTournamentBracketSlotsAction, draftTournamentBracketAction, startTournamentAction,
} from '@/lib/creator/tournament-entrants-actions'

export interface SetupEntrant {
  registrationId: number
  name: string
  handle: string | null
  rating: number | null
  seed: number | null
}

export function TournamentBracketSetup({
  tournamentId, topology, entrants, isDoubleElim, canStart,
}: {
  tournamentId: number
  topology: TournamentTopology
  entrants: SetupEntrant[]
  isDoubleElim: boolean
  /** False once the bracket is published — the draw is settled and this screen is a record of it. */
  canStart: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [confirmStart, setConfirmStart] = useState(false)
  const [picked, setPicked] = useState<SlotRef | null>(null)
  const [dragging, setDragging] = useState<SlotRef | null>(null)
  const [announcement, setAnnouncement] = useState('')

  /*
    The slots as drawn, which may be one swap ahead of the server.

    Applying the exchange immediately makes dragging feel like moving a card rather than submitting
    a form. A refusal has to put it back, so the pre-swap array is kept and restored on failure —
    leaving the optimistic state in place would show an arrangement the database does not have.
  */
  const [slots, setSlots] = useState<EntrySlot[]>(topology.entrySlots)

  // A fresh render from the server is the truth; adopt it whenever the draft really changed. The
  // signature compares CONTENT, so it changes exactly when a position does rather than every render.
  const serverSignature = topology.entrySlots.map((x) => `${x.matchId}:${x.side}:${x.entrantId ?? ''}`).join('|')
  const [signature, setSignature] = useState(serverSignature)
  if (signature !== serverSignature) {
    setSignature(serverSignature)
    setSlots(topology.entrySlots)
  }

  const run = (fn: () => Promise<{ ok?: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn()
      if (r.error) setMsg({ ok: false, text: r.error })
      else { setMsg({ ok: true, text: r.message ?? 'Done.' }); router.refresh() }
    })

  const swap = (from: SlotRef, target: SlotRef) => {
    if (sameSlot(from, target)) return
    if (!canPlaceInto(topology.entryKeys, target) || !canPlaceInto(topology.entryKeys, from)) {
      setMsg({ ok: false, text: 'That position is decided by an earlier match.' })
      return
    }
    const before = slots
    setSlots(applySwap(slots, from, target))
    setAnnouncement(describeSwap(slots, from, target))
    start(async () => {
      const r = await swapTournamentBracketSlotsAction(tournamentId, from, target)
      // A refusal puts the board back rather than leaving an arrangement the server does not have.
      if (r.error) { setSlots(before); setMsg({ ok: false, text: r.error }) }
      else router.refresh()
    })
  }

  const placed = new Set(slots.map((s) => s.entrantId).filter((id): id is number => id != null))
  const unplaced = entrants.filter((e) => !placed.has(e.registrationId))
  const hasDraft = topology.matches > 0

  const identityByEntrant = new Map(entrants.map((e) => [e.registrationId, { cueverseId: e.handle, name: e.name }]))
  const seedByEntrant = new Map(slots.filter((s) => s.entrantId != null).map((s) => [s.entrantId!, s.seed]))

  return (
    <div className="space-y-4">
      <span aria-live="polite" className="sr-only">{announcement}</span>

      {msg && (
        <p
          role="status"
          className={cn('rounded-md border px-3 py-2 text-sm',
            msg.ok ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive')}
        >
          {msg.text}
        </p>
      )}

      <p className="cyber-clip border border-[var(--gold)]/30 bg-[var(--selected-surface)] px-3 py-2 text-xs text-foreground">
        This draw is private. Nobody else can see it until you start the Tournament.
        {isDoubleElim && ' Only the Winners Bracket is arranged here — the Losers Bracket fills itself as matches are played.'}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => draftTournamentBracketAction(tournamentId))}
          className="cyber-clip-sm border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:border-brand/40 hover:text-brand disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
        >
          {hasDraft ? 'Redraw the bracket' : 'Generate the bracket'}
        </button>
        {hasDraft && canStart && (
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirmStart(true)}
            className="ml-auto cyber-clip-sm bg-[var(--gold)] px-3 py-1.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
          >
            Start Tournament
          </button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <EntrantList
          entrants={entrants}
          placed={placed}
          seedByEntrant={seedByEntrant}
          unplacedCount={unplaced.length}
        />
        <DraftBracket
          slots={slots}
          identityOf={(entrantId) => identityByEntrant.get(entrantId)}
          entryKeys={topology.entryKeys}
          picked={picked}
          dragging={dragging}
          hasDraft={hasDraft}
          emptyHint="Generate the bracket to lay out the draw, then arrange the first round by hand."
          onPick={(target) => {
            if (!picked) { setPicked(target); return }
            if (sameSlot(picked, target)) { setPicked(null); return }
            const from = picked
            setPicked(null)
            swap(from, target)
          }}
          onDragStart={(t) => setDragging(t)}
          onDragEnd={() => setDragging(null)}
          onDrop={(target) => {
            const from = dragging
            setDragging(null)
            if (from) swap(from, target)
          }}
        />
      </div>

      {confirmStart && (
        <StartDialog
          entrants={entrants.length}
          placed={placed.size}
          byes={slots.filter((s) => s.entrantId == null).length}
          pending={pending}
          onCancel={() => setConfirmStart(false)}
          onConfirm={() => {
            setConfirmStart(false)
            run(() => startTournamentAction(tournamentId))
          }}
        />
      )}
    </div>
  )
}

/**
 * Who is in, and where they are.
 *
 * Seed, entrant, rating, placed or not — and nothing else. A group, a points total and a win-loss
 * record are what a Season's qualifiers are judged on; a Tournament's field is everybody who
 * entered, so those columns would be four empty ones.
 */
function EntrantList({
  entrants, placed, seedByEntrant, unplacedCount,
}: {
  entrants: SetupEntrant[]
  placed: Set<number>
  seedByEntrant: Map<number, number | null>
  unplacedCount: number
}) {
  return (
    <div className="overflow-hidden rounded-none border border-border">
      <div className="flex items-center gap-2 border-b border-[var(--bracket-outline)] bg-[var(--bracket-surface)] px-3 py-1.5">
        <span className="text-xs text-muted-foreground">{entrants.length} entrant{entrants.length === 1 ? '' : 's'}</span>
        <span className={cn('ml-auto text-[0.65rem] uppercase tracking-wide',
          unplacedCount > 0 ? 'text-[var(--gold)]' : 'text-muted-foreground')}>
          {unplacedCount > 0 ? `${unplacedCount} unplaced` : 'all placed'}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-[0.65rem] uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-1.5 text-right font-medium">Seed</th>
              <th className="px-2 py-1.5 text-left font-medium">Entrant</th>
              <th className="px-2 py-1.5 text-right font-medium">Rating</th>
              <th className="px-2 py-1.5 text-right font-medium">On the board</th>
            </tr>
          </thead>
          <tbody>
            {entrants.map((e) => {
              const isPlaced = placed.has(e.registrationId)
              return (
                <tr key={e.registrationId} className={cn('border-b border-border/60', !isPlaced && 'bg-[var(--gold)]/[0.04]')}>
                  <td className="tabular px-2 py-1.5 text-right text-muted-foreground">
                    {seedByEntrant.get(e.registrationId) ?? '—'}
                  </td>
                  <td className="px-2 py-1.5">
                    {e.handle && <span className="font-semibold text-[var(--gold)]">{e.handle}</span>}
                    {e.handle && <span className="text-muted-foreground"> · </span>}
                    <span className="text-muted-foreground">{e.name}</span>
                  </td>
                  <td className="tabular px-2 py-1.5 text-right font-semibold text-foreground">
                    {e.rating ?? <span className="font-normal text-muted-foreground">—</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right text-xs">
                    {isPlaced
                      ? <span className="text-muted-foreground">Placed</span>
                      : <span className="font-semibold text-[var(--gold)]">Not placed</span>}
                  </td>
                </tr>
              )
            })}
            {entrants.length === 0 && (
              <tr><td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">No entrants.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Start: what becomes visible, and what stops being editable. */
function StartDialog({
  entrants, placed, byes, pending, onCancel, onConfirm,
}: {
  entrants: number
  placed: number
  byes: number
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="start-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-none border border-border bg-card p-5 shadow-xl">
        <h2 id="start-title" className="font-display text-lg font-bold text-foreground">Start the Tournament?</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The draw becomes public and the first round can be scored. Positions stop being arrangeable
          by hand — a correction afterwards goes through the audited reopen.
        </p>
        <dl className="mt-4 space-y-1.5 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Entrants placed</dt>
            <dd className="tabular font-semibold text-foreground">{placed} of {entrants}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Byes in the first round</dt>
            <dd className="tabular font-semibold text-foreground">{byes}</dd>
          </div>
        </dl>
        {placed < entrants && (
          <p className="mt-3 rounded-md border border-[var(--gold)]/40 bg-[var(--selected-surface)] px-3 py-2 text-sm text-foreground">
            {entrants - placed} entrant{entrants - placed === 1 ? ' is' : 's are'} not on the board and
            will not play. Place them first if that is not deliberate.
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel}
            className="cyber-clip-sm border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60">
            Keep it private
          </button>
          <button type="button" onClick={onConfirm} disabled={pending}
            className="cyber-clip-sm bg-[var(--gold)] px-3 py-1.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60">
            {pending ? 'Starting…' : 'Start Tournament'}
          </button>
        </div>
      </div>
    </div>
  )
}
