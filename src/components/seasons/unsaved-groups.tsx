'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

/**
 * How many group edits are typed but not saved, shared between the tables and the Close control.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────────────────────
 * Each group table owns its own draft, which is right: they save independently, one transaction
 * each. But Close Groups is a single control outside all of them, and closing while a table still
 * holds unsaved scores locks the standings without those scores in them — the operator's work is
 * simply gone, and nothing said so.
 *
 * The alternatives were worse. Lifting every draft into one parent would make one table's keystroke
 * re-render all of them. Reading the DOM for dirty inputs would couple the control to the markup.
 * A count, reported up and summed, is the smallest thing that answers the only question being
 * asked: is there anything unsaved right now?
 *
 * ── Absent by default ───────────────────────────────────────────────────────────────────────────
 * The public Season page renders these tables without the provider, so the hooks no-op there rather
 * than requiring every caller to wrap something it has no use for.
 */

interface UnsavedStore {
  report: (groupId: number, count: number) => void
  counts: Record<number, number>
}

const Ctx = createContext<UnsavedStore | null>(null)

export function UnsavedGroupsProvider({ children }: { children: React.ReactNode }) {
  const [counts, setCounts] = useState<Record<number, number>>({})
  const report = useCallback((groupId: number, count: number) => {
    setCounts((prev) => (prev[groupId] === count ? prev : { ...prev, [groupId]: count }))
  }, [])
  const value = useMemo(() => ({ report, counts }), [report, counts])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Called by a group table whenever its unsaved count changes. No-op outside the provider. */
export function useReportUnsaved(groupId: number, count: number) {
  const store = useContext(Ctx)
  const report = store?.report
  useEffect(() => {
    if (!report) return
    report(groupId, count)
  }, [report, groupId, count])
  // Unmounting clears this group's contribution, so a table that scrolls away or a Season that
  // navigates does not leave a phantom "unsaved" behind on the Close control.
  useEffect(() => {
    if (!report) return
    return () => report(groupId, 0)
  }, [report, groupId])
}

/** Total unsaved edits across every group table on screen. Zero outside the provider. */
export function useUnsavedTotal(): number {
  const store = useContext(Ctx)
  if (!store) return 0
  return Object.values(store.counts).reduce((a, b) => a + b, 0)
}
