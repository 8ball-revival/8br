'use client'

/**
 * Edit Lower Bracket — rearranging where future droppers land, on a bracket already being played.
 *
 * ── What the Owner is actually moving ───────────────────────────────────────────────────────────
 * Not names: FEEDS. Each slot shows the route that fills it — "Loser of Winners R2 M3" — and two
 * slots in the same losers round can trade routes. Whoever is already sitting in a slot travels
 * with their route, because they only got there by winning or losing an upstream match, and a
 * player parked under someone else's source line is a bracket that contradicts itself.
 *
 * ── Two ways to do it, because one of them is not enough ────────────────────────────────────────
 * Drag-and-drop is the obvious gesture and it is here. It is also unusable by keyboard, unreliable
 * on a touchpad mid-drag, and impossible to undo halfway. So click-to-swap is the primary
 * interaction — click a slot, click its partner — and dragging is layered on top of the same two
 * calls. Neither is a special case of the other in the code; both just nominate two slots.
 *
 * ── Nothing is written until Save ───────────────────────────────────────────────────────────────
 * Swaps accumulate locally and the board redraws to show the resulting matchups, so the Owner reads
 * the bracket they are about to commit rather than imagining it. Cancel discards. The server
 * re-validates the whole list from scratch and applies it in one transaction — this component's
 * checks are there to explain a refusal early, never to authorise anything.
 */

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { cn } from '@/lib/utils'
import { saveLowerBracketAction } from '@/lib/creator/lower-bracket-actions'
import {
  lowerBracketView, slotKey, swapLowerSlots,
  type LowerSlotView, type RoutableMatch, type SlotRef,
} from '@/lib/competition/lower-bracket-edit'

export function LowerBracketEditor({
  tournamentId, matches,
}: {
  tournamentId: number
  /** The whole bracket. Winners and grand-final matches are needed as feed SOURCES. */
  matches: RoutableMatch[]
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [swaps, setSwaps] = useState<[SlotRef, SlotRef][]>([])
  const [picked, setPicked] = useState<SlotRef | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, startSave] = useTransition()

  /** The bracket as it would read after the pending swaps — the preview the Owner is deciding on. */
  const working = useMemo(() => {
    let cur: RoutableMatch[] = matches
    for (const [a, b] of swaps) {
      const step = swapLowerSlots(cur, a, b)
      if (!step.ok) return cur
      cur = step.preview
    }
    return cur
  }, [matches, swaps])

  const rounds = useMemo(() => lowerBracketView(working), [working])
  const dirty = swaps.length > 0

  const reset = () => { setSwaps([]); setPicked(null); setError(null) }

  /** Nominate a slot. The second nomination performs the swap. */
  const nominate = (ref: SlotRef) => {
    setError(null)
    if (!picked) { setPicked(ref); return }
    if (slotKey(picked) === slotKey(ref)) { setPicked(null); return }
    const step = swapLowerSlots(working, picked, ref)
    if (!step.ok) { setError(step.error); setPicked(null); return }
    setSwaps((s) => [...s, [picked, ref]])
    setPicked(null)
  }

  const save = () => startSave(async () => {
    setError(null)
    const res = await saveLowerBracketAction(tournamentId, swaps)
    if (!res.ok) { setError(res.error ?? 'That edit was refused.'); return }
    setSwaps([]); setPicked(null); setEditing(false)
    router.refresh()
  })

  if (rounds.length === 0) return null

  return (
    <section className="mt-6" aria-labelledby="lb-edit-heading">
      <div className="flex flex-wrap items-center gap-3">
        <h3 id="lb-edit-heading" className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Lower bracket routing
        </h3>
        {!editing ? (
          <button
            type="button"
            onClick={() => { reset(); setEditing(true) }}
            className="cyber-clip border border-[var(--neon-line)] px-3 py-1.5 text-xs font-semibold uppercase tracking-wider hover:bg-white/[0.06]"
          >
            Edit Lower Bracket
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving}
              className="cyber-clip border border-[var(--gold)]/50 bg-[var(--selected-surface)] px-3 py-1.5 text-xs font-semibold uppercase tracking-wider disabled:opacity-40"
            >
              {saving ? 'Saving…' : `Save Lower Bracket${dirty ? ` (${swaps.length})` : ''}`}
            </button>
            <button
              type="button"
              onClick={() => { reset(); setEditing(false) }}
              disabled={saving}
              className="cyber-clip border border-[var(--neon-line)] px-3 py-1.5 text-xs font-semibold uppercase tracking-wider hover:bg-white/[0.06]"
            >
              Cancel
            </button>
          </>
        )}
      </div>

      {editing && (
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Click a slot, then click the slot to swap it with. Both must be in the same round and
          neither match may have a result. The player in a slot moves with it. Nothing is saved
          until you press Save.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {editing && dirty && (
        <p className="mt-2 text-sm text-[var(--neon-cyan)]">
          {swaps.length} change{swaps.length === 1 ? '' : 's'} pending — the board below shows the result.
        </p>
      )}

      <div className="mt-3 flex gap-4 overflow-x-auto pb-2">
        {rounds.map((r) => (
          <div key={r.round} className="min-w-[16rem] flex-1">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Losers Round {r.round}
            </h4>
            <div className="space-y-3">
              {r.matches.map((m) => (
                <div
                  key={m.matchId}
                  className={cn(
                    'cyber-clip border p-2',
                    m.locked ? 'border-[var(--neon-line)] bg-white/[0.03] opacity-80' : 'border-[var(--neon-line)] bg-card',
                  )}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-foreground">{m.label}</span>
                    {m.locked && (
                      // A played match is called out rather than merely dimmed: "cannot be moved"
                      // is a different statement from "not currently selected".
                      <span className="rounded border border-[var(--gold)]/40 px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-[var(--gold)]">
                        Locked · result recorded
                      </span>
                    )}
                  </div>
                  {m.slots.map((s) => (
                    <SlotRow
                      key={s.slot}
                      slot={s}
                      editing={editing}
                      selected={!!picked && picked.matchId === s.matchId && picked.slot === s.slot}
                      onPick={() => nominate({ matchId: s.matchId, slot: s.slot })}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function SlotRow({ slot, editing, selected, onPick }: {
  slot: LowerSlotView
  editing: boolean
  selected: boolean
  onPick: () => void
}) {
  const name = slot.occupant.username ?? null
  const body = (
    <>
      <span className={cn('block truncate text-sm', name ? 'text-foreground' : 'text-muted-foreground italic')}>
        {name ?? 'Waiting'}
      </span>
      {/* The source line is the thing being edited, so it is always shown - not only in edit mode. */}
      <span className="block truncate text-[0.7rem] text-muted-foreground">
        {slot.sourceLabel ?? 'No feed'}
      </span>
    </>
  )

  if (!editing || !slot.editable) {
    return (
      <div
        className="mt-1 rounded border border-transparent px-2 py-1"
        title={slot.reason ?? undefined}
        aria-disabled={editing ? true : undefined}
      >
        {body}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onPick}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', slotKey(slot)); onPick() }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); onPick() }}
      aria-pressed={selected}
      aria-label={`${name ?? 'Empty slot'}, ${slot.sourceLabel ?? 'no feed'}. Select to swap.`}
      className={cn(
        'mt-1 w-full cursor-grab rounded border px-2 py-1 text-left transition-colors',
        selected
          ? 'border-[var(--gold)] bg-[var(--selected-surface)]'
          : 'border-[var(--neon-line)]/50 hover:bg-white/[0.06]',
      )}
    >
      {body}
    </button>
  )
}
