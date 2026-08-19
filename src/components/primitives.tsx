import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * THE site frame: the maximum width and responsive gutters every full-width surface shares.
 *
 * One definition, used by the header, the footer and every page that has to line up with them. It
 * is a component rather than a copied class string because "the same width" only holds if there is
 * one place to change — the Rankings table used to carry its own `max-w-[110rem]`, which rendered
 * 96px wider on each side than the navigation above it at 1728px.
 *
 * `data-site-container` is the hook the geometry check reads, so alignment is proved by measuring
 * two rendered rectangles rather than by trusting that two class strings match.
 */
export function Wide({
  className, name, ...props
}: React.ComponentProps<'div'> & {
  /** Identifies this frame in the rendered geometry, e.g. "header", "rankings". */
  name?: string
}) {
  return (
    <div
      data-site-container={name}
      className={cn(SITE_FRAME, className)}
      {...props}
    />
  )
}

/** The frame's classes, for the handful of places that need them on an existing element. */
export const SITE_FRAME = 'mx-auto w-full max-w-[96rem] px-4 sm:px-6 lg:px-8'

/**
 * Reusable dashboard panel: header row (title + optional live dot + "view all"
 * action) over a bordered card body. Every homepage panel is built from this.
 */
export function Panel({
  title,
  actionLabel,
  actionHref,
  live = false,
  bodyClassName,
  className,
  children,
}: {
  title: string
  actionLabel?: string
  actionHref?: string
  live?: boolean
  bodyClassName?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn('flex flex-col rounded-lg border border-border bg-card', className)}>
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="eyebrow text-foreground">{title}</h2>
          {live && (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider text-destructive">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-1.5 animate-ping rounded-full bg-destructive/70" aria-hidden />
                <span className="relative inline-flex size-1.5 rounded-full bg-destructive" aria-hidden />
              </span>
              Live
            </span>
          )}
        </div>
        {actionHref && actionLabel && (
          <Link
            href={actionHref}
            className="inline-flex items-center gap-0.5 text-[0.7rem] font-medium uppercase tracking-wide text-brand transition-colors hover:text-brand-soft"
          >
            {actionLabel}
            <ArrowRight className="size-3" aria-hidden />
          </Link>
        )}
      </header>
      <div className={cn('flex-1 p-4', bodyClassName)}>{children}</div>
    </section>
  )
}

const FLAG_LABELS: Record<string, string> = {
  US: 'United States',
  CA: 'Canada',
  GB: 'United Kingdom',
  FI: 'Finland',
  DE: 'Germany',
}

/**
 * Placeholder country flag — a compact code chip (real flag assets drop in later).
 */
export function Flag({ code, className }: { code: string; className?: string }) {
  return (
    <span
      title={FLAG_LABELS[code] ?? code}
      className={cn(
        'inline-flex h-3.5 w-5 items-center justify-center rounded-[2px] border border-border bg-gradient-to-b from-muted to-secondary text-[0.55rem] font-bold leading-none text-muted-foreground',
        className,
      )}
      aria-label={FLAG_LABELS[code] ?? code}
    >
      {code}
    </span>
  )
}

const AVATAR_GRADIENTS = [
  'from-brand-soft/30 to-brand-dim/30',
  'from-brand/25 to-secondary',
  'from-secondary to-brand-dim/30',
  'from-muted to-brand/20',
  'from-brand-dim/30 to-secondary',
  'from-secondary to-muted',
]

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// Deterministic gradient per name (no randomness → stable SSR).
function gradientFor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length]
}

/**
 * Placeholder player avatar — initials on a deterministic gradient ring (real
 * player photos drop in later).
 */
export function PlayerAvatar({
  name,
  size = 'md',
  className,
}: {
  name: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}) {
  const sizes = {
    sm: 'size-7 text-[0.6rem]',
    md: 'size-9 text-xs',
    lg: 'size-14 text-base',
    xl: 'size-20 text-xl',
  }
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-bold text-foreground ring-1 ring-border ring-inset',
        gradientFor(name),
        sizes[size],
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}
