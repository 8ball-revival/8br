'use client'

import { useState } from 'react'
import { Info, X } from 'lucide-react'

/** A compact "How Rankings Work" info button + modal, so the explanation no longer occupies a large
 *  block above the ladder. Explains the Elo Rating system, Current vs All-Time, forfeits, team
 *  matches, and inactivity. */
export function HowRankingsWork() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card/40 px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Info className="size-3.5" aria-hidden /> How Rankings Work
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="how-title" onClick={() => setOpen(false)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto scrollbar-brand rounded-xl border border-border bg-card p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 id="how-title" className="font-display text-lg font-bold">How Rankings Work</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-muted-foreground hover:text-foreground"><X className="size-5" /></button>
            </div>
            <div className="space-y-3 text-sm text-muted-foreground">
              <p><span className="font-semibold text-foreground">Rating (Elo).</span> Everyone starts at <span className="tabular">1500</span>. Each completed match adjusts both players&apos; Rating by the standard Elo formula (K=32): beating a higher-rated opponent gains more, beating a lower-rated one gains less. Group and playoff matches count equally — placement, format, race length, and score margin never change the Rating. Winning a tournament is shown separately as Tournament Wins (trophies).</p>
              <p><span className="font-semibold text-foreground">Current vs All Time.</span> <span className="font-medium text-foreground">Current</span> is a rolling 365-day ladder — only matches from the last year count, and everyone re-starts at 1500 within that window. <span className="font-medium text-foreground">All Time</span> includes every completed result. Wins, Rating, streaks, and Highest Achieved all follow the selected view.</p>
              <p><span className="font-semibold text-foreground">Forfeits.</span> A forfeit counts as an official win/loss in the record and can affect a streak, but it changes no Rating — no competitive game was played.</p>
              <p><span className="font-semibold text-foreground">Team matches.</span> Each team&apos;s effective Rating is the average of its registered players&apos; Ratings; the resulting change is applied to every player on the team. Team names never get their own ladder record.</p>
              <p><span className="font-semibold text-foreground">Inactivity.</span> Rating never decays for sitting out. <span className="font-medium text-foreground">Idle</span> just shows the whole days since your latest completed match.</p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
