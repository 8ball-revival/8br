import Link from 'next/link'
import { Gem, Trophy } from 'lucide-react'

import type { CompetitionCard as Card } from '@/lib/competition/surface'
import { COMPLETENESS_LABEL, COMPLETENESS_NOTE } from '@/lib/competition/lifecycle-rules'
import { cn } from '@/lib/utils'

/**
 * One competition, on a listing page.
 *
 * The same card serves Live and Archives. What differs between them is what is KNOWN, not what is
 * shown: a live competition has no champion yet, so that line is simply absent rather than filled
 * with a placeholder. Nothing here invents a value it was not given.
 */
export function CompetitionCardView({ card, live = false }: { card: Card; live?: boolean }) {
  const Icon = card.kind === 'season' ? Gem : Trophy
  return (
    <Link
      href={card.href}
      className={cn(
        'group flex flex-col gap-2 rounded-lg border border-border bg-card p-4 transition-colors',
        'hover:border-[var(--gold)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-base font-bold group-hover:text-[var(--gold)]">
            {card.title}
          </h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {card.competition}
            {card.year != null && <> · {card.year}</>}
            {card.division && <> · Division {card.division}</>}
            {card.number != null && <> · Season {card.number}</>}
          </p>
        </div>
        {live ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--gold)]/40 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--gold)]">
            <span className="relative flex size-1.5" aria-hidden>
              <span className="absolute inline-flex size-full rounded-full bg-[var(--gold)] opacity-60 motion-safe:animate-ping" />
              <span className="relative inline-flex size-1.5 rounded-full bg-[var(--gold)]" />
            </span>
            Live
          </span>
        ) : (
          <Icon className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
        )}
      </div>

      {card.format && <p className="text-xs text-muted-foreground">{card.format}</p>}

      <dl className="mt-auto grid grid-cols-2 gap-x-4 gap-y-1 pt-1 text-xs">
        {card.champion && (
          <>
            <dt className="text-muted-foreground">Champion</dt>
            <dd className="truncate text-right font-medium text-[var(--gold)]">{card.champion}</dd>
          </>
        )}
        {card.runnerUp && (
          <>
            <dt className="text-muted-foreground">Runner-up</dt>
            <dd className="truncate text-right">{card.runnerUp}</dd>
          </>
        )}
        {card.finalScore && (
          <>
            <dt className="text-muted-foreground">Final</dt>
            <dd className="text-right tabular-nums">{card.finalScore}</dd>
          </>
        )}
        {card.participants > 0 && (
          <>
            <dt className="text-muted-foreground">Entrants</dt>
            <dd className="text-right tabular-nums">{card.participants}</dd>
          </>
        )}
      </dl>

      {card.completeness === 'partial' && (
        // Shown on the card rather than buried on the detail page: a reader comparing archived
        // seasons needs to know which of them are missing pieces before they compare the figures.
        <p
          title={COMPLETENESS_NOTE.partial}
          className="mt-1 inline-flex w-fit items-center rounded-full border border-border px-2 py-0.5 text-[0.65rem] text-muted-foreground"
        >
          {COMPLETENESS_LABEL.partial}
        </p>
      )}
    </Link>
  )
}
