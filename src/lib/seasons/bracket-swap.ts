import type { EntrySlot, Side } from './playoff-topology'

/**
 * Exchanging two bracket occupants, as a pure function.
 *
 * ── Why this is not inside the component ─────────────────────────────────────────────────────────
 * Two interactions perform the same swap — dragging a card onto another, and clicking one slot then
 * another — and the workspace applies it optimistically before the server confirms. Three copies of
 * "what does a swap do" is three chances for one of them to move a seed it should not have touched.
 *
 * Pure also means testable without a browser, which matters: the property that must hold is not
 * "the drag worked" but "the seed and the position stayed with the SLOT". That is a statement about
 * data, and it can be proven directly instead of inferred from a screenshot.
 */

export type { EntrySlot }

export interface SlotRef {
  matchId: number
  side: Side
}

export const sameSlot = (a: SlotRef, b: SlotRef) => a.matchId === b.matchId && a.side === b.side

/** Whether a person may be dropped here at all. Fed positions are decided by play. */
export function canPlaceInto(entryKeys: Set<string>, ref: SlotRef): boolean {
  return entryKeys.has(`${ref.matchId}:${ref.side}`)
}

/**
 * Swap the OCCUPANTS of two slots, leaving everything about the slots themselves alone.
 *
 * The seed belongs to the position, not to the person standing in it: bracket seed 1 is "the top of
 * the draw", and moving a player there makes them the 1 seed. Carrying their old seed with them
 * would produce two slots claiming the same number and a bracket that reads as though the draw had
 * been reordered.
 *
 * Returns a new array; the input is untouched, so a caller can keep the original for rollback.
 */
export function applySwap(slots: readonly EntrySlot[], a: SlotRef, b: SlotRef): EntrySlot[] {
  if (sameSlot(a, b)) return slots.slice()
  const ia = slots.findIndex((s) => sameSlot(s, a))
  const ib = slots.findIndex((s) => sameSlot(s, b))
  if (ia === -1 || ib === -1) return slots.slice()

  const next = slots.slice()
  // Only the occupant moves: entrantId and the name shown with it.
  next[ia] = { ...slots[ia], entrantId: slots[ib].entrantId, entrantName: slots[ib].entrantName }
  next[ib] = { ...slots[ib], entrantId: slots[ia].entrantId, entrantName: slots[ia].entrantName }
  return next
}

/** What to announce after a swap, for a screen reader following along. */
export function describeSwap(slots: readonly EntrySlot[], a: SlotRef, b: SlotRef): string {
  const sa = slots.find((s) => sameSlot(s, a))
  const sb = slots.find((s) => sameSlot(s, b))
  const name = (s: EntrySlot | undefined) => s?.entrantName ?? 'the empty position'
  if (!sa || !sb) return 'Nothing moved.'
  return `${name(sa)} and ${name(sb)} swapped positions.`
}

/*
  ── Saving placements without refetching the page ───────────────────────────────────────────────

  Each swap used to save and then call `router.refresh()`, which refetches the whole Creator route.
  Moving eight players meant eight full server round trips for a board that had already drawn the
  answer optimistically — the refresh changed nothing a reader could see, and dragging quickly
  stacked them.

  It also raced: the saves were fired as independent transitions, so two quick swaps could reach the
  server in either order and the later answer could be the earlier swap's.

  This runs them strictly in order and reconciles from what the server says the board now IS, which
  matters because the server does not always perform the swap the client drew. Swapping a player
  with a BYE is asked for from the other end (see `swapTournamentBracketSlotsAction`), so the
  authoritative arrangement can differ from a naive local exchange.
*/

/** One requested exchange, and the board as it looked before it was applied. */
export interface QueuedSwap { from: SlotRef; to: SlotRef }

export interface PlacementSaveResult {
  ok: boolean
  error?: string
  /** The board as the server now holds it. Adopted verbatim when present. */
  slots?: EntrySlot[]
}

export interface PlacementQueue {
  /** Optimistically apply a swap and queue its save. Returns the board to draw right now. */
  enqueue: (from: SlotRef, to: SlotRef) => EntrySlot[]
  /** Resolves when every queued save has settled. For tests and for "are we idle" checks. */
  settled: () => Promise<void>
  /** How many saves are still in flight or waiting. */
  depth: () => number
  /** Adopt a fresh server board. Only meaningful while idle — see the caller's guard. */
  reset: (slots: readonly EntrySlot[]) => void
  /**
   * Point the queue at fresh callbacks without rebuilding it.
   *
   * A React caller creates this once — rebuilding it would discard whatever it had not saved — but
   * its `save` closes over props that change. This lets those be replaced in place, so a save is
   * never sent to a Season the screen has moved on from.
   */
  configure: (next: Partial<Pick<PlacementQueueOptions, 'save' | 'onError'>>) => void
}

export interface PlacementQueueOptions {
  initial: readonly EntrySlot[]
  save: (from: SlotRef, to: SlotRef) => Promise<PlacementSaveResult>
  /** Called whenever the board to draw changes — optimistically, on reconcile, and on revert. */
  onChange: (slots: EntrySlot[]) => void
  onError: (message: string) => void
  /** Called when the queue starts and stops having work, for a "Saving…" affordance. */
  onBusy?: (busy: boolean) => void
}

export function createPlacementQueue(options: PlacementQueueOptions): PlacementQueue {
  const opts = { ...options }
  /*
    Two boards, deliberately.

    `confirmed` is the last arrangement the server has agreed to; `displayed` is that plus every
    swap not yet saved. A failure can then put the board back to something true rather than to a
    snapshot taken before some OTHER swap that did succeed - which is what a single `before`
    variable does once more than one swap is in flight.
  */
  let confirmed: EntrySlot[] = opts.initial.slice()
  let displayed: EntrySlot[] = opts.initial.slice()
  let queue: QueuedSwap[] = []
  let running: Promise<void> = Promise.resolve()
  let inFlight = 0

  const revertAll = (message: string) => {
    // The dropped saves never run, so they must stop counting as work.
    inFlight -= queue.length
    queue = []
    displayed = confirmed.slice()
    opts.onChange(displayed)
    opts.onError(message)
  }

  const pump = () => {
    running = running.then(async () => {
      const next = queue.shift()
      if (!next) return
      try {
        const r = await opts.save(next.from, next.to)
        if (!r.ok) {
          /*
            Everything still queued was drawn on top of a swap the server refused, so it describes a
            board that never existed. Dropping the rest and returning to `confirmed` is the only
            arrangement that is certainly real.
          */
          revertAll(r.error ?? 'That placement could not be saved.')
          return
        }
        // The server's own arrangement wins over the one drawn locally.
        confirmed = r.slots ? r.slots.slice() : applySwap(confirmed, next.from, next.to)
        displayed = queue.reduce((acc, op) => applySwap(acc, op.from, op.to), confirmed.slice())
        opts.onChange(displayed)
      } catch {
        revertAll('That placement could not be saved.')
      } finally {
        inFlight -= 1
        if (inFlight === 0) opts.onBusy?.(false)
      }
    })
    return running
  }

  return {
    enqueue(from, to) {
      if (sameSlot(from, to)) return displayed
      displayed = applySwap(displayed, from, to)
      queue.push({ from, to })
      inFlight += 1
      if (inFlight === 1) opts.onBusy?.(true)
      opts.onChange(displayed)
      void pump()
      return displayed
    },
    /*
      Waits for the queue to EMPTY, not merely for the chain as it stands.

      `running` is replaced every time work is added, so awaiting it once can return while later
      swaps are still queued behind it. Awaiting until the chain stops growing is what "settled"
      has to mean for a caller that wants to know the board is saved.
    */
    async settled() {
      for (;;) {
        const chain = running
        await chain
        if (chain === running) return
      }
    },
    depth: () => inFlight,
    configure(next) {
      if (next.save) opts.save = next.save
      if (next.onError) opts.onError = next.onError
    },
    reset(slots) {
      confirmed = slots.slice()
      displayed = confirmed.slice()
      queue = []
      inFlight = 0
    },
  }
}
