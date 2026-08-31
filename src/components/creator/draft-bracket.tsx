'use client'

/**
 * The private draw board: first-round positions, arranged by hand.
 *
 * ── Why this is its own file ────────────────────────────────────────────────────────────────────
 * A Season and a Tournament arrange a first round the same way — the same two halves, the same
 * drag-or-click swap, the same rule that a fed position cannot be set by hand. What differs is
 * everything AROUND the board: who is eligible, how the field is chosen, what starting it means.
 * Sharing the board and not the surroundings is what keeps one interaction in one place without
 * pretending two different lifecycles are the same lifecycle.
 *
 * It knows nothing about Seasons or Tournaments. It is given slots, a way to look up who is in one,
 * and callbacks; it decides only how a draw is read and moved.
 */

import { cn } from '@/lib/utils'
import { identityLines, identityText } from '@/lib/identity/display'
import { canPlaceInto, sameSlot, type SlotRef } from '@/lib/seasons/bracket-swap'
import type { EntrySlot } from '@/lib/seasons/playoff-topology'

/** How a seated entrant is identified. A display name alone is not an identity — see below. */
export interface SlotIdentity {
  cueverseId: string | null
  name: string | null
}

export function DraftBracket({
  slots, identityOf, entryKeys, picked, dragging, onPick, onDragStart, onDragEnd, onDrop, hasDraft,
  emptyHint,
}: {
  slots: EntrySlot[]
  /** The seated entrant's identity, by entrant id. The slot itself carries only a display name. */
  identityOf: (entrantId: number) => SlotIdentity | undefined
  entryKeys: Set<string>
  picked: SlotRef | null
  dragging: SlotRef | null
  onPick: (t: SlotRef) => void
  onDragStart: (t: SlotRef) => void
  onDragEnd: () => void
  onDrop: (t: SlotRef) => void
  hasDraft: boolean
  /** What to say when there is no draw yet — the next step differs by record. */
  emptyHint: string
}) {
  if (!hasDraft) {
    return (
      <div className="flex min-h-[12rem] items-center justify-center cyber-clip border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        {emptyHint}
      </div>
    )
  }

  // Group the entry positions by the tie they belong to, in bracket order.
  const byMatch = new Map<number, EntrySlot[]>()
  for (const s of slots) {
    const list = byMatch.get(s.matchId) ?? []
    list.push(s)
    byMatch.set(s.matchId, list)
  }
  const ties = [...byMatch.entries()]
    .map(([matchId, slots]) => ({ matchId, slots: slots.sort((a, b) => (a.side === 'home' ? -1 : 1) - (b.side === 'home' ? -1 : 1)), ref: slots[0] }))
    .sort((a, b) => a.ref.round - b.ref.round || a.ref.slot - b.ref.slot)

  /*
   * Two columns read top to bottom, not side to side.
   *
   * A CSS grid fills row by row, so M1 and M2 landed beside each other and the numbers zig-zagged
   * down the board — you had to read left, right, left, right to follow the order. Splitting the
   * list in half puts M1–M8 down the left and M9–M16 down the right, which is how a draw sheet is
   * read and how the pill numbers now run.
   *
   * The halves are computed rather than left to CSS column balancing, so the split is exactly the
   * same for 8, 16, 32 or 128 matches instead of depending on how a browser decides to balance
   * heights. Stacked on a narrow screen the two halves fall one after the other, which is M1 through
   * Mn in true sequence.
   *
   * Presentation only: match ids, slot topology, seeding and feeder relationships are untouched —
   * `ties` itself is still in bracket order, and the M number is that order's index.
   */
  const half = Math.ceil(ties.length / 2)
  const columns = [ties.slice(0, half), ties.slice(half)]

  return (
    <div className="rounded-none border border-border p-3">
      <p id="draft-help" className="mb-2 text-xs text-muted-foreground">
        Drag a player onto another position to swap them, or click one and then the other — both do
        the same thing, so the board works without a mouse. Positions decided by an earlier match are
        not shown, because they cannot be set by hand.
      </p>
      <div className="grid gap-x-5 gap-y-6 sm:grid-cols-2">
        {columns.map((column, c) => (
          <div key={c}>
            {/*
              Which half of the draw this is.
              Sixteen identical pills in two columns give no clue where one half ends and the other
              begins; naming the range makes the split readable at a glance.
            */}
            {column.length > 0 && (
              <p className="mb-2 flex items-baseline justify-between gap-2 border-b border-[var(--gold)]/25 pb-1">
                {/*
                  Two halves of one bracket, not two brackets.
                  The wording says so explicitly, because "left" and "right" invite the reading that
                  these are separate draws.
                */}
                <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
                  Round 1 · {c === 0 ? 'Top half' : 'Bottom half'}
                </span>
                <span className="tabular shrink-0 text-[0.66rem] text-[var(--gold)]/70">
                  M{c === 0 ? 1 : half + 1}–M{c === 0 ? half : ties.length}
                </span>
              </p>
            )}
            <ul className="flex flex-col gap-3.5">
              {column.map((t) => {
                // The number is the match's place in the whole draw, not its place in this column.
                const i = c === 0 ? column.indexOf(t) : half + column.indexOf(t)
                return (
                  <li key={t.matchId} className="flex items-center gap-2">
                    {/* Short thin connector into the match pill. */}
                    <span aria-hidden className="h-px w-3 shrink-0 bg-[var(--selected-surface)]" />
                    <span
                      className="shrink-0 cyber-clip-sm border border-[var(--gold)]/50 px-1.5 py-0.5 text-[0.65rem] font-semibold text-[var(--gold)]/80"
                      title={`Round ${t.ref.round} · Match ${i + 1}`}
                    >
                      <span className="sr-only">Round {t.ref.round} · Match {i + 1}</span>
                      <span aria-hidden>M{i + 1}</span>
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      {t.slots.map((s) => (
                        <SlotButton
                          key={`${s.matchId}:${s.side}`}
                          slot={s}
                          identity={identityOf(s.entrantId ?? -1) ?? { cueverseId: null, name: s.entrantName }}
                          picked={!!picked && sameSlot(picked, s)}
                          dragging={!!dragging && sameSlot(dragging, s)}
                          droppable={!!dragging && !sameSlot(dragging, s) && canPlaceInto(entryKeys, s)}
                          anyDragging={!!dragging}
                          onPick={() => onPick({ matchId: s.matchId, side: s.side })}
                          onDragStart={() => onDragStart({ matchId: s.matchId, side: s.side })}
                          onDragEnd={onDragEnd}
                          onDrop={() => onDrop({ matchId: s.matchId, side: s.side })}
                        />
                      ))}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * One position: a button first, draggable second.
 *
 * It stays a real <button> so it is reachable, focusable and operable from the keyboard whatever the
 * pointer is doing. Dragging is layered on top; nothing depends on it.
 */
function SlotButton({
  slot, identity, picked, dragging, droppable, anyDragging, onPick, onDragStart, onDragEnd, onDrop,
}: {
  slot: EntrySlot
  /**
   * The seated entrant's identity, resolved from the entrant list.
   *
   * The slot itself only carries a display name, which on this site is not an identity — there are
   * six players called Chris. The handle comes from the list the board was built from.
   */
  identity: SlotIdentity
  picked: boolean
  dragging: boolean
  /** A legal target for the card currently being dragged. */
  droppable: boolean
  anyDragging: boolean
  onPick: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onDrop: () => void
}) {
  const empty = slot.entrantId == null
  const lines = identityLines({ cueverseId: identity.cueverseId, preferredName: identity.name })
  // While a drag is in progress, everything that is not a legal target says so rather than staying
  // neutral — an unmarked slot that silently refuses the drop reads as a broken interaction.
  const invalidTarget = anyDragging && !droppable && !dragging
  return (
    <button
      type="button"
      draggable={!empty}
      onClick={onPick}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', `${slot.matchId}:${slot.side}`); onDragStart() }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => { if (droppable) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } }}
      onDrop={(e) => { if (droppable) { e.preventDefault(); onDrop() } }}
      aria-pressed={picked}
      aria-describedby="draft-help"
      aria-label={`${empty ? 'Bye' : identityText({ cueverseId: identity.cueverseId, preferredName: identity.name })}, seed ${slot.seed ?? 'none'}`}
      className={cn(
        'flex w-full items-center gap-2 rounded border px-2 py-1 text-left text-xs transition-colors',
        !empty && 'cursor-grab active:cursor-grabbing',
        picked && 'border-[var(--bracket-focus)] bg-[var(--bracket-surface-raised)]',
        dragging && 'opacity-40',
        droppable && 'border-dashed border-[var(--bracket-focus)] bg-[var(--bracket-surface-raised)]',
        invalidTarget && 'cursor-not-allowed opacity-40',
        !picked && !droppable && !invalidTarget && 'border-[var(--bracket-outline)] bg-[var(--bracket-surface)] hover:border-[var(--bracket-focus)]/50',
      )}
    >
      <span className="tabular w-5 shrink-0 text-right text-[0.65rem] text-[var(--bracket-text-neutral)]">{slot.seed ?? ''}</span>
      {empty ? (
        <span className="min-w-0 flex-1 truncate italic text-[var(--bracket-text-muted)]">Bye</span>
      ) : (
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          {/* A draft is a placement board: no tie has been played, so no identity is a winner and
              none of them is gold. */}
          <span className="truncate font-semibold text-[var(--bracket-text)]">{lines.primary}</span>
          {lines.secondary && (
            <span className="truncate text-[0.66rem] text-foreground/60">{lines.secondary}</span>
          )}
        </span>
      )}
    </button>
  )
}
