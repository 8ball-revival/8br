import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { Cup, BracketMatch, BracketSlot } from '@/lib/cups/fixtures'

type PendingMatch = BracketMatch & { round: string }

function name(s?: BracketSlot) {
  return s?.name ?? 'TBD'
}

// Matches still to be played: no winner yet and both competitors are known.
function pendingMatches(cup: Cup): PendingMatch[] {
  return (cup.bracket ?? [])
    .flatMap((r) => r.matches.map((m) => ({ ...m, round: r.name })))
    .filter((m) => {
      if (m.winner) return false
      const aReal = Boolean(m.a?.name) && m.a?.name !== 'Bye'
      const bReal = Boolean(m.b?.name) && m.b?.name !== 'Bye'
      // show if at least one competitor is set; skip both-TBD (e.g. the Final)
      return aReal || bReal
    })
}

function MatchRow({ m }: { m: PendingMatch }) {
  return (
    <li className="rounded-md border border-border bg-background/40 px-3 py-2">
      <p className="eyebrow mb-1 text-[0.55rem] text-muted-foreground">{m.round}</p>
      <div className="flex items-center gap-2">
        <span className={cn('min-w-0 flex-1 truncate text-sm', m.a?.name ? 'text-foreground' : 'text-muted-foreground')}>
          {name(m.a)}
        </span>
        <span className="shrink-0 text-[0.65rem] uppercase tracking-wide text-muted-foreground">vs</span>
        <span className={cn('min-w-0 flex-1 truncate text-right text-sm', m.b?.name ? 'text-foreground' : 'text-muted-foreground')}>
          {name(m.b)}
        </span>
      </div>
    </li>
  )
}

/**
 * Wide homepage box summarizing the current cup. Whole card links to the bracket.
 * Lists every pending (ready-to-play) match; the list scrolls so the box never
 * grows taller than the Top 10 list beside it.
 */
export function CurrentCupBox({ cup }: { cup: Cup }) {
  const pending = pendingMatches(cup)

  return (
    <Link href={`/cups/${cup.number}`} className="group block sm:col-span-2 lg:col-span-1">
      <div className="flex h-full flex-col rounded-lg border border-gold/25 bg-card transition-colors group-hover:border-gold/55">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="eyebrow text-gold">Current Cup</span>
            {cup.status === 'live' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider text-destructive">
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex size-1.5 animate-ping rounded-full bg-destructive/70" aria-hidden />
                  <span className="relative inline-flex size-1.5 rounded-full bg-destructive" aria-hidden />
                </span>
                Live
              </span>
            )}
          </div>
          <span className="inline-flex items-center gap-0.5 text-[0.7rem] font-medium uppercase tracking-wide text-gold transition-colors group-hover:text-gold-soft">
            View bracket <ArrowRight className="size-3" aria-hidden />
          </span>
        </div>

        <div className="flex flex-1 flex-col gap-4 p-5">
          <div>
            <h3 className="font-display text-2xl font-bold tracking-tight transition-colors group-hover:text-gold">
              {cup.name}
            </h3>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="gold">{cup.format}</Badge>
              {cup.entrants && <span className="tabular">{cup.entrants} entrants</span>}
              {cup.currentRound && (
                <>
                  <span aria-hidden>·</span>
                  <span>{cup.currentRound}</span>
                </>
              )}
            </div>
          </div>

          <div>
            <p className="eyebrow mb-2 text-muted-foreground">
              Pending Matches{pending.length > 0 && ` · ${pending.length}`}
            </p>
            {pending.length > 0 ? (
              <ul className="scrollbar-gold max-h-[18rem] space-y-2 overflow-y-auto pr-1">
                {pending.map((m, i) => (
                  <MatchRow key={i} m={m} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No matches awaiting play.</p>
            )}
          </div>

          <p className={cn('text-xs text-muted-foreground')}>
            Tap to view the full {cup.entrants ? `${cup.entrants}-player ` : ''}bracket.
          </p>
        </div>
      </div>
    </Link>
  )
}
