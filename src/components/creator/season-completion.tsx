'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Crown } from 'lucide-react'

import { cn } from '@/lib/utils'
import { previewCompletionAction, closeSeasonAction } from '@/lib/seasons/actions'
import type { CompletionReadiness } from '@/lib/seasons/close'

/**
 * Close Season & Crown Champion.
 *
 * ── It does not appear early ─────────────────────────────────────────────────────────────────────
 * The control is absent until the Final has a winner and nothing is awaiting review, rather than
 * present and disabled. A disabled button for a Season three rounds from finishing is an invitation
 * to keep checking whether it has become clickable; its absence says the same thing more quietly.
 *
 * ── And it does not happen by itself ─────────────────────────────────────────────────────────────
 * Saving the Final does not complete the Season. Completion awards a title and rewrites the ranking
 * ledger, and both should follow from somebody deciding the competition is over — not from the last
 * score happening to land.
 */
export function SeasonCompletion({ seasonId, readiness }: { seasonId: number; readiness: CompletionReadiness }) {
  const [pending, start] = useTransition()
  const [confirm, setConfirm] = useState<CompletionReadiness | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (readiness.alreadyCompleted) return null

  if (!readiness.ok) {
    // Say what is outstanding, without offering a control that would refuse.
    return (
      <ul className="space-y-1 rounded-md border border-border bg-card/40 px-3 py-2 text-xs text-muted-foreground">
        {readiness.problems.map((p, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 size-3 shrink-0 text-muted-foreground/60" aria-hidden />{p}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setConfirm(await previewCompletionAction(seasonId)))}
        className="inline-flex items-center gap-1.5 rounded-full bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
      >
        <Crown className="size-4" aria-hidden /> Close Season &amp; Crown Champion
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}

      {confirm && (
        <CompletionDialog
          seasonId={seasonId}
          readiness={confirm}
          onCancel={() => setConfirm(null)}
          onError={(t) => { setConfirm(null); setError(t) }}
        />
      )}
    </div>
  )
}

function CompletionDialog({
  seasonId, readiness, onCancel, onError,
}: {
  seasonId: number
  readiness: CompletionReadiness
  onCancel: () => void
  onError: (t: string) => void
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      role="dialog" aria-modal="true" aria-labelledby="close-season-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-xl">
        <h2 id="close-season-title" className="font-display text-lg font-bold text-foreground">
          Close Season &amp; Crown Champion?
        </h2>

        <dl className="mt-3 space-y-1.5 text-sm">
          <Row label="Champion">
            <span className="font-semibold text-[var(--gold)]">
              {readiness.championName}{readiness.byForfeit && <span aria-hidden>*</span>}
            </span>
          </Row>
          <Row label="Runner-up">{readiness.runnerUpName ?? '—'}</Row>
          <Row label="Final">{readiness.byForfeit ? 'Won by forfeit' : readiness.finalScore ?? '—'}</Row>
        </dl>

        {readiness.byForfeit && (
          <p className="mt-3 rounded-md border border-[var(--gold)]/40 bg-[var(--gold)]/[0.06] px-3 py-2 text-xs text-foreground">
            <b>FINAL WON BY FORFEIT</b><br />
            * Championship awarded after the opponent forfeited the Final. The title is awarded; no
            competitive win, rating, games, differential or streak is recorded for it.
          </p>
        )}

        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>The Season Championship is awarded to {readiness.championName}.</li>
          <li>The Rankings contribution for this Season is finalised.</li>
          <li>The Season moves from Manage Open to Modify Completed, where it stays correctable.</li>
        </ul>

        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={onCancel}
            className="rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => {
              const r = await closeSeasonAction(seasonId)
              if (r.error) { onError(r.error); return }
              onCancel()
              // The completed public page is the thing everybody is about to look at.
              router.push(`/seasons/${seasonId}`)
              router.refresh()
            })}
            className="rounded-full bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? 'Closing…' : 'Close Season'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('text-right text-foreground')}>{children}</dd>
    </div>
  )
}
