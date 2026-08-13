'use client'

import { useId, useState } from 'react'
import { hexToRgb, rgbToHex, normalizeHex, clamp255 } from '@/lib/theme/color'

/**
 * A single source-color control: swatch (native RGB picker) + synchronized R/G/B number fields +
 * hex field. Editing any input updates the others and the parent immediately. Values are constrained
 * to 0–255 / #rrggbb; no alpha, no arbitrary CSS. `value` is always a canonical #rrggbb.
 */
export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  const uid = useId()
  const { r, g, b } = hexToRgb(value)
  const [hexText, setHexText] = useState(value)
  const [hexBad, setHexBad] = useState(false)
  const [prevValue, setPrevValue] = useState(value)

  // Sync the editable hex text when `value` changes from another control (picker / RGB). Adjusting
  // state during render is React's recommended alternative to a setState-in-effect for derived state.
  if (value !== prevValue) { setPrevValue(value); setHexText(value); setHexBad(false) }

  const setChannel = (ch: 'r' | 'g' | 'b', raw: string) => {
    const n = clamp255(Number(raw) || 0)
    const next = { r, g, b, [ch]: n }
    onChange(rgbToHex(next))
  }

  const commitHex = (raw: string) => {
    setHexText(raw)
    const norm = normalizeHex(raw)
    if (norm) { setHexBad(false); onChange(norm) } else setHexBad(true)
  }

  const channel = (ch: 'r' | 'g' | 'b', v: number) => (
    <label className="flex flex-1 flex-col gap-1">
      <span className="text-[0.6rem] font-medium uppercase tracking-wide text-muted-foreground">{ch.toUpperCase()}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={255}
        value={v}
        onChange={(e) => setChannel(ch, e.target.value)}
        aria-label={`${label} ${ch === 'r' ? 'red' : ch === 'g' ? 'green' : 'blue'} (0–255)`}
        className="w-full rounded-md border border-input bg-surface px-2 py-1.5 text-sm tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </label>
  )

  return (
    <fieldset className="rounded-lg border border-border bg-card p-3">
      <legend className="px-1 text-sm font-semibold text-foreground">{label}</legend>
      <div className="flex items-center gap-3">
        {/* Swatch opens the native RGB picker; it is a real input so it's keyboard + touch operable. */}
        <label className="relative shrink-0 cursor-pointer" title={`Pick ${label.toLowerCase()}`}>
          <span className="sr-only">{label} color picker</span>
          <span aria-hidden className="block size-11 rounded-md border border-border shadow-inner" style={{ backgroundColor: value }} />
          <input
            id={`${uid}-swatch`}
            type="color"
            value={value}
            onChange={(e) => onChange(normalizeHex(e.target.value) ?? value)}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>

        <div className="flex flex-1 gap-2">
          {channel('r', r)}
          {channel('g', g)}
          {channel('b', b)}
        </div>
      </div>

      <label className="mt-3 flex items-center gap-2">
        <span className="text-[0.6rem] font-medium uppercase tracking-wide text-muted-foreground">Hex</span>
        <input
          type="text"
          value={hexText}
          onChange={(e) => commitHex(e.target.value)}
          spellCheck={false}
          aria-label={`${label} hex value`}
          aria-invalid={hexBad}
          className={`w-32 rounded-md border bg-surface px-2 py-1.5 font-mono text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${hexBad ? 'border-destructive' : 'border-input'}`}
        />
        {hexBad && <span className="text-xs text-destructive">Use #rrggbb</span>}
      </label>
    </fieldset>
  )
}
