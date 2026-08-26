import type { ReactNode, ComponentProps, ElementType } from 'react'

import { cn } from '@/lib/utils'

/**
 * The design system's shapes, in one place.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────────────────────────
 * Before this, the same visual idea was implemented three times — the Rankings header, the Season
 * masthead and the bracket panel each grew their own version of "a heading with figures beside it",
 * and they drifted apart because nothing tied them together. Every shape the interface uses is
 * declared here once and imported, so a change to how a panel looks is one edit rather than a sweep.
 *
 * ── The vocabulary ───────────────────────────────────────────────────────────────────────────────
 * Acid is a SURFACE. It carries black ink, it is never translucent, and it is what the navigation,
 * the filter bars and the feature panel are made of. Everything else is graphite with white text,
 * red for technical linework and warnings, cyan for anything you can interact with, and gold
 * reserved strictly for championships.
 *
 * ── Restraint ────────────────────────────────────────────────────────────────────────────────────
 * The clipped corner is the signature, and it is applied to PANELS and PRIMARY CONTROLS only. A
 * table cell, a checkbox and a row of filter chips do not each need a notch cut out of them; a dense
 * table with a chamfer on every element is unreadable, which defeats the point of the table.
 */

/* ─────────────────────────────────────────────────────────────────── page shell ───────────────── */

/**
 * The standard page frame: full-bleed, small responsive gutters, no centred cap.
 *
 * `wide` is the default because this site is mostly tables and brackets, and a centred column wastes
 * the width they need. `narrow` is for prose — an article, a policy page, a form.
 */
export function CyberPage({
  width = 'wide',
  className,
  children,
}: {
  width?: 'wide' | 'narrow'
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'w-full pb-16 pt-4',
        width === 'wide' ? 'max-w-none px-3 sm:px-5' : 'mx-auto max-w-3xl px-4 sm:px-6',
        className,
      )}
    >
      {children}
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────── clipped panel ───────────── */

/**
 * The panel. Graphite ground, hairline edge, and red corner brackets in the two opposite corners.
 *
 * The brackets are drawn with two absolutely-positioned children rather than a border-image or an
 * SVG, so they cost nothing, scale with the panel and cannot go out of sync with its radius. They
 * are decorative and marked `aria-hidden`.
 *
 * `flush` drops the internal padding for a panel whose entire body is a table — a table brings its
 * own cell padding, and doubling it wastes a lot of vertical space on a page of standings.
 */
export function CyberPanel({
  as: Tag = 'section',
  tone = 'default',
  flush = false,
  brackets = true,
  className,
  children,
  ...rest
}: {
  as?: ElementType
  /** `default` graphite · `raised` one step up · `acid` the yellow surface · `danger` red-edged. */
  tone?: 'default' | 'raised' | 'acid' | 'danger'
  flush?: boolean
  brackets?: boolean
  className?: string
  children: ReactNode
} & Omit<ComponentProps<'section'>, 'children'>) {
  return (
    <Tag
      className={cn(
        'cyber-clip relative border',
        tone === 'default' && 'border-[var(--line)] bg-[var(--graphite)] text-foreground',
        tone === 'raised' && 'border-[var(--line-strong)] bg-[var(--graphite-raised)] text-foreground',
        tone === 'acid' && 'border-[var(--acid-dim)] bg-[var(--acid)] text-[var(--acid-ink)]',
        tone === 'danger' && 'border-[var(--hot-red)] bg-[var(--graphite)] text-foreground',
        !flush && 'p-4',
        className,
      )}
      {...rest}
    >
      {brackets && <CornerBrackets tone={tone} />}
      {children}
    </Tag>
  )
}

/** The two red corner marks. Decorative; never announced. */
function CornerBrackets({ tone }: { tone: 'default' | 'raised' | 'acid' | 'danger' }) {
  const stroke = tone === 'acid' ? 'var(--acid-ink)' : 'var(--hot-red)'
  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 size-3 border-l-2 border-t-2"
        style={{ borderColor: stroke }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-0 right-0 size-3 border-b-2 border-r-2"
        style={{ borderColor: stroke }}
      />
    </>
  )
}

/* ─────────────────────────────────────────────────────────────────── section heading ──────────── */

/**
 * A section heading: red label, optional badges beside it, optional action at the far right.
 *
 * Red rather than acid because these sit ON graphite, where acid text is loud enough to compete with
 * the data underneath it. Acid stays a surface; red is how a dark panel is labelled.
 */
export function SectionHeading({
  title,
  badges,
  action,
  as: Tag = 'h2',
  className,
}: {
  title: ReactNode
  badges?: ReactNode
  action?: ReactNode
  as?: ElementType
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-2', className)}>
      <div className="flex flex-wrap items-center gap-3">
        <Tag className="font-display text-sm font-bold uppercase tracking-[0.14em] text-[var(--hot-red)]">
          {title}
        </Tag>
        {badges}
      </div>
      {action}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────── status badge ──────────── */

const BADGE_TONE = {
  /** Neutral metadata: counts, formats, settings. The overwhelming majority. */
  neutral: 'border-[var(--line-strong)] text-muted-foreground',
  /** Something is live or currently happening. */
  live: 'border-[var(--hot-red)] text-[var(--hot-red)]',
  /** A championship, a title, a decided winner. */
  gold: 'border-[var(--gold)] text-[var(--gold)]',
  /** Interactive or data state. */
  cyan: 'border-[var(--cyan)] text-[var(--cyan)]',
  /** Needs attention but is not an error. */
  warn: 'border-[var(--warning)] text-[var(--warning)]',
} as const

/**
 * A small outlined label.
 *
 * Outlined, never filled: a filled badge in one of these colours is a coloured block behind small
 * text, which is both a contrast problem and, for the warm tones, the mud this palette bans. The
 * border carries the colour at full strength and the text stays legible.
 */
export function StatusBadge({
  tone = 'neutral',
  label,
  value,
  className,
}: {
  tone?: keyof typeof BADGE_TONE
  /** The quiet half — what the number means. */
  label?: ReactNode
  /** The loud half. Omit `label` for a plain badge. */
  value?: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'cyber-clip-sm inline-flex items-baseline gap-1.5 border px-2 py-1 text-[0.68rem] font-semibold uppercase tracking-wider',
        BADGE_TONE[tone],
        className,
      )}
    >
      {label != null && <span className="opacity-80">{label}</span>}
      {value != null && <span className="tabular text-foreground">{value}</span>}
    </span>
  )
}

/* ──────────────────────────────────────────────────────────────────────── stat cell ───────────── */

/**
 * One figure with its label. The unit the glance strips and readouts are built from.
 *
 * The number is `tabular` so a value that changes does not change the width of its own column, and
 * the label sits above it at small caps — read as "entrants: 84", not as an unlabelled 84.
 */
export function StatCell({
  label,
  value,
  icon,
  tone = 'default',
  className,
}: {
  label: ReactNode
  value: ReactNode
  icon?: ReactNode
  /** `gold` for championship figures only. */
  tone?: 'default' | 'gold' | 'cyan'
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex items-center gap-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div
        className={cn(
          'tabular mt-1 text-xl font-bold leading-none',
          tone === 'default' && 'text-foreground',
          tone === 'gold' && 'text-[var(--gold)]',
          tone === 'cyan' && 'text-[var(--cyan)]',
        )}
      >
        {value}
      </div>
    </div>
  )
}

/** A row of StatCells with a divider between them. */
export function StatRail({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <dl className={cn('flex flex-wrap items-end gap-x-6 gap-y-3', className)}>{children}</dl>
  )
}

/* ─────────────────────────────────────────────────────────────────────── data table ───────────── */

/**
 * The table frame.
 *
 * Two things it guarantees, both of which were bugs before it existed:
 *
 *  1. Wide content scrolls INSIDE its own container. The document never scrolls sideways, which is
 *     what kept happening on mobile when a 12-column standings table was dropped straight into the
 *     page.
 *  2. The scroll container is focusable and labelled, so somebody navigating by keyboard can reach
 *     and scroll it. A bare `overflow-x: auto` div is unreachable without a pointer.
 */
export function DataTableFrame({
  label,
  className,
  children,
}: {
  /** Names the scrollable region for assistive technology. */
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn(
        'scrollbar-themed w-full overflow-x-auto',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Column headings: small, uppercase, muted, with a strong rule beneath the row. */
export function TableHead({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <thead
      className={cn(
        'border-b border-[var(--line-strong)] text-[0.62rem] uppercase tracking-[0.12em] text-muted-foreground',
        className,
      )}
    >
      {children}
    </thead>
  )
}

/* ────────────────────────────────────────────────────────────── movement indicator ────────────── */

/**
 * Rank movement.
 *
 * Never colour alone: each direction carries a glyph AND a screen-reader phrase, so the meaning
 * survives for a colour-blind reader and in a screenshot printed in grey.
 */
export function MovementIndicator({
  delta,
  className,
}: {
  /** Places gained. Positive is an improvement, negative a fall, 0 or null unchanged. */
  delta: number | null
  className?: string
}) {
  if (delta == null || delta === 0) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-muted-foreground', className)}>
        <span aria-hidden>—</span>
        <span className="sr-only">no change</span>
      </span>
    )
  }
  const up = delta > 0
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-semibold tabular',
        up ? 'text-[var(--success)]' : 'text-[var(--hot-red)]',
        className,
      )}
    >
      <span aria-hidden>{up ? '▲' : '▼'}</span>
      <span aria-hidden>{Math.abs(delta)}</span>
      <span className="sr-only">
        {up ? `up ${delta} places` : `down ${Math.abs(delta)} places`}
      </span>
    </span>
  )
}

/* ───────────────────────────────────────────────────────────────────── information rail ───────── */

/** The compact right-hand column: a stack of small panels. */
export function InfoRail({ className, children }: { className?: string; children: ReactNode }) {
  return <aside className={cn('flex flex-col gap-3', className)}>{children}</aside>
}

/* ─────────────────────────────────────────────────────────────── empty / loading / error ──────── */

/**
 * Nothing to show, and why.
 *
 * `tone` distinguishes an empty result from a failure, because "no players match this filter" and
 * "the ladder could not be read" need different responses from the reader and looked identical
 * before.
 */
export function CyberEmpty({
  title,
  body,
  action,
  tone = 'empty',
  className,
}: {
  title: ReactNode
  body?: ReactNode
  action?: ReactNode
  tone?: 'empty' | 'error'
  className?: string
}) {
  return (
    <div
      className={cn(
        'cyber-clip flex min-h-[12rem] flex-col items-center justify-center gap-2 border border-dashed px-6 py-12 text-center',
        tone === 'error' ? 'border-[var(--hot-red)]' : 'border-[var(--line-strong)]',
        className,
      )}
      role={tone === 'error' ? 'alert' : undefined}
    >
      <p
        className={cn(
          'font-display text-lg font-bold uppercase tracking-wide',
          tone === 'error' ? 'text-[var(--hot-red)]' : 'text-foreground',
        )}
      >
        {title}
      </p>
      {body && <p className="max-w-md text-sm text-muted-foreground">{body}</p>}
      {action}
    </div>
  )
}

/**
 * A loading placeholder with the same footprint as the content it stands in for.
 *
 * Sized by the caller rather than guessed, because the point of a skeleton is that nothing moves
 * when the real content lands.
 */
export function CyberSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('skeleton-scan cyber-clip-sm bg-[var(--graphite-raised)]', className)}
    />
  )
}
