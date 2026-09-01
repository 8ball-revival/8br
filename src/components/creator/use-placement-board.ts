'use client'

import { useEffect, useState } from 'react'
import {
  createPlacementQueue, sameSlot,
  type EntrySlot, type PlacementSaveResult, type SlotRef,
} from '@/lib/seasons/bracket-swap'

/**
 * The placement board's state, for the Season and Tournament draw screens.
 *
 * Both screens arrange the same thing in the same way, and both had the same three faults:
 *
 *   1. Every saved swap called `router.refresh()`, refetching the whole Creator page for a board
 *      that had already drawn the answer. Nothing visible changed; dragging quickly stacked them.
 *   2. Saves were fired as independent transitions, so two quick swaps could reach the server in
 *      either order.
 *   3. Rollback used a `before` snapshot captured when that swap started. With more than one in
 *      flight, `before` describes a board from before OTHER swaps that had since succeeded, so a
 *      single refusal could silently undo them as well.
 *
 * The queue in `bracket-swap.ts` fixes all three; this is the React shell around it. Everything
 * interesting is in the pure module so it can be tested without a renderer.
 */
export function usePlacementBoard(opts: {
  /** The board as the server rendered it. Adopted when it changes and nothing is in flight. */
  server: readonly EntrySlot[]
  entryKeys: Set<string>
  save: (from: SlotRef, to: SlotRef) => Promise<PlacementSaveResult>
  onError: (message: string) => void
  /** Read aloud after a successful local move. */
  announce?: (slots: readonly EntrySlot[], from: SlotRef, to: SlotRef) => void
}) {
  const [slots, setSlots] = useState<EntrySlot[]>(() => opts.server.slice())
  const [saving, setSaving] = useState(false)

  /*
    Built once: rebuilding the queue when a prop changed would discard whatever it had not saved.
    Its callbacks are replaced in place instead, so a save is never sent to a competition the
    screen has already moved on from.
  */
  const [queue] = useState(() => createPlacementQueue({
    initial: opts.server,
    save: opts.save,
    onChange: setSlots,
    onError: opts.onError,
    onBusy: setSaving,
  }))
  useEffect(() => { queue.configure({ save: opts.save, onError: opts.onError }) })

  /*
    Adopt a new server board — but not on top of unsaved work.

    Other actions on these screens (generating a draft, clearing the board) do still refresh the
    route, and the new props must win when they arrive. While saves are outstanding the props are
    by definition older than what is on screen, so adopting them would visibly reverse moves the
    person had just made.

    Compared during render rather than in an effect: `server` is a new array every render, so an
    identity check would reset forever, and an effect would paint the stale board and then correct
    it. The signature compares CONTENT, so it changes exactly when a position does.
  */
  const signature = opts.server.map((s) => `${s.matchId}:${s.side}:${s.entrantId ?? ''}`).join('|')
  const [seen, setSeen] = useState(signature)
  if (seen !== signature && !saving) {
    setSeen(signature)
    setSlots(opts.server.slice())
    queue.reset(opts.server)
  }

  return {
    slots,
    /** True while any save is outstanding, for a "Saving…" affordance. */
    saving,
    swap(from: SlotRef, to: SlotRef): void {
      if (sameSlot(from, to)) return
      if (!canPlace(opts.entryKeys, from) || !canPlace(opts.entryKeys, to)) return
      opts.announce?.(queue.enqueue(from, to), from, to)
    },
  }
}

const canPlace = (keys: Set<string>, ref: SlotRef) => keys.has(`${ref.matchId}:${ref.side}`)
