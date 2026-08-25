import Link from 'next/link'
import { Plus, FolderOpen, PencilLine, type LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * The six ways into Creator: create, manage what is running, correct what is finished — for each of
 * the two record types.
 *
 * ── Two columns, because there are two kinds of record ───────────────────────────────────────────
 * The reader arrives knowing whether they want a Season or a Tournament. Sorting by that first, and
 * by what they intend to do second, is one decision then another; a single list of six mixed actions
 * is one decision with six branches.
 *
 * ── Restrained on purpose ────────────────────────────────────────────────────────────────────────
 * Gold marks the primary action in each column and nothing else. A panel where every control shouts
 * has no emphasis left for the one that matters, and Create is the only irreversible thing here.
 */

export interface ActionCard {
  href: string
  label: string
  hint: string
  icon: LucideIcon
  /** Shown as a count chip when the number is meaningful. */
  count?: number
  primary?: boolean
}

export function CreatorColumn({
  heading,
  blurb,
  actions,
}: {
  heading: string
  blurb: string
  actions: ActionCard[]
}) {
  return (
    <section className="min-w-0">
      <h2 className="font-display text-lg font-bold text-foreground">{heading}</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{blurb}</p>
      <ul className="mt-3 space-y-2">
        {actions.map((a) => (
          <li key={a.href}>
            <Link
              href={a.href}
              className={cn(
                'group flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60',
                a.primary
                  ? 'border-[var(--gold)]/50 bg-[var(--selected-surface)] hover:border-[var(--gold)] hover:bg-[var(--selected-surface)]'
                  : 'border-border bg-card/40 hover:border-[var(--gold)]/40 hover:bg-card',
              )}
            >
              <a.icon
                aria-hidden
                className={cn('size-4 shrink-0', a.primary ? 'text-[var(--gold)]' : 'text-muted-foreground group-hover:text-[var(--gold)]')}
              />
              <span className="min-w-0 flex-1">
                <span className={cn('block truncate text-sm', a.primary ? 'font-semibold text-[var(--gold)]' : 'font-medium text-foreground')}>
                  {a.label}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{a.hint}</span>
              </span>
              {a.count != null && (
                <span className="tabular shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                  {a.count}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

export const CARD_ICONS = { create: Plus, manage: FolderOpen, modify: PencilLine }
