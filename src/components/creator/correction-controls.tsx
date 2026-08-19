'use client'

import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Loader2, Lock, Unlock } from 'lucide-react'

import { reopenForCorrectionAction, recompleteAction } from '@/app/(frontend)/creator/actions'
import { cn } from '@/lib/utils'

/**
 * The two buttons that move a completed record in and out of the record, and the dialog that makes
 * sure the operator meant it.
 *
 * ── Why a dialog and not a one-click button ──────────────────────────────────────────────────────
 * Reopening withdraws a competition from the Archives, from the Rankings, from every player's
 * profile statistics, and from the championship evidence. That is a large, wide effect from a small
 * control, and the only honest way to offer it is to say so first and name the record it is about
 * to happen to.
 *
 * The dialog traps focus, Escape closes it, Cancel is the default focus, and the confirm button
 * disables itself for the duration of the request so a double-click cannot send it twice — though
 * the server is idempotent regardless, because a UI guard is not a correctness guarantee.
 */

interface Props {
  kind: 'season' | 'tournament'
  id: number
  title: string
  /** Present when the record is currently open for corrections. */
  reopenedAt: string | null
  /** Blocking problems from the completion review. Recompletion is refused while any stand. */
  errors: string[]
}

export function CorrectionControls({ kind, id, title, reopenedAt, errors }: Props) {
  const [dialog, setDialog] = useState<'reopen' | 'recomplete' | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const run = (action: 'reopen' | 'recomplete', reason: string) => {
    startTransition(async () => {
      const r = action === 'reopen'
        ? await reopenForCorrectionAction(kind, id, reason)
        : await recompleteAction(kind, id, reason)
      setDialog(null)
      setResult({ ok: r.ok, text: r.ok ? (r.message ?? 'Done.') : (r.error ?? 'That did not work.') })
      if (r.ok) router.refresh()
    })
  }

  const label = kind === 'season' ? 'Season' : 'Cup'

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {reopenedAt ? (
          <button
            type="button"
            onClick={() => setDialog('recomplete')}
            disabled={pending || errors.length > 0}
            className={cn(
              'inline-flex items-center gap-2 rounded-md bg-[var(--gold)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)]',
              'transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60',
              (pending || errors.length > 0) && 'cursor-not-allowed opacity-50',
            )}
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Lock className="size-4" aria-hidden />}
            Complete and Republish
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setDialog('reopen')}
            disabled={pending}
            className={cn(
              'inline-flex items-center gap-2 rounded-md border border-[var(--streak-cold)]/60 px-3 py-2 text-sm font-semibold text-[var(--streak-cold)]',
              'transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60',
              pending && 'cursor-not-allowed opacity-50',
            )}
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Unlock className="size-4" aria-hidden />}
            Reopen for Corrections
          </button>
        )}

        {errors.length > 0 && reopenedAt && (
          <p className="text-xs text-[var(--streak-cold)]">
            Cannot complete yet: {errors.join(' ')}
          </p>
        )}
      </div>

      {result && (
        <p
          role="status"
          className={cn('mt-2 rounded border px-2.5 py-1.5 text-xs',
            result.ok ? 'border-border text-muted-foreground' : 'border-[var(--streak-cold)]/50 text-[var(--streak-cold)]')}
        >
          {result.text}
        </p>
      )}

      {dialog === 'reopen' && (
        <ConfirmDialog
          title={`Reopen ${label} for corrections?`}
          confirmLabel="Reopen for Corrections"
          tone="warning"
          pending={pending}
          onCancel={() => setDialog(null)}
          onConfirm={(reason) => run('reopen', reason)}
          record={`${label}: ${title}`}
          consequences={[
            'It leaves the public Archives immediately.',
            'It stops contributing to the Rankings.',
            'It stops contributing to every player’s profile statistics.',
            kind === 'season'
              ? 'Its Season Championship and finals evidence stop counting.'
              : 'Its Cup Title evidence stops counting.',
            'It becomes editable inside Creator.',
            'It will need completion review again before it is republished.',
          ]}
          footnote="Nothing is deleted. Entrants, groups, results, standings, the bracket, its placements, the champion, the dates and the audit history are all preserved exactly as they are."
        />
      )}

      {dialog === 'recomplete' && (
        <ConfirmDialog
          title={`Complete and republish this ${label.toLowerCase()}?`}
          confirmLabel="Complete and Republish"
          tone="confirm"
          pending={pending}
          onCancel={() => setDialog(null)}
          onConfirm={(reason) => run('recomplete', reason)}
          record={`${label}: ${title}`}
          consequences={[
            'It returns to the public Archives.',
            'Its corrected results are applied to the Rankings — once.',
            'Player profiles and championship evidence are updated.',
            'It stays out of Live.',
            'It becomes read-only again.',
          ]}
          footnote="The corrected contribution replaces the old one through a full replay, so nothing can be counted twice."
        />
      )}
    </>
  )
}

/**
 * A confirmation that says what will happen, to what, and makes Cancel the easy answer.
 *
 * Focus is moved to Cancel on open and restored to whatever opened the dialog on close, the panel
 * traps Tab so the page behind cannot be reached while it is up, and Escape closes it.
 */
function ConfirmDialog({
  title, confirmLabel, tone, pending, record, consequences, footnote, onCancel, onConfirm,
}: {
  title: string
  confirmLabel: string
  tone: 'warning' | 'confirm'
  pending: boolean
  record: string
  consequences: string[]
  footnote: string
  onCancel: () => void
  onConfirm: (reason: string) => void
}) {
  const headingId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<Element | null>(null)
  const [reason, setReason] = useState('')

  useEffect(() => {
    openerRef.current = document.activeElement
    // Cancel is the safe answer, so it is where focus lands. Enter on arrival dismisses.
    cancelRef.current?.focus()
    const opener = openerRef.current
    return () => { if (opener instanceof HTMLElement) opener.focus() }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); return }
      if (e.key !== 'Tab' || !panelRef.current) return
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea, input, a[href]',
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="w-full max-w-lg rounded-lg border border-border bg-card p-5 shadow-2xl"
      >
        <h2 id={headingId} className="flex items-start gap-2 font-display text-lg font-bold">
          {tone === 'warning' && <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[var(--streak-cold)]" aria-hidden />}
          {title}
        </h2>

        <p className="mt-2 rounded border border-border bg-white/[0.03] px-2.5 py-1.5 text-sm font-medium">
          {record}
        </p>

        <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
          {consequences.map((c) => (
            <li key={c} className="flex gap-2">
              <span aria-hidden className="mt-[0.45rem] block size-1 shrink-0 rounded-full bg-[var(--gold)]/60" />
              <span>{c}</span>
            </li>
          ))}
        </ul>

        <p className="mt-3 text-xs leading-snug text-muted-foreground">{footnote}</p>

        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-medium">Reason (recorded in the audit log)</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="What is being corrected, and why"
            className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm outline-none focus-visible:border-[var(--gold)]"
          />
        </label>

        <div className="mt-4 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason)}
            disabled={pending}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60',
              tone === 'warning'
                ? 'border border-[var(--streak-cold)]/60 text-[var(--streak-cold)] hover:bg-white/[0.04]'
                : 'bg-[var(--gold)] text-[var(--primary-foreground)] hover:opacity-90',
              pending && 'cursor-not-allowed opacity-50',
            )}
          >
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
