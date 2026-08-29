'use client'

import { useCallback, useId, useRef, useState } from 'react'

import { checkAccent, hexToHsl, hslToHex, parseHex, readableInk, rgbToHex, type Hsl } from '@/lib/display/color'
import { cn } from '@/lib/utils'

/**
 * The accent picker: a saturation/brightness field, a hue rail, and the numbers.
 *
 * ── Why a field and not three sliders ────────────────────────────────────────────────────────────
 * Colour is chosen by eye. Three abstract sliders make you solve for a colour you can already
 * picture, and the old panel's four fixed buttons did not let you picture anything else. A square
 * you drag in is the one control where the answer is visible before you commit to it.
 *
 * ── Why HSV, when the rest of the system speaks HSL ──────────────────────────────────────────────
 * The square is saturation across and BRIGHTNESS down, which is HSV — the arrangement every picker
 * uses, because it puts white in one corner and black along one edge where the hand expects them.
 * HSL's square has a bright band through the middle and white at every top corner, which reads as
 * broken. The conversion to hex is exact either way; only the geometry differs.
 *
 * ── The parts the reader actually needs ──────────────────────────────────────────────────────────
 * A live swatch, the exact hex for pasting, RGB for matching something precise, a row of colours
 * that already work on this site, and the last few they tried. The recents list is what makes
 * experimenting cheap: wandering off and coming back costs one click rather than a remembered code.
 */

interface Hsv { h: number; s: number; v: number }

function hsvToHex({ h, s, v }: Hsv): string {
  const c = (v / 100) * (s / 100)
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x]
      : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x]
  const m = v / 100 - c
  return rgbToHex((r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255)
}

function hexToHsv(hex: string): Hsv | null {
  const rgb = parseHex(hex)
  if (!rgb) return null
  const [r, g, b] = rgb.map((n) => n / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const h = d === 0 ? 0
    : max === r ? 60 * (((g - b) / d) % 6)
      : max === g ? 60 * ((b - r) / d + 2)
        : 60 * ((r - g) / d + 4)
  return {
    h: Math.round(((h % 360) + 360) % 360),
    s: Math.round(max === 0 ? 0 : (d / max) * 100),
    v: Math.round(max * 100),
  }
}

/**
 * Colours that already work here.
 *
 * The site's own signature plus the interface colours it is built from, so the quickest choice is
 * also a coherent one. Every entry clears AA with the ink the system would pick for it.
 *
 * There is deliberately no orange here. `#ff7a3d` is the streak flame, and offering it as an accent
 * both duplicates a colour that already means something and trips `verify-no-brown`, which exists to
 * stop this interface drifting warm. Anyone who wants an orange can still reach one in the square -
 * the shortlist is for colours that are known to work, not every colour that is allowed.
 */
const PRESET_SWATCHES: [string, string][] = [
  ['#f5f4f1', 'Pearl'],
  ['#d8dc2f', 'Acid'],
  ['#13d8e8', 'Cyan'],
  ['#ff2a2a', 'Red'],
  ['#e9b949', 'Gold'],
  ['#35d07f', 'Green'],
  ['#c07af0', 'Purple'],
]

export function ColorPicker({ value, recents, swatches, onChange, onCommit }: {
  value: string
  recents: string[]
  swatches: string[]
  /** Fires continuously while dragging, so the page previews as the hand moves. */
  onChange: (hex: string) => void
  /** Fires when a choice settles, so "recent" means chosen rather than passed over. */
  onCommit: (hex: string) => void
}) {
  const hexId = useId()
  const fieldRef = useRef<HTMLDivElement>(null)
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value) ?? { h: 0, s: 0, v: 96 })
  const [typed, setTyped] = useState(value)

  /*
   * The field holds its own hue and saturation, and this is not duplicated state.
   *
   * Neither is recoverable from a hex once the colour reaches an edge: every black has hue 0 and
   * saturation 0, so deriving the handle position from the colour would fling it to the top-left
   * corner the moment somebody dragged to the bottom, and dragging back would return a different
   * colour from the one they started with. The handle owns the position; the hex owns the result.
   */
  /*
   * Adjusted DURING render, not in an effect.
   *
   * This is the documented way to derive state from a prop: compare against the previous value and
   * set during render, so React re-renders immediately with the corrected state instead of painting
   * the stale one and then correcting it. The effect version worked and cost a cascading render on
   * every colour change — which, on a control whose whole job is to fire continuously while a
   * pointer moves, is the wrong place to be spending renders.
   *
   * The handle is only repositioned when the colour came from OUTSIDE. If it matches what this
   * component last produced, the drag already knows where it is and moving it would fight the hand.
   */
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    setTyped(value)
    const next = hexToHsv(value)
    if (next && hsvToHex(hsv).toLowerCase() !== value.toLowerCase()) setHsv(next)
  }

  const emit = (next: Hsv, commit = false) => {
    setHsv(next)
    const hex = hsvToHex(next)
    setTyped(hex)
    onChange(hex)
    if (commit) onCommit(hex)
  }

  /** Pointer position to saturation/brightness, clamped so a drag off the edge still tracks. */
  const pick = useCallback((e: { clientX: number; clientY: number }, commit = false) => {
    const el = fieldRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const s = Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * 100)
    const v = Math.round((1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))) * 100)
    setHsv((cur) => {
      const next = { ...cur, s, v }
      const hex = hsvToHex(next)
      setTyped(hex)
      onChange(hex)
      if (commit) onCommit(hex)
      return next
    })
  }, [onChange, onCommit])

  /*
   * Pointer capture rather than window listeners.
   *
   * The drag has to keep tracking when the pointer leaves the square — which it will, because people
   * overshoot to reach pure white or pure black. Capture keeps the events coming to this element and
   * releases them automatically, where hand-rolled window listeners leak if the pointer is released
   * over a different document.
   */
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    pick(e)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.buttons !== 1) return
    pick(e)
  }
  const onPointerUp = (e: React.PointerEvent) => pick(e, true)

  /** Arrow keys move the handle, so the field is not pointer-only. */
  const onFieldKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2
    const map: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step],
    }
    const d = map[e.key]
    if (!d) return
    e.preventDefault()
    emit({
      ...hsv,
      s: Math.min(100, Math.max(0, hsv.s + d[0])),
      v: Math.min(100, Math.max(0, hsv.v + d[1])),
    }, true)
  }

  const applyHex = (hex: string, commit = false) => {
    const next = hexToHsv(hex)
    if (!next) return
    setHsv(next)
    onChange(hex.toLowerCase())
    if (commit) onCommit(hex.toLowerCase())
  }

  const rgb = parseHex(value) ?? [0, 0, 0]
  const setChannel = (i: number, raw: string) => {
    const n = Math.min(255, Math.max(0, Number(raw) || 0))
    const next: [number, number, number] = [rgb[0], rgb[1], rgb[2]]
    next[i] = n
    applyHex(rgbToHex(next[0], next[1], next[2]), true)
  }

  const check = checkAccent(value)
  const hueHex = hsvToHex({ h: hsv.h, s: 100, v: 100 })
  const field = 'w-full border border-[var(--line)] bg-[var(--void)] px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]'

  return (
    <div className="space-y-3">
      {/* ── The field ─────────────────────────────────────────────────────────────────────────── */}
      <div
        ref={fieldRef}
        role="application"
        aria-label="Saturation and brightness. Arrow keys adjust."
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={onFieldKey}
        className="relative h-32 w-full cursor-crosshair touch-none border border-[var(--line)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueHex})`,
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
          style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%`, backgroundColor: value }}
        />
      </div>

      {/* ── Hue ───────────────────────────────────────────────────────────────────────────────── */}
      <label className="block">
        <span className="sr-only">Hue</span>
        <input
          type="range" min={0} max={360} step={1} value={hsv.h}
          onChange={(e) => emit({ ...hsv, h: Number(e.target.value) })}
          onPointerUp={() => onCommit(hsvToHex(hsv))}
          className="h-4 w-full cursor-pointer appearance-none rounded-none border border-[var(--line)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          style={{
            background: 'linear-gradient(to right,#f00 0%,#ff0 17%,#0f0 33%,#0ff 50%,#00f 67%,#f0f 83%,#f00 100%)',
          }}
        />
      </label>

      {/* ── The numbers ───────────────────────────────────────────────────────────────────────── */}
      <div className="flex items-end gap-2">
        <span
          className="size-10 shrink-0 border border-[var(--line)]"
          style={{ backgroundColor: value }}
          aria-hidden
        />
        <label htmlFor={hexId} className="min-w-0 flex-1">
          <span className="mb-0.5 block text-[0.62rem] font-semibold uppercase tracking-wider text-muted-foreground">Hex</span>
          <input
            id={hexId} type="text" value={typed} spellCheck={false} maxLength={7}
            onChange={(e) => { setTyped(e.target.value); applyHex(e.target.value) }}
            onBlur={() => applyHex(typed, true)}
            className={cn(field, 'tabular')}
          />
        </label>
        {(['R', 'G', 'B'] as const).map((label, i) => (
          <label key={label} className="w-14 shrink-0">
            <span className="mb-0.5 block text-[0.62rem] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
            <input
              type="number" min={0} max={255} value={rgb[i]}
              onChange={(e) => setChannel(i, e.target.value)}
              className={cn(field, 'tabular dl-no-spinner')}
            />
          </label>
        ))}
      </div>

      {/*
        The contrast warning, on the picker rather than somewhere else.

        The accent is a SURFACE that carries text, so a colour that cannot be read on is a broken
        navigation bar rather than a matter of taste. The reader keeps the choice; they are told, and
        offered the nearest shade that works.
      */}
      {!check.passes && (
        <div role="alert" className="border border-[var(--warning)] p-2 text-[0.68rem] leading-snug text-[var(--warning)]">
          Text on this colour measures {check.ratio.toFixed(1)}:1, under the 4.5:1 needed to read
          comfortably — and the navigation bar and buttons use it as a background.
          {check.suggestion && (
            <button
              type="button"
              onClick={() => applyHex(check.suggestion as string, true)}
              className="mt-1.5 flex items-center gap-1.5 border border-[var(--warning)] px-2 py-1 font-semibold uppercase tracking-wider hover:bg-[var(--warning)] hover:text-[var(--void)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              <span className="size-3 border border-current" style={{ backgroundColor: check.suggestion }} aria-hidden />
              Use the nearest readable shade
            </button>
          )}
        </div>
      )}

      <Swatches label="Site colours" colors={PRESET_SWATCHES.map(([hex, name]) => [hex, name])} current={value} onPick={(h) => applyHex(h, true)} />
      {recents.length > 0 && (
        <Swatches label="Recent" colors={recents.map((h) => [h, h])} current={value} onPick={(h) => applyHex(h, true)} />
      )}
      {swatches.length > 0 && (
        <Swatches label="Saved" colors={swatches.map((h) => [h, h])} current={value} onPick={(h) => applyHex(h, true)} />
      )}
    </div>
  )
}

function Swatches({ label, colors, current, onPick }: {
  label: string
  colors: [string, string][]
  current: string
  onPick: (hex: string) => void
}) {
  return (
    <div>
      <p className="mb-1 text-[0.62rem] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {colors.map(([hex, name]) => (
          <button
            key={`${label}-${hex}`}
            type="button"
            onClick={() => onPick(hex)}
            title={name}
            aria-label={`Use ${name}`}
            aria-pressed={current.toLowerCase() === hex.toLowerCase()}
            className={cn(
              'size-6 border transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
              current.toLowerCase() === hex.toLowerCase() ? 'border-[var(--acid)] ring-1 ring-[var(--acid)]' : 'border-[var(--line)]',
            )}
            style={{ backgroundColor: hex }}
          />
        ))}
      </div>
    </div>
  )
}

/** Exported for the panel, which records what the ink should be whenever a colour settles. */
export { readableInk, hexToHsl, hslToHex }
export type { Hsl }
