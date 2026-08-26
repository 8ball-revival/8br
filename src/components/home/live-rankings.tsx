import Link from 'next/link'
import { Crown } from 'lucide-react'

import { identityLines } from '@/lib/identity/display'
import type { LeaderRow } from '@/lib/home/leaderboard'
import { cn } from '@/lib/utils'

/**
 * Live Rankings: the CueVerse ladder, top five.
 *
 * ── One ladder, not a mode picker ────────────────────────────────────────────────────────────────
 * This panel briefly carried the homepage's ranking-type selector, which meant it could be showing
 * championship counts across every competition while its own heading said CueVerse. A panel titled
 * "Live Rankings · CueVerse" should show the CueVerse rankings and nothing else, so the selector is
 * gone and the source is the platform ladder.
 *
 * ── The same rows as everything else ─────────────────────────────────────────────────────────────
 * It takes the array the Top 10 table below is rendering and shows the first five of it. The two
 * panels are on the same screen; deriving them separately would let them disagree in full view of
 * each other.
 *
 * ── No movement arrows ───────────────────────────────────────────────────────────────────────────
 * Nothing records a previous-period standing, so an up/down arrow would be a decoration presented as
 * a fact about a competitor. Form appears in the Top 10 table, where it is a measured streak and
 * labelled as one.
 */
export function LiveRankings({
  rows,
  platform,
}: {
  rows: LeaderRow[]
  platform: 'CUEVERSE' | 'YAHOO'
}) {
  const top = rows.slice(0, 5)
  const [leader, ...rest] = top

  return (
    <section
      aria-labelledby="live-rankings-heading"
      className="cyber-clip flex h-full flex-col border border-[var(--hot-red)] bg-[var(--graphite)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
        <h2 id="live-rankings-heading" className="flex items-baseline gap-2">
          <span className="font-display text-sm font-bold uppercase tracking-[0.14em] text-[var(--hot-red)]">
            Live Rankings
          </span>
          <span className="font-display text-sm font-bold tracking-tight text-[var(--cyan)]">
            {platform === 'CUEVERSE' ? 'CueVerse' : 'Yahoo Archive'}
          </span>
        </h2>
        <p className="text-[0.6rem] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Rating
        </p>
      </div>

      <div className="flex flex-1 flex-col p-4">
        {top.length === 0 ? (
          <p className="text-sm text-muted-foreground">No ranked players yet.</p>
        ) : (
          <>
            <p className="eyebrow mb-2 text-[var(--gold)]">Current champion</p>

            <LeaderCard row={leader} />

            <ol className="mt-2">
              {rest.map((row) => (
                <li key={row.playerId}>
                  <SmallRow row={row} />
                </li>
              ))}
            </ol>

            <Link
              href={`/rankings?platform=${platform}`}
              className="mt-auto inline-flex items-center gap-1 pt-4 text-[0.66rem] font-bold uppercase tracking-[0.12em] text-[var(--hot-red)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              View full rankings <span aria-hidden>›</span>
            </Link>
          </>
        )}
      </div>
    </section>
  )
}

function LeaderCard({ row }: { row: LeaderRow }) {
  const { primary, secondary } = identityLines(row)
  const inner = (
    <>
      <span className="flex shrink-0 flex-col items-center">
        <span className="tabular font-display text-3xl font-bold leading-none text-[var(--acid-ink)]">1</span>
        <Crown className="mt-0.5 size-3 text-[var(--acid-ink)]" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-xl font-bold uppercase leading-tight text-[var(--acid-ink)]">
          {primary}
        </span>
        {secondary && (
          <span className="block truncate text-sm font-semibold text-[var(--acid-ink)]/70">{secondary}</span>
        )}
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[var(--acid-ink)]/70">
          Rating
        </span>
        <span className="tabular block text-2xl font-bold leading-none text-[var(--acid-ink)]">
          {row.rating.toLocaleString()}
        </span>
      </span>
    </>
  )

  /* The one acid surface inside this dark panel, so it carries black ink like every other. */
  const className = 'cyber-clip-sm flex items-center gap-3 border-l-4 border-[var(--hot-red)] bg-[var(--acid)] px-3 py-3 text-[var(--acid-ink)]'

  return row.slug ? (
    <Link
      href={`/players/${encodeURIComponent(row.slug)}`}
      className={cn(className, 'transition-colors hover:bg-[var(--acid-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--void)]')}
      aria-label={`Rank 1, CueVerse ID ${primary}${secondary ? `, ${secondary}` : ''}, rating ${row.rating}`}
    >
      {inner}
    </Link>
  ) : (
    <div className={className}>{inner}</div>
  )
}

function SmallRow({ row }: { row: LeaderRow }) {
  const { primary, secondary } = identityLines(row)
  const inner = (
    <>
      <span className="tabular w-6 shrink-0 text-center text-sm font-bold text-muted-foreground">{row.rank}</span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{primary}</span>
      <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground sm:block">{secondary}</span>
      <span className="tabular shrink-0 text-sm font-bold text-foreground">{row.rating.toLocaleString()}</span>
    </>
  )
  const className = 'flex items-center gap-2 border-b border-[var(--line)] py-2 last:border-b-0'

  return row.slug ? (
    <Link
      href={`/players/${encodeURIComponent(row.slug)}`}
      className={cn(className, 'transition-colors hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]')}
      aria-label={`Rank ${row.rank}, CueVerse ID ${primary}${secondary ? `, ${secondary}` : ''}, rating ${row.rating}`}
    >
      {inner}
    </Link>
  ) : (
    <div className={className}>{inner}</div>
  )
}
