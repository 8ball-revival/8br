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
