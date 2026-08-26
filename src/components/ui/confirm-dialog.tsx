'use client'

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'

/**
 * 8BR confirmation dialog — one reusable, accessible replacement for window.alert/confirm/prompt.
 * Opaque charcoal surface, gold (or red) accent, focus trap, Escape / backdrop cancel,
 * loading state + inline error while the action runs, optional text input (for reasons / typed names),
 * and focus restoration. Drive it imperatively via `useConfirm()`.
 */

export interface ConfirmInput {
  label?: string
  placeholder?: string
  defaultValue?: string
  required?: boolean
  multiline?: boolean
  /** Render as a masked password field (for re-authentication gates). */
  password?: boolean
  /** Typed-name confirmation: the confirm button stays disabled until the input exactly matches this. */
  matchText?: string
}

export interface ConfirmOptions {
  title: string
  message?: React.ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** 'default' = gold; 'warning' = amber; 'danger' = red (irreversible/destructive). */
  tone?: 'default' | 'warning' | 'danger'
  input?: ConfirmInput
  /** When provided, the dialog runs it on confirm, showing a loading state and any returned error
   *  inline (staying open on failure). Return `{ ok:false, error }` to surface an error. */
  action?: (value: string) => Promise<{ ok?: boolean; error?: string } | void>
}

export interface ConfirmResult { confirmed: boolean; value: string }

type Ctx = (opts: ConfirmOptions) => Promise<ConfirmResult>
const DialogContext = createContext<Ctx | null>(null)

/** Imperative confirm/prompt. `await confirm({...})` → { confirmed, value }. */
export function useConfirm(): Ctx {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('useConfirm must be used within <DialogProvider>')
  return ctx
}

interface Active extends ConfirmOptions {
  resolve: (r: ConfirmResult) => void
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<Active | null>(null)

  const confirm = useCallback<Ctx>((opts) => new Promise<ConfirmResult>((resolve) => setActive({ ...opts, resolve })), [])

  return (
    <DialogContext.Provider value={confirm}>
      {children}
      {active && <Dialog key={active.title + active.confirmLabel} opts={active} onClose={() => setActive(null)} />}
    </DialogContext.Provider>
  )
}

function Dialog({ opts, onClose }: { opts: Active; onClose: () => void }) {
  const { title, message, confirmLabel, cancelLabel = 'Cancel', tone = 'default', input, action, resolve } = opts
  const [value, setValue] = useState(input?.defaultValue ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = useId()
  const restoreRef = useRef<HTMLElement | null>(null)

  // Focus management: remember the trigger, focus the input (or confirm), restore on unmount.
  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null
    const first = panelRef.current?.querySelector<HTMLElement>('[data-autofocus]')
    first?.focus()
    return () => restoreRef.current?.focus?.()
  }, [])

  const cancel = useCallback(() => { if (loading) return; resolve({ confirmed: false, value }); onClose() }, [loading, resolve, value, onClose])

  const matchOk = !input?.matchText || value.trim() === input.matchText
  const requiredOk = !input?.required || value.trim().length > 0
  const canConfirm = matchOk && requiredOk && !loading

  const submit = async () => {
    if (!canConfirm) return
    setError(null)
    if (action) {
      setLoading(true)
      try {
        const r = await action(value.trim())
        if (r && 'ok' in r && r.ok === false) { setError(r.error ?? 'Something went wrong.'); setLoading(false); return }
      } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); setLoading(false); return }
    }
    resolve({ confirmed: true, value: value.trim() })
    onClose()
  }

  // Keyboard: Escape cancels; Tab is trapped within the panel.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); return }
    if (e.key === 'Tab') {
      const items = panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input, textarea, [href], [tabindex]:not([tabindex="-1"])')
      if (!items || items.length === 0) return
      const list = Array.from(items)
      const first = list[0], last = list[list.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
  }

  // Theme tokens, not literals, so the dialog follows the design system. Red appears only for the
  // `danger` tone (destructive intent); the default tone is the gold brand accent.
  const accent =
    tone === 'warning' ? 'var(--warning)' : tone === 'danger' ? 'var(--destructive)' : 'var(--gold)'
  const glow = `color-mix(in oklch, ${accent} 40%, transparent)`

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) cancel() }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-hidden />
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? descId : undefined}
        onKeyDown={onKeyDown}
        className="relative w-full max-w-md rounded-xl border bg-popover p-5 text-left shadow-2xl"
        style={{ borderColor: accent, boxShadow: `0 0 0 1px ${accent}, 0 0 28px -6px ${glow}` }}
      >
        <h2 id={titleId} className="font-display text-lg font-bold text-foreground">{title}</h2>
        {message && <div id={descId} className="mt-2 text-sm text-muted-foreground">{message}</div>}

        {input && (
          <div className="mt-4">
            {input.label && <label htmlFor={`${titleId}-input`} className="mb-1.5 block text-xs font-semibold text-foreground">{input.label}</label>}
            {input.multiline ? (
              <textarea id={`${titleId}-input`} data-autofocus value={value} onChange={(e) => setValue(e.target.value)} rows={3} placeholder={input.placeholder} disabled={loading} className="w-full resize-y rounded-none border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25" />
            ) : (
              <input id={`${titleId}-input`} data-autofocus type={input.password ? 'password' : 'text'} value={value} onChange={(e) => setValue(e.target.value)} placeholder={input.placeholder} disabled={loading} onKeyDown={(e) => { if (e.key === 'Enter' && !input.multiline) { e.preventDefault(); if (tone !== 'danger') submit() } }} className="w-full rounded-none border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25" autoComplete={input.password ? 'current-password' : 'off'} />
            )}
          </div>
        )}

        {error && <p role="alert" className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={cancel}
            disabled={loading}
            className="rounded-none border border-input bg-card px-4 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            data-autofocus={input ? undefined : true}
            onClick={submit}
            disabled={!canConfirm}
            className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: accent }}
          >
            {loading && <span className="size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />}
            {loading ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
