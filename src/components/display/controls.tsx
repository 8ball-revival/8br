'use client'

import { useId } from 'react'

import { cn } from '@/lib/utils'

/**
 * The controls Display Lab is built from.
 *
 * ── Why they are here rather than inline ─────────────────────────────────────────────────────────
 * The panel has around thirty controls. Written inline, "a labelled row with a value readout and a
 * range input" would appear a dozen times, and the twelfth copy is the one where the label is not
 * associated with the input and the value is not announced. Five primitives means the accessibility
 * is written once and every control gets it: a real <label>, a real <input>, `aria-pressed` on
 * segmented choices, and a focus ring that is visible on every ground this panel sits on.
 *
 * They are deliberately plain. This is a preferences UI inside a drawer that is itself previewing
 * theme changes — controls that wore the theme would restyle themselves as the reader dragged them,
 * which makes the panel impossible to use precisely when it matters most. `.dl-quiet` on the drawer
 * keeps the frame, texture and depth settings off its own chrome for the same reason.
 */

export function Section({ title, hint, children }: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="border-t border-[var(--line)] px-4 py-5 first:border-t-0 sm:px-5">
      <h3 className="text-[0.7rem] font-bold uppercase tracking-[0.16em] text-[var(--acid)]">{title}</h3>
      {hint && <p className="mt-1 text-[0.72rem] leading-snug text-muted-foreground">{hint}</p>}
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  )
}

/** A segmented choice. `aria-pressed` rather than a radio group: these apply instantly, like a tab. */
export function Choice<T extends string>({ label, value, onChange, options, hint, columns }: {
  label?: string
  value: T
  onChange: (v: T) => void
  options: readonly (readonly [T, string])[]
  hint?: string
  /** Fixed columns for lists where a ragged wrap would make the options hard to scan. */
  columns?: 2 | 3 | 4
}) {
  return (
    <div>
      {label && <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>}
      <div
        className={cn(
          'mt-1.5 gap-1',
          columns ? 'grid' : 'flex flex-wrap',
          columns === 2 && 'grid-cols-2',
          columns === 3 && 'grid-cols-3',
          columns === 4 && 'grid-cols-2 sm:grid-cols-4',
        )}
      >
        {options.map(([v, l]) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            aria-pressed={value === v}
            className={cn(
              'cyber-clip-sm min-h-9 border px-2 py-1.5 text-[0.7rem] font-semibold uppercase tracking-wide transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
              value === v
                ? 'border-[var(--acid)] bg-[var(--acid)] text-[var(--acid-ink)]'
                : 'border-[var(--line)] text-muted-foreground hover:border-[var(--line-strong)] hover:text-foreground',
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

/**
 * A slider with its value shown.
 *
 * The readout is part of the label rather than a sibling, so a screen reader announces "Glow, 140
 * per cent" instead of the number arriving as unrelated text somewhere on the page. `suffix` covers
 * the handful that are not percentages.
 */
export function Slider({ label, value, onChange, min = 0, max = 200, step = 5, suffix = '%', hint, disabled }: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  hint?: string
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className={cn(disabled && 'opacity-45')}>
      <label htmlFor={id} className="flex items-baseline justify-between gap-2 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        <span className="tabular text-[var(--acid)]">{value}{suffix}</span>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 h-6 w-full accent-[var(--acid)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      />
      {hint && <p className="-mt-1 text-[0.68rem] leading-snug text-muted-foreground/80">{hint}</p>}
    </div>
  )
}

/** An on/off control. A real switch role, so it is operable and announced as one. */
export function Toggle({ label, on, onChange, hint }: {
  label: string
  on: boolean
  onChange: (v: boolean) => void
  hint?: string
}) {
  return (
    <div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className="flex min-h-9 w-full items-center justify-between gap-3 py-1 text-left text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        <span>{label}</span>
        <span
          className={cn(
            /*
             * The lit state is the BORDER and the knob, never a wash of accent across the track.
             *
             * A translucent acid tint over graphite does not render as a paler accent — it mixes to
             * olive, which is the exact fault `verify-no-brown` exists to catch, and it caught this
             * one. A solid void track keeps the switch reading as a switch on every accent a reader
             * can now choose, including the ones that would go muddiest.
             */
            'relative h-4 w-8 shrink-0 border bg-[var(--void)] transition-colors',
            on ? 'border-[var(--acid)]' : 'border-[var(--line)]',
          )}
          aria-hidden
        >
          <span
            className={cn(
              'absolute top-[2px] size-[10px] transition-all duration-200',
              on ? 'left-[18px] bg-[var(--acid)]' : 'left-[2px] bg-muted-foreground',
            )}
          />
        </span>
      </button>
      {hint && <p className="-mt-0.5 text-[0.68rem] leading-snug text-muted-foreground/80">{hint}</p>}
    </div>
  )
}

/**
 * A choice whose options are shown rather than named — textures, frames, backgrounds.
 *
 * ── Why the preview is drawn, not photographed ───────────────────────────────────────────────────
 * Each swatch renders the REAL treatment: the same attribute on a small box, styled by the same
 * rules as a full panel. A picture of a texture is a picture that goes stale the moment the texture
 * is retuned, and it cannot pick up the reader's accent — Holographic in particular is a different
 * material once the accent moves. Drawing it costs one small element and is never wrong.
 */
export function SwatchChoice<T extends string>({ label, value, onChange, options, hint, renderSwatch }: {
  label?: string
  value: T
  onChange: (v: T) => void
  options: readonly (readonly [T, string])[]
  hint?: string
  renderSwatch: (v: T) => React.ReactNode
}) {
  return (
    <div>
      {label && <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>}
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {options.map(([v, l]) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            aria-pressed={value === v}
            className={cn(
              'group flex flex-col gap-1.5 border p-1.5 text-left transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
              value === v ? 'border-[var(--acid)]' : 'border-[var(--line)] hover:border-[var(--line-strong)]',
            )}
          >
            {renderSwatch(v)}
            <span
              className={cn(
                'text-[0.62rem] font-semibold uppercase tracking-wider',
                value === v ? 'text-[var(--acid)]' : 'text-muted-foreground',
              )}
            >
              {l}
            </span>
          </button>
        ))}
      </div>
      {hint && <p className="mt-1.5 text-[0.68rem] leading-snug text-muted-foreground/80">{hint}</p>}
    </div>
  )
}

/**
 * A section that folds away until it is wanted.
 *
 * Built on <details>, not a hand-rolled toggle: it is focusable, it opens on Enter and Space, screen
 * readers announce its state, and browser find-in-page can open it to reveal a match. Every one of
 * those is something a div with an onClick has to reimplement and usually does not.
 *
 * Advanced controls live in these so the tab a reader lands on shows the four or five decisions that
 * matter, and the twenty that occasionally matter stay one click away rather than in the way.
 */
export function Disclosure({ label, hint, children }: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <details className="group border border-[var(--line)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-2 text-[0.66rem] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] [&::-webkit-details-marker]:hidden">
        <span>{label}</span>
        <span aria-hidden className="text-[0.8rem] leading-none transition-transform group-open:rotate-45">+</span>
      </summary>
      <div className="space-y-3 border-t border-[var(--line)] px-2.5 py-3">
        {hint && <p className="-mt-1 text-[0.66rem] leading-snug text-muted-foreground/80">{hint}</p>}
        {children}
      </div>
    </details>
  )
}
