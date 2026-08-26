'use client'

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Sliders, X, RotateCcw } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * The HUD panel — every knob the neon layer exposes, in one place.
 *
 * ── Why the settings live on <html> ──────────────────────────────────────────────────────────────
 * Each control writes a `data-*` attribute or a CSS variable onto the document element, and the
 * stylesheet reads them. Nothing here knows what a scanline looks like: it sets `data-scan="off"`
 * and the CSS decides. That keeps the panel a preferences UI rather than a second implementation of
 * the theme, so a change to an effect never needs a matching change in here.
 *
 * ── Why the values are read back before the first paint ──────────────────────────────────────────
 * The inline script in layout.tsx applies the saved settings synchronously in <head>. Without it a
 * reader who turned the glow down would get one frame of full glow on every navigation. This
 * component's `useEffect` only re-syncs its own React state to what that script already applied.
 *
 * ── Motion ───────────────────────────────────────────────────────────────────────────────────────
 * `prefers-reduced-motion` still wins. The animation control can turn motion OFF for someone whose
 * system says nothing, but it cannot turn it back ON for someone whose system asked for less.
 */

const KEY = '8br-hud'

export interface HudSettings {
  intensity: 'off' | 'subtle' | 'standard' | 'overdrive'
  accent: 'yellow' | 'red' | 'white' | 'blue'
  scan: boolean
  grid: boolean
  glow: number // 0–200, a percentage of the declared glow strength
  motion: 'off' | 'calm' | 'normal' | 'fast'
  aberration: boolean
  noise: boolean
  flicker: boolean
  corners: 'chamfer' | 'square' | 'round'
}

export const HUD_DEFAULTS: HudSettings = {
  intensity: 'standard',
  accent: 'yellow',
  scan: true,
  grid: true,
  glow: 100,
  motion: 'normal',
  aberration: false,
  noise: true,
  flicker: false,
  corners: 'chamfer',
}

/** The single place that turns settings into DOM state. Shared with the pre-paint script. */
export function applyHud(s: HudSettings) {
  const el = document.documentElement
  el.dataset.hudIntensity = s.intensity
  el.dataset.hudAccent = s.accent
  el.dataset.hudScan = s.scan ? 'on' : 'off'
  el.dataset.hudGrid = s.grid ? 'on' : 'off'
  el.dataset.hudMotion = s.motion
  el.dataset.hudAberration = s.aberration ? 'on' : 'off'
  el.dataset.hudNoise = s.noise ? 'on' : 'off'
  el.dataset.hudFlicker = s.flicker ? 'on' : 'off'
  el.dataset.hudCorners = s.corners
  // The user multiplier only. The intensity preset supplies the other factor, from the sheet.
  el.style.setProperty('--hud-glow-user', String(s.glow / 100))
}

/*
 * The stored settings are the source of truth, and the panel subscribes to them.
 *
 * This was a `useState` seeded in an effect, which meant the component held a SECOND copy of a value
 * that already exists in localStorage and on <html> — so the copy had to be kept in step by hand,
 * and the mount-time sync was a synchronous setState inside an effect (the thing that causes a
 * cascading render). Reading the store directly removes the copy: there is one value, the panel
 * renders whatever it currently says, and a change in another tab arrives through the same path as
 * a change made here.
 */
const listeners = new Set<() => void>()

function subscribe(cb: () => void) {
  listeners.add(cb)
  window.addEventListener('storage', cb)
  return () => { listeners.delete(cb); window.removeEventListener('storage', cb) }
}

/*
 * The RAW string is the snapshot, not the parsed object.
 *
 * getSnapshot has to return a stable reference or React re-renders forever; parsing here would mint
 * a new object on every call. The string is compared by value, and the parse happens once per change
 * in a memo below.
 */
function getSnapshot(): string {
  try { return localStorage.getItem(KEY) ?? '' } catch { return '' }
}
const getServerSnapshot = () => ''

function write(next: HudSettings | null) {
  applyHud(next ?? HUD_DEFAULTS)
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next))
    else localStorage.removeItem(KEY)
  } catch { /* private mode: the settings apply for this session and are not persisted */ }
  listeners.forEach((cb) => cb())
}

/** The values each choice may legally hold. Anything else in storage is stale or tampered with. */
const ALLOWED = {
  intensity: ['off', 'subtle', 'standard', 'overdrive'],
  accent: ['yellow', 'red', 'white', 'blue'],
  motion: ['off', 'calm', 'normal', 'fast'],
  corners: ['chamfer', 'square', 'round'],
} as const

/**
 * Read the stored settings, discarding any value that is no longer offered.
 *
 * ── Why this is not paranoia ─────────────────────────────────────────────────────────────────────
 * The accent palette changed: Cyan, Magenta and Green were replaced by Red, White and Blue. Anybody
 * whose browser still holds `accent: "magenta"` would otherwise get `data-hud-accent="magenta"` on
 * the document, no stylesheet rule to match it, and a control panel showing nothing selected —
 * a setting that is neither the old one nor a new one.
 *
 * Falling back per FIELD rather than discarding the whole object means a stale accent does not also
 * reset somebody's glow, motion and corner preferences.
 */
function parse(raw: string): HudSettings {
  if (!raw) return HUD_DEFAULTS
  try {
    const stored = { ...HUD_DEFAULTS, ...(JSON.parse(raw) as Partial<HudSettings>) }
    for (const [field, allowed] of Object.entries(ALLOWED) as [keyof typeof ALLOWED, readonly string[]][]) {
      if (!allowed.includes(stored[field] as string)) {
        (stored as Record<string, unknown>)[field] = HUD_DEFAULTS[field]
      }
    }
    // The slider is a number with a range, so it is clamped rather than matched against a list.
    if (typeof stored.glow !== 'number' || !Number.isFinite(stored.glow)) stored.glow = HUD_DEFAULTS.glow
    stored.glow = Math.min(200, Math.max(0, stored.glow))
    return stored
  } catch {
    return HUD_DEFAULTS
  }
}

export function HudSettingsPanel() {
  const [open, setOpen] = useState(false)
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const s = useMemo(() => parse(raw), [raw])

  const set = useCallback(
    <K extends keyof HudSettings>(k: K, v: HudSettings[K]) => write({ ...parse(getSnapshot()), [k]: v }),
    [],
  )

  const reset = useCallback(() => write(null), [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Display settings"
        data-testid="hud-trigger"
        className={cn(
          'cyber-clip-sm fixed bottom-4 right-4 z-[9998] inline-flex size-11 items-center justify-center',
          'border border-[var(--neon-line)] bg-[var(--surface)] text-[var(--neon-cyan)] transition-all duration-200',
          'hover:border-[var(--neon-cyan)] hover:[box-shadow:var(--glow-cyan)]',
          open && 'border-[var(--neon-cyan)] [box-shadow:var(--glow-cyan)]',
        )}
      >
        <Sliders className="size-5" aria-hidden />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Display settings"
          className="cyber-clip fixed bottom-20 right-4 z-[9998] max-h-[78vh] w-[19rem] overflow-y-auto border border-[var(--neon-line)] bg-[var(--surface)] p-4 [box-shadow:0_0_40px_color-mix(in_oklab,var(--cyan)_16%,transparent),0_20px_60px_oklch(0_0_0/0.7)]"
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="eyebrow neon-text-cyan">Display</p>
            <div className="flex items-center gap-1">
              <button type="button" onClick={reset} aria-label="Reset to defaults" className="p-1 text-muted-foreground hover:text-[var(--neon-cyan)]">
                <RotateCcw className="size-3.5" aria-hidden />
              </button>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="p-1 text-muted-foreground hover:text-[var(--neon-cyan)]">
                <X className="size-4" aria-hidden />
              </button>
            </div>
          </div>

          <Choice
            label="Intensity" value={s.intensity} onChange={(v) => set('intensity', v)}
            options={[['off', 'Off'], ['subtle', 'Subtle'], ['standard', 'Standard'], ['overdrive', 'Overdrive']]}
            hint="Off keeps the palette and drops every effect."
          />
          <Choice
            label="Accent" value={s.accent} onChange={(v) => set('accent', v)}
            options={[['yellow', 'Yellow'], ['red', 'Red'], ['white', 'White'], ['blue', 'Blue']]}
            hint="Repoints the signature colour across the whole site."
          />
          <Choice
            label="Corners" value={s.corners} onChange={(v) => set('corners', v)}
            options={[['chamfer', 'Chamfer'], ['square', 'Square'], ['round', 'Round']]}
          />
          <Choice
            label="Motion" value={s.motion} onChange={(v) => set('motion', v)}
            options={[['off', 'Off'], ['calm', 'Calm'], ['normal', 'Normal'], ['fast', 'Fast']]}
            hint="A system reduced-motion setting always wins."
          />

          <label className="mt-4 block">
            <span className="flex items-baseline justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Glow <span className="tabular text-[var(--neon-cyan)]">{s.glow}%</span>
            </span>
            <input
              type="range" min={0} max={200} step={10} value={s.glow}
              onChange={(e) => set('glow', Number(e.target.value))}
              className="mt-2 w-full accent-[var(--neon-cyan)]"
            />
          </label>

          <div className="mt-4 space-y-1">
            <Toggle label="Scanlines" on={s.scan} onChange={(v) => set('scan', v)} />
            <Toggle label="Grid" on={s.grid} onChange={(v) => set('grid', v)} />
            <Toggle label="Film grain" on={s.noise} onChange={(v) => set('noise', v)} />
            <Toggle label="Chromatic aberration" on={s.aberration} onChange={(v) => set('aberration', v)} />
            <Toggle label="CRT flicker" on={s.flicker} onChange={(v) => set('flicker', v)} />
          </div>

          <p className="mt-4 text-[0.7rem] leading-snug text-muted-foreground">
            Saved in this browser only. Nothing here changes the data — every rating, rank and result
            is the same whichever way this is set.
          </p>
        </div>
      )}
    </>
  )
}

function Choice<T extends string>({ label, value, onChange, options, hint }: {
  label: string
  value: T
  onChange: (v: T) => void
  options: [T, string][]
  hint?: string
}) {
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {options.map(([v, l]) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            aria-pressed={value === v}
            className={cn(
              'cyber-clip-sm border px-2 py-1 text-[0.7rem] font-semibold uppercase tracking-wide transition-all duration-150',
              value === v
                ? 'border-[var(--neon-cyan)] text-[var(--neon-cyan)] [box-shadow:var(--glow-cyan)]'
                : 'border-[var(--neon-line)] text-muted-foreground hover:text-foreground',
            )}
          >
            {l}
          </button>
        ))}
      </div>
      {hint && <p className="mt-1 text-[0.68rem] leading-snug text-muted-foreground/80">{hint}</p>}
    </div>
  )
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex w-full items-center justify-between py-1 text-left text-sm text-foreground"
    >
      <span>{label}</span>
      <span
        className={cn(
          'relative h-4 w-8 border transition-all duration-200',
          on ? 'border-[var(--neon-cyan)] [box-shadow:var(--glow-cyan)]' : 'border-[var(--neon-line)]',
        )}
        aria-hidden
      >
        <span
          className={cn(
            'absolute top-[2px] size-[10px] transition-all duration-200',
            on ? 'left-[18px] bg-[var(--neon-cyan)]' : 'left-[2px] bg-muted-foreground',
          )}
        />
      </span>
    </button>
  )
}
