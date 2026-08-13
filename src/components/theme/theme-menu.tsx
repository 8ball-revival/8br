'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { AlertTriangle, Check, Palette, RotateCcw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ColorField } from './color-field'
import { ThemePreview } from './theme-preview'
import { applyThemeToRoot } from '@/lib/theme/apply'
import { saveThemePreference } from '@/lib/theme/actions'
import {
  deriveTheme, CUSTOM_DEFAULT_MAIN, CUSTOM_DEFAULT_ACCENT,
  type ThemePreference, type ThemeType,
} from '@/lib/theme/theme'

const PRESETS: { type: ThemeType; label: string; hint: string }[] = [
  { type: 'WCC_DEFAULT', label: 'WCC Default', hint: 'The signature black & crimson.' },
  { type: 'YAHOO_CLASSIC', label: 'Yahoo Classic', hint: 'Cream, olive & muted gold.' },
  { type: 'CUSTOM', label: 'Custom', hint: 'Your own two colors.' },
]

/** Account-dropdown entry that opens the personal theme editor. */
export function ThemeMenuItem({ initial }: { initial: ThemePreference }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Palette className="size-4" aria-hidden />
        Theme
      </button>
      {open && <ThemeDialog initial={initial} onClose={() => setOpen(false)} />}
    </>
  )
}

function ThemeDialog({ initial, onClose }: { initial: ThemePreference; onClose: () => void }) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreFocus = useRef<HTMLElement | null>(null)

  const [type, setType] = useState<ThemeType>(initial.type)
  const [main, setMain] = useState(initial.mainColor ?? CUSTOM_DEFAULT_MAIN)
  const [accent, setAccent] = useState(initial.accentColor ?? CUSTOM_DEFAULT_ACCENT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  const draft: ThemePreference =
    type === 'CUSTOM' ? { type, mainColor: main, accentColor: accent } : { type, mainColor: null, accentColor: null }
  const derived = deriveTheme(draft)

  // Live preview: apply the draft to the whole page as it changes.
  useEffect(() => { applyThemeToRoot(draft) }, [type, main, accent]) // eslint-disable-line react-hooks/exhaustive-deps

  const cancel = useCallback(() => { applyThemeToRoot(initial); onClose() }, [initial, onClose])

  // Focus management: capture opener, focus the panel, restore on close.
  useEffect(() => {
    restoreFocus.current = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prevOverflow; restoreFocus.current?.focus?.() }
  }, [])

  // Escape closes (= cancel); Tab is trapped within the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); cancel(); return }
      if (e.key !== 'Tab' || !panelRef.current) return
      const f = panelRef.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [cancel])

  async function persist(pref: ThemePreference) {
    setBusy(true); setError(null)
    const res = await saveThemePreference(pref)
    setBusy(false)
    if (!res.ok) { setError(res.error ?? 'Could not save theme.'); return }
    applyThemeToRoot(pref)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onClick={cancel}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-border bg-card p-5 shadow-2xl outline-none sm:rounded-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="flex items-center gap-2 font-display text-xl font-bold">
            <Palette className="size-5 text-brand" aria-hidden /> Theme
          </h2>
          <span className="text-xs text-muted-foreground">Only you see this.</span>
        </div>

        {/* Theme choices */}
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {PRESETS.map((p) => {
            const active = type === p.type
            return (
              <button
                key={p.type}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setType(p.type)}
                className={`rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? 'border-brand bg-brand/[0.06]' : 'border-border hover:bg-accent'}`}
              >
                <span className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{p.label}</span>
                  {active && <Check className="size-4 text-brand" aria-hidden />}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{p.hint}</span>
              </button>
            )
          })}
        </div>

        {/* Custom color controls */}
        {type === 'CUSTOM' && (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ColorField label="Main Color" value={main} onChange={setMain} />
            <ColorField label="Accent Color" value={accent} onChange={setAccent} />
          </div>
        )}

        {/* Accessibility warnings from the derivation */}
        {derived.warnings.length > 0 && (
          <div className="mt-3 flex gap-2 rounded-lg border border-warning/30 bg-warning/[0.06] px-3 py-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <ul className="space-y-1">{derived.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </div>
        )}

        {/* Live preview */}
        <div className="mt-4">
          <p className="eyebrow mb-2 text-muted-foreground">Live preview</p>
          <ThemePreview vars={derived.vars} />
        </div>

        {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}

        {/* Actions */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          {confirmReset ? (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              Reset to WCC Default?
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => persist({ type: 'WCC_DEFAULT', mainColor: null, accentColor: null })}>Confirm</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>No</Button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmReset(true)} disabled={busy}>
              <RotateCcw className="mr-1.5 size-4" aria-hidden /> Reset to WCC Default
            </Button>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={cancel} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={() => persist(draft)} disabled={busy}>{busy ? 'Saving…' : 'Save Theme'}</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
