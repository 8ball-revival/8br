'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Check, Sun } from 'lucide-react'

import { applyThemeToRoot } from '@/lib/theme/apply'
import { saveThemePreference } from '@/lib/theme/actions'
import { readLocalTheme, writeLocalTheme } from '@/lib/theme/local'
import {
  areColorsTooSimilar, CUSTOM_DEFAULT_ACCENT, CUSTOM_DEFAULT_MAIN,
  type ThemePreference, type ThemeType,
} from '@/lib/theme/theme'
import { WCC_DEFAULT_PREFERENCE } from '@/lib/theme/preference'

const CHOICES: { type: ThemeType; label: string }[] = [
  { type: 'WCC_DEFAULT', label: 'Default' },
  { type: 'YAHOO_CLASSIC', label: 'Yahoo' },
  { type: 'CUSTOM', label: 'Custom' },
]

/**
 * Header theme control: a small sun button that opens a compact menu (Default / Yahoo / Custom).
 * Default & Yahoo apply + save instantly (no panel). Custom opens a tiny two-swatch panel (Main +
 * Accent, Save/Cancel) — the engine derives every other color behind the scenes. Signed-in choices
 * save to the account; logged-out choices persist in this browser. Closes on outside-click / Escape.
 */
export function ThemeSwitcher({ initial, signedIn }: { initial: ThemePreference; signedIn: boolean }) {
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const [saved, setSaved] = useState<ThemePreference>(initial)
  const [open, setOpen] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [main, setMain] = useState(initial.mainColor ?? CUSTOM_DEFAULT_MAIN)
  const [accent, setAccent] = useState(initial.accentColor ?? CUSTOM_DEFAULT_ACCENT)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Normalize the document to the authoritative theme on mount. This also clears any theme a PRIOR
  // session left applied to <html> as inline vars during a soft navigation (e.g. logging in over a
  // logged-out custom theme, or signing out) — the account preference / this browser's choice wins.
  useEffect(() => {
    if (signedIn) {
      applyThemeToRoot(initial) // account is the source of truth
      return
    }
    const local = readLocalTheme() ?? WCC_DEFAULT_PREFERENCE
    applyThemeToRoot(local)
    if (local === WCC_DEFAULT_PREFERENCE) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot sync from browser storage on mount
    setSaved(local)
    if (local.type === 'CUSTOM') { setMain(local.mainColor ?? CUSTOM_DEFAULT_MAIN); setAccent(local.accentColor ?? CUSTOM_DEFAULT_ACCENT) }
  }, [signedIn, initial])

  const persist = useCallback(async (pref: ThemePreference): Promise<{ ok: boolean; error?: string }> => {
    if (signedIn) {
      const res = await saveThemePreference(pref)
      if (!res.ok) return res
    } else {
      writeLocalTheme(pref)
    }
    applyThemeToRoot(pref)
    setSaved(pref)
    return { ok: true }
  }, [signedIn])

  const closeAll = useCallback(() => {
    applyThemeToRoot(saved) // undo any live custom preview
    setOpen(false); setCustomOpen(false); setError(null)
  }, [saved])

  // Outside-click + Escape close (mouse / keyboard / touch).
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) closeAll() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); closeAll(); btnRef.current?.focus() } }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey) }
  }, [open, closeAll])

  // Live-preview custom colors as they change (only while the panel is open and the pair is usable).
  useEffect(() => {
    if (customOpen && !areColorsTooSimilar(main, accent)) applyThemeToRoot({ type: 'CUSTOM', mainColor: main, accentColor: accent })
  }, [main, accent, customOpen])

  async function choose(type: ThemeType) {
    if (type === 'CUSTOM') { setError(null); setCustomOpen(true); return }
    setBusy(true)
    await persist({ type, mainColor: null, accentColor: null })
    setBusy(false)
    setOpen(false)
  }

  async function saveCustom() {
    if (areColorsTooSimilar(main, accent)) { setError('Those colors are too similar — choose two more distinct colors.'); return }
    setBusy(true)
    const res = await persist({ type: 'CUSTOM', mainColor: main, accentColor: accent })
    setBusy(false)
    if (!res.ok) { setError(res.error ?? 'Could not save theme.'); return }
    setCustomOpen(false); setOpen(false)
  }

  const isActive = (type: ThemeType) => saved.type === type

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={btnRef}
        type="button"
        aria-label="Change theme"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? closeAll() : setOpen(true))}
        className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Sun className="size-5" aria-hidden />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Theme"
          className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-md border border-border bg-popover p-1 shadow-lg"
        >
          {!customOpen ? (
            CHOICES.map((c) => (
              <button
                key={c.type}
                type="button"
                role="menuitemradio"
                aria-checked={isActive(c.type)}
                disabled={busy}
                onClick={() => choose(c.type)}
                className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
              >
                {c.label}
                {isActive(c.type) && <Check className="size-4 text-brand" aria-hidden />}
              </button>
            ))
          ) : (
            <div className="p-2">
              <p className="mb-2 text-xs font-semibold text-foreground">Custom colors</p>
              <div className="space-y-2">
                <label className="flex items-center justify-between gap-2 text-sm">
                  <span>Main Color</span>
                  <input
                    type="color"
                    value={main}
                    onChange={(e) => { setError(null); setMain(e.target.value) }}
                    aria-label="Main color"
                    className="size-8 cursor-pointer rounded border border-border bg-transparent"
                  />
                </label>
                <label className="flex items-center justify-between gap-2 text-sm">
                  <span>Accent Color</span>
                  <input
                    type="color"
                    value={accent}
                    onChange={(e) => { setError(null); setAccent(e.target.value) }}
                    aria-label="Accent color"
                    className="size-8 cursor-pointer rounded border border-border bg-transparent"
                  />
                </label>
              </div>
              {error && <p className="mt-2 text-xs text-destructive" role="alert">{error}</p>}
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { applyThemeToRoot(saved); setMain(saved.mainColor ?? CUSTOM_DEFAULT_MAIN); setAccent(saved.accentColor ?? CUSTOM_DEFAULT_ACCENT); setError(null); setCustomOpen(false) }}
                  disabled={busy}
                  className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveCustom}
                  disabled={busy}
                  className="rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
