'use client'

import { useState } from 'react'
import { Info, X } from 'lucide-react'

/**
 * How the rankings are calculated, and what they leave out.
 *
 * Every claim here is a rule the code actually applies — the exclusions match the ledger the table
 * reads, and the completeness language matches the marker on each row. This is the page's own
 * account of itself, so if a rule changes, this changes with it.
 */

const SECTIONS: { heading: string; points: string[] }[] = [
  {
    heading: 'What counts',
    points: [
      'Every match with a recorded result from a completed Season or Cup.',
      'Group-stage and playoff matches both count, and both are shown separately in the record views.',
      'A match appears once per player however many places it is referenced from — the rating ledger holds one row per player per match.',
    ],
  },
  {
    heading: 'What is excluded',
    points: [
      'Byes. Nobody played, so there is no result to record.',
      'Administrative advancements — a player moved through a bracket without a match.',
      'Placeholder and test results, and anything cancelled or voided.',
      'Forfeits count as a match played and as a win or a loss, but contribute no games and do not move the rating, because no frames were contested.',
    ],
  },
  {
    heading: 'What the data cannot always tell you',
    points: [
      'Some archived seasons record who won each match but not the individual game scores. Game totals, differential and game win rate cover only the matches that do — the marker on each row says which case applies to that player.',
      'Ratings appear only where a rating was actually recorded. There is no reconstruction of where a player stood on a date before the ledger begins.',
      'Historical aliases are shown where they were recorded. An absent alias means none was recorded, not that none existed.',
    ],
  },
  {
    heading: 'Ranking and ties',
    points: [
      'In Current mode the official rank is authoritative: rating, then match wins, then the player’s public identity as a stable final tie-break.',
      'Sorting the table by any other column reorders the rows for reading and never renumbers the official rank.',
      'Database row order is never used as a tie-break, so two players who are genuinely level appear in the same order on every request.',
      'The minimum-match threshold decides who is RANKED, not who has a record. A player below it is shown, marked, and left out of the ranking comparison.',
    ],
  },
]

export function Methodology() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-[var(--gold)]/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
      >
        <Info className="size-3.5" aria-hidden />
        How these rankings work
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="How these rankings work"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}
        >
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-2xl">
            <div className="mb-3 flex items-start justify-between gap-4">
              <h2 className="font-display text-lg font-bold">How these rankings work</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                autoFocus
                className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

            <p className="mb-4 text-sm text-muted-foreground">
              Ratings are a standard Elo system applied to every genuinely-played match, in the order
              the matches were completed. Current uses a rolling 365-day window; All Time uses
              everything on record.
            </p>

            {SECTIONS.map((s) => (
              <section key={s.heading} className="mb-4 last:mb-0">
                <h3 className="mb-1.5 text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--gold)]">
                  {s.heading}
                </h3>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {s.points.map((p) => (
                    <li key={p} className="flex gap-2">
                      <span aria-hidden className="mt-[0.45rem] block size-1 shrink-0 rounded-full bg-[var(--gold)]/60" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
