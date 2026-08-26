import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * The command deck — one identity for Groups, Playoffs and Rankings.
 *
 * ── Why these three share a component ────────────────────────────────────────────────────────────
 * They are the three places somebody comes to READ a competition, and they had drifted into three
 * different shapes: Rankings led with a title and a row of chips, the group stage led with a
 * masthead, the bracket led with nothing at all. Same job, three layouts, so moving between them
 * felt like moving between three sites.
 *
 * The deck fixes the order of everything: a lit rail down the left edge, the surface's own name in
 * the eyebrow, the title, its live figures beside it, and — always, on every one of the three — the
 * actions in a dock on the right. Nothing else is allowed in the action position, which is what
 * makes it findable without being read.
 *
 * ── Why the actions are a dock rather than loose buttons ─────────────────────────────────────────
 * A dock is a single chamfered group with hairline dividers between its items, so a surface with one
 * action and a surface with four still read as the same control. The primary action is last, because
 * the eye lands on the right end of a row, and it is the only lit one — a dock where everything
 * glows tells you nothing about what to press.
 */
export function CommandDeck({
  eyebrow,
  title,
  meta,
  stats,
  actions,
  className,
  children,
}: {
  /** What kind of surface this is: GROUP STAGE, PLAYOFF BRACKET, RANKINGS. */
  eyebrow: string
  title: ReactNode
  /** A line under the title — the competition, the season, the date range. */
  meta?: ReactNode
  /** Live figures, shown as a lit readout to the right of the title. */
  stats?: { label: string; value: ReactNode }[]
  /** The action dock. Primary action LAST — see above. */
  actions?: ReactNode
  className?: string
  /** Anything the surface needs directly beneath the deck: filters, tabs, a legend. */
  children?: ReactNode
}) {
  return (
    <section
      className={cn(
        'relative mb-4 border-b border-[var(--neon-line)] pb-3 pl-4',
        // The rail. A gradient rather than a border so it fades out at the bottom instead of
        // stopping dead against the divider.
        'before:absolute before:inset-y-0 before:left-0 before:w-[2px]',
        'before:bg-[linear-gradient(to_bottom,var(--neon-cyan),transparent)]',
        className,
      )}
    >
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="eyebrow neon-text-cyan">{eyebrow}</p>
          <h1 className="mt-1 font-display text-2xl font-bold uppercase tracking-tight sm:text-3xl">
            {title}
          </h1>
          {meta && <div className="mt-1 text-sm text-muted-foreground">{meta}</div>}
        </div>

        {stats && stats.length > 0 && (
          /*
           * The readout. Figures are the point of all three surfaces, so they sit at the top rather
           * than being buried in the table, and they use the mono face so a changing number does not
           * change the width of its own label.
           */
          <dl className="flex flex-wrap items-end gap-x-5 gap-y-2">
            {stats.map((s) => (
              <div key={s.label} className="min-w-0">
                <dt className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  {s.label}
                </dt>
                <dd className="tabular mt-0.5 text-lg font-bold leading-none text-[var(--neon-yellow)] [text-shadow:var(--glow-yellow)]">
                  {s.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {actions && (
          <div className="cyber-clip-sm flex items-stretch divide-x divide-[var(--neon-line)] border border-[var(--neon-line)] [&>*]:px-3 [&>*]:py-2">
            {actions}
          </div>
        )}
      </div>

      {children && <div className="mt-3">{children}</div>}
    </section>
  )
}

/**
 * One item in the dock.
 *
 * `primary` is the lit one, and a dock should have at most one — it is the answer to "what did I
 * come here to do". Everything else is quiet until hovered.
 */
export function DeckAction({
  children,
  primary,
  className,
  ...rest
}: React.ComponentProps<'button'> & { primary?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider transition-all duration-150',
        primary
          ? 'text-[var(--neon-yellow)] [text-shadow:var(--glow-yellow)] hover:brightness-125'
          : 'text-muted-foreground hover:text-[var(--neon-cyan)] hover:[text-shadow:var(--glow-cyan)]',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
