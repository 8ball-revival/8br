'use client'

import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * The filter command bar: the acid strip beneath the navigation.
 *
 * ── One component, two pages ─────────────────────────────────────────────────────────────────────
 * Rankings and Seasons both open with a row of labelled controls, and before this they were two
 * separate implementations that had drifted into different label sizes, different field heights and
 * different focus treatments. They are the same object, so they are the same component.
 *
 * ── Why every field carries a visible label ──────────────────────────────────────────────────────
 * These bars change every number on the page. A row of bare dropdowns reading "Yahoo", "8BRCAM",
 * "2009" tells you what is selected but not what it selects, and the reader has to open one to find
 * out. The label is small and set in the ink colour at reduced opacity, which keeps it quiet without
 * hiding it.
 *
 * ── Contrast ─────────────────────────────────────────────────────────────────────────────────────
 * Everything here is black on acid. The fields themselves are dark, because a white input on yellow
 * is glare and a yellow input on yellow is invisible; a void-black field reads as a slot cut into
 * the bar. Focus is the cyan ring used everywhere else, which survives on both grounds.
 */
export function FilterCommandBar({
  children,
  actions,
  className,
}: {
  /** The labelled fields, as `<FilterField>` children. */
  children: ReactNode
  /** Right-aligned controls: segmented switches, view toggles, pagination. */
  actions?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'cyber-clip mb-4 flex flex-wrap items-end gap-x-4 gap-y-3 border border-[var(--acid-dim)] bg-[var(--acid)] px-3 py-2.5 text-[var(--acid-ink)]',
        className,
      )}
    >
      {children}
      {actions && <div className="ml-auto flex flex-wrap items-end gap-2">{actions}</div>}
    </div>
  )
}

/** One labelled control. `htmlFor` is required so the label is a real label, not a caption. */
export function FilterField({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string
  htmlFor: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[var(--acid-ink)]/70"
      >
        {label}
      </label>
      {children}
    </div>
  )
}

/**
 * The field styling, exported rather than wrapped.
 *
 * A `<select>` has to be a real `<select>` for the platform's own picker, keyboard behaviour and
 * mobile wheel to work, so this hands back a class string instead of a component that would have to
 * re-implement all of it.
 */
export const filterControl =
  'cyber-clip-sm w-full border border-[var(--acid-ink)]/30 bg-[var(--void)] px-2.5 py-1.5 text-sm ' +
  'text-[var(--clean-white)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cyan)]'

/**
 * A segmented switch: the Overall / Groups / Playoffs / Tournaments control.
 *
 * `radiogroup` rather than a row of buttons, because that is what it is — one choice out of several,
 * arrow-key navigable, and announced as such.
 */
export function SegmentedSwitch<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <span className="mb-1 block text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[var(--acid-ink)]/70">
        {label}
      </span>
      {/*
        Wraps below 360px, and only there.

        Four segments at their natural width come to 330px, which a 320px phone cannot show -- so the
        page scrolled sideways and the last segment, Tournaments, sat off the edge entirely.
        `inline-flex` with no wrap had nowhere else to put it.

        Wrapping rather than shrinking, because the labels ARE the control: "Group Play" truncated to
        "Group P" is not a choice anybody can make confidently. The clipped corner is dropped when it
        wraps, since a two-row group with one cut corner reads as a rendering fault.
      */}
      <div
        role="radiogroup"
        aria-label={label}
        className="cyber-clip-sm inline-flex max-w-full flex-wrap overflow-hidden border border-[var(--acid-ink)]/30 max-[360px]:[clip-path:none]"
      >
        {options.map((o) => {
          const active = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.value)}
              className={cn(
                'px-2.5 py-1.5 text-[0.68rem] font-bold uppercase tracking-wider transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cyan)]',
                active
                  ? 'bg-[var(--void)] text-[var(--acid)]'
                  : 'text-[var(--acid-ink)]/70 hover:bg-[var(--acid-ink)]/10 hover:text-[var(--acid-ink)]',
              )}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
