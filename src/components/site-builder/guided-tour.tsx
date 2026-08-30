'use client'

/**
 * The first-run tour.
 *
 * ── Why it is six steps and not a walkthrough ────────────────────────────────────────────────────
 * A tour that stops you at every control is a tour people dismiss on step two and never reopen. This
 * one answers the questions somebody actually has the first time they open an editor they did not
 * build: what am I looking at, how do I change something, and — the one that matters — what happens
 * if I get it wrong. Everything else is discoverable.
 *
 * ── Why it remembers in localStorage rather than the database ────────────────────────────────────
 * "Have I seen the tour" is a property of this browser, not of the account: seeing it on a laptop
 * should not stop it appearing the first time the Owner opens the editor on a tablet. It is also the
 * one thing here that genuinely does not matter if it is lost, which is exactly what localStorage is
 * for. Every read and write is wrapped, because a private window throws on access and a tour must
 * never be the reason the editor fails to load.
 */

import { useState, useSyncExternalStore } from 'react'
import { ArrowLeft, ArrowRight, HelpCircle, X } from 'lucide-react'

import { cn } from '@/lib/utils'

const SEEN_KEY = '8br-site-builder-tour-v1'

const STEPS: { title: string; body: string }[] = [
  {
    title: 'This is the real page',
    body: 'Not a preview of it. The rankings are the real rankings and the marquee is the real marquee, so what you see while editing is what visitors get when you publish.',
  },
  {
    title: 'Click anything to select it',
    body: 'Its settings appear on the right. The strip above a selected module has move, duplicate, replace, hide and delete. Nothing needs a precise drag — the arrows and the Layers panel do the same job.',
  },
  {
    title: 'Add from the left',
    body: 'Search the Modules panel, or press Ctrl+K and type what you want. Modules marked LIVE read real competition data; you choose what they show, never the figures themselves.',
  },
  {
    title: 'Desktop, tablet, phone',
    body: 'The three device buttons narrow the page and switch which layout you are editing. Tablet and phone follow desktop until you deliberately change them, and can be reset back.',
  },
  {
    title: 'Nothing is live until you publish',
    body: 'Everything saves as a draft only you can see. Publish makes it live for everyone and keeps the previous version, so you can roll back at any time.',
  },
  {
    title: 'You cannot break the site',
    body: 'A module with a bad setting shows a warning and falls back. A layout that cannot be read is skipped for the last one that worked. Deleted modules go to the trash for 30 days. Admin → Site Builder has the history, the trash and a reset.',
  },
]

/**
 * Has this browser seen the tour?
 *
 * `useSyncExternalStore` rather than reading localStorage in an effect: it is given the server
 * snapshot and the client snapshot separately, so the server renders nothing, the client renders the
 * truth, and there is no state update during commit for the React compiler to object to — or extra
 * frame where the tour flashes into view on a browser that has already dismissed it.
 *
 * Both accessors are wrapped. A private window throws on localStorage, and a tour must never be the
 * reason the editor fails to load.
 */
const subscribeNever = () => () => {}
const hasSeenTour = () => {
  try { return !!window.localStorage.getItem(SEEN_KEY) } catch { return true }
}

export function GuidedTour() {
  const seen = useSyncExternalStore(subscribeNever, hasSeenTour, () => true)
  const [dismissed, setDismissed] = useState(false)
  const [reopened, setReopened] = useState(false)
  const [step, setStep] = useState(0)

  const open = reopened || (!seen && !dismissed)

  const close = () => {
    setDismissed(true)
    setReopened(false)
    try { window.localStorage.setItem(SEEN_KEY, '1') } catch { /* nothing to remember with */ }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setStep(0); setReopened(true) }}
        title="How this works"
        aria-label="How this works"
        className="fixed bottom-3 right-3 z-[75] flex size-9 items-center justify-center border border-[var(--line-strong)] bg-[var(--graphite)] text-muted-foreground transition hover:border-[var(--hot-red)] hover:text-foreground"
      >
        <HelpCircle className="size-4" aria-hidden />
      </button>
    )
  }

  const current = STEPS[step]
  const last = step === STEPS.length - 1

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="How the site builder works">
      <div className="flex w-full max-w-md flex-col gap-3 border border-[var(--line-strong)] bg-[var(--graphite)] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow text-muted-foreground">Step {step + 1} of {STEPS.length}</p>
            <h2 className="font-display text-lg font-black uppercase tracking-tight text-foreground">{current.title}</h2>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <p className="text-sm leading-relaxed text-muted-foreground">{current.body}</p>

        <div className="flex items-center gap-1" aria-hidden>
          {STEPS.map((_, i) => (
            <span key={i} className={cn('h-0.5 flex-1', i <= step ? 'bg-[var(--hot-red)]' : 'bg-border')} />
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={close}
            className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground"
          >
            Skip
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={step === 0}
              onClick={() => setStep((s) => s - 1)}
              className="flex items-center gap-1 border border-border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              <ArrowLeft className="size-3" aria-hidden /> Back
            </button>
            <button
              type="button"
              onClick={() => (last ? close() : setStep((s) => s + 1))}
              className="flex items-center gap-1 bg-[var(--hot-red)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-white"
            >
              {last ? 'Start editing' : 'Next'}
              {!last && <ArrowRight className="size-3" aria-hidden />}
            </button>
          </div>
        </div>

        <p className="text-[10px] text-muted-foreground">
          Reopen this any time from the <HelpCircle className="inline size-3" aria-hidden /> button in the corner.
        </p>
      </div>
    </div>
  )
}
