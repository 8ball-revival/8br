/**
 * Turning stored style overrides into classes and custom properties.
 *
 * ── Why steps rather than pixels ─────────────────────────────────────────────────────────────────
 * A style override stores `paddingY: 4`, meaning the fourth step of the site's spacing scale. The
 * alternative — storing `16px` — is what makes page-builder output look like page-builder output:
 * somebody eventually types 13, nothing else on the site uses 13, and the page stops belonging to
 * the design. Steps also mean a retuned scale retunes every built page with it.
 *
 * ── Why a lookup table and not string interpolation ──────────────────────────────────────────────
 * Tailwind compiles the classes it can SEE. `p-${n}` is invisible to it and produces a class that
 * exists in the HTML and nowhere in the stylesheet — the layout silently loses its padding in a
 * production build while working perfectly in dev, which is the worst way for this to fail. Every
 * class below is written out in full so the compiler finds it.
 */

import type { Breakpoint, ModuleInstance, Section, StyleOverrides } from './document'
import { resolveLayout } from './document'
import { cn } from '@/lib/utils'

/** Spacing steps, written in full so Tailwind can see them. Index is the stored step. */
const PAD_X = ['px-0', 'px-1', 'px-2', 'px-3', 'px-4', 'px-5', 'px-6', 'px-8', 'px-10', 'px-12', 'px-16'] as const
const PAD_Y = ['py-0', 'py-1', 'py-2', 'py-3', 'py-4', 'py-5', 'py-6', 'py-8', 'py-10', 'py-12', 'py-16'] as const
const GAP = ['gap-0', 'gap-1', 'gap-2', 'gap-3', 'gap-4', 'gap-5', 'gap-6', 'gap-8', 'gap-10', 'gap-12', 'gap-16'] as const

const ALIGN = { start: 'items-start', center: 'items-center', end: 'items-end', stretch: 'items-stretch' } as const
const JUSTIFY = { start: 'justify-start', center: 'justify-center', end: 'justify-end', between: 'justify-between' } as const
const TEXT_ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const

/**
 * Borders and corners speak the existing visual language rather than inventing one.
 * `cyber-clip` is the site's clipped-corner treatment; `dl-surface` is what makes a panel answer the
 * Display Lab's Frame, Corner, Texture and Depth controls.
 */
const BORDER = {
  none: '',
  thin: 'border border-border',
  strong: 'border border-[var(--line-strong)]',
  accent: 'border border-[var(--hot-red)]',
} as const
const RADIUS = { none: 'rounded-none', clip: 'cyber-clip', sm: 'rounded-sm', md: 'rounded-md' } as const
const SHADOW = { none: '', soft: 'shadow-lg shadow-black/30', glow: 'dl-glow' } as const

function step(table: readonly string[], v: number | undefined): string {
  if (v === undefined) return ''
  return table[Math.min(table.length - 1, Math.max(0, Math.round(v)))]
}

/** Classes for a style override block. */
export function styleClasses(style: StyleOverrides | undefined): string {
  if (!style) return ''
  return cn(
    step(PAD_X, style.paddingX),
    step(PAD_Y, style.paddingY),
    step(GAP, style.gap),
    style.align && ALIGN[style.align],
    style.justify && JUSTIFY[style.justify],
    style.textAlign && TEXT_ALIGN[style.textAlign],
    style.border && BORDER[style.border],
    style.radius && RADIUS[style.radius],
    style.shadow && SHADOW[style.shadow],
    (style.background || style.backgroundMediaId) && 'dl-surface relative isolate',
  )
}

/**
 * Inline custom properties for the values that genuinely cannot be a class.
 *
 * Only three, and each is a validated scalar rather than a string from the client: a token or hex
 * colour, a pixel minimum height, an overlay percentage. Nothing here concatenates administrator
 * input into a declaration.
 */
export function styleVars(style: StyleOverrides | undefined): React.CSSProperties | undefined {
  if (!style) return undefined
  const out: Record<string, string> = {}
  if (style.background) out.backgroundColor = style.background
  if (style.minHeight) out.minHeight = `${style.minHeight * 4}px`
  if (style.backgroundOverlay !== undefined) out['--sb-overlay'] = String(style.backgroundOverlay / 100)
  return Object.keys(out).length ? out as React.CSSProperties : undefined
}

// ── Grid ────────────────────────────────────────────────────────────────────────────────────────

/**
 * The section grid.
 *
 * Ratios become `fr` units through an inline `grid-template-columns`, because the site's existing
 * rows are 58/42 and 55/45 and no utility class expresses those. The generated value is built only
 * from numbers the validator has already clamped, so nothing arbitrary reaches the style attribute.
 *
 * Below the largest breakpoint the grid collapses to one column by default, which is what the
 * hand-written homepage already did (`lg:grid-cols-[...]` with no base columns). A section that
 * declares its own tablet or mobile ratios overrides that.
 */
export function gridTemplate(columns: number[] | undefined): string | undefined {
  if (!columns || columns.length === 0) return undefined
  if (columns.length === 1) return undefined
  return columns.map((n) => `minmax(0,${n}fr)`).join(' ')
}

export function sectionGridStyle(section: Section): React.CSSProperties {
  const out: Record<string, string> = {}
  const desktop = gridTemplate(section.columns.desktop)
  const tablet = gridTemplate(section.columns.tablet)
  const mobile = gridTemplate(section.columns.mobile)
  // Consumed by the `sb-grid` rule in globals.css, which applies each at its own breakpoint. Doing
  // it with custom properties rather than three class strings is what lets an arbitrary ratio work.
  if (desktop) out['--sb-cols-desktop'] = desktop
  if (tablet) out['--sb-cols-tablet'] = tablet
  if (mobile) out['--sb-cols-mobile'] = mobile
  return out as React.CSSProperties
}

/** Column span classes for a module at each breakpoint, written out so Tailwind sees them. */
const SPAN_DESKTOP = ['', 'lg:col-span-1', 'lg:col-span-2', 'lg:col-span-3', 'lg:col-span-4', 'lg:col-span-5', 'lg:col-span-6', 'lg:col-span-7', 'lg:col-span-8', 'lg:col-span-9', 'lg:col-span-10', 'lg:col-span-11', 'lg:col-span-12'] as const
const SPAN_TABLET = ['', 'md:col-span-1', 'md:col-span-2', 'md:col-span-3', 'md:col-span-4', 'md:col-span-5', 'md:col-span-6', 'md:col-span-7', 'md:col-span-8'] as const
const SPAN_MOBILE = ['', 'col-span-1', 'col-span-2', 'col-span-3', 'col-span-4'] as const

export function moduleSpanClasses(instance: ModuleInstance, section: Section): string {
  // A section that declares explicit ratios places its modules one per column, so a span would
  // fight the template. Spans only apply to an even grid.
  const explicitRatios = (section.columns.desktop?.length ?? 0) > 1
    && section.columns.desktop.some((n) => n !== section.columns.desktop[0])
  if (explicitRatios) return ''
  const d = resolveLayout(instance.layout, 'desktop').span
  const t = resolveLayout(instance.layout, 'tablet').span
  const m = resolveLayout(instance.layout, 'mobile').span
  return cn(
    d && SPAN_DESKTOP[Math.min(12, Math.max(1, d))],
    t && SPAN_TABLET[Math.min(8, Math.max(1, t))],
    m && SPAN_MOBILE[Math.min(4, Math.max(1, m))],
  )
}

/** Breakpoint visibility, from the module's own `hideOn` list. */
const HIDE = { desktop: 'lg:hidden', tablet: 'md:max-lg:hidden', mobile: 'max-md:hidden' } as const

export function visibilityClasses(hideOn: Breakpoint[] | undefined): string {
  if (!hideOn?.length) return ''
  return cn(...hideOn.map((b) => HIDE[b]))
}
