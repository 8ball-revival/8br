import Link from 'next/link'
import { Crown } from 'lucide-react'

import { identityLines } from '@/lib/identity/display'
import type { Top10Result } from '@/lib/home/top10'
import { cn } from '@/lib/utils'

/**
 * The Live Rankings Snapshot: the top five, in the right-hand rail.
 *
 * ── It is a view of the Top 10, not a second ranking ─────────────────────────────────────────────
 * The rows handed to this component are the same rows the Top 10 panel renders and the same rows the
 * Rankings page is built from. Nothing is recomputed, sliced differently, or filtered again — the
 * homepage showing one order while /rankings shows another would be the worst kind of bug, because
 * both pages would look completely correct on their own.
 *
 * ── No movement arrows ───────────────────────────────────────────────────────────────────────────
 * The design shows up/down arrows beside each row. There is no canonical previous-period standing to
 * compare against, so any arrow drawn here would be decoration presented as a fact about a
 * competitor. The column is therefore absent rather than filled with something plausible. When a
 * comparison period exists it can be added, and it will mean something.
 */
export function RankingsSnapshot({ result }: { result: Top10Result }) {
  const rows = result.rows.slice(0, 5)
  if (rows.length === 0) return null

  const [leader, ...rest] = rows

  return (
    <section
      aria-labelledby="snapshot-heading"
      className="cyber-clip border border-[var(--hot-red)] bg-[var(--graphite)]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--line)] px-3 py-2">
        <h2
          id="snapshot-heading"
          className="font-display text-[0.7rem] font-bold uppercase tracking-[0.14em] text-[var(--hot-red)]"
        >
          Live Rankings Snapshot
        </h2>
        <p className="text-[0.62rem] font-semibold uppercase tracking-wider text-muted-foreground">
          {result.metricLabel}
        </p>
      </div>

      <div className="p-3">
        <p className="eyebrow mb-2 text-[var(--gold)]">Current leader</p>

        {/* The leader gets its own block: bigger type and a gold edge, but still a row of the same list. */}
        <SnapshotRow row={leader} lead />

        <ol className="mt-1">
          {rest.map((row) => (
            <li key={`${row.rank}-${row.playerId ?? row.handle ?? row.name}`}>
              <SnapshotRow row={row} />
            </li>
          ))}
        </ol>

        <Link
          href={result.href}
          className="mt-3 inline-flex items-center gap-1 text-[0.68rem] font-bold uppercase tracking-wider text-[var(--cyan)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          View full rankings
          <span aria-hidden>›</span>
        </Link>
      </div>
    </section>
  )
}

function SnapshotRow({ row, lead = false }: { row: Top10Result['rows'][number]; lead?: boolean }) {
  const { primary, secondary } = identityLines({ cueverseId: row.handle, preferredName: row.name })
  const body = (
    <>
      <span
        className={cn(
          'cyber-clip-sm inline-flex shrink-0 items-center justify-center text-xs font-bold tabular',
          lead
            ? 'size-8 bg-[var(--gold)] text-[var(--void)]'
            : 'size-6 bg-[var(--graphite-raised)] text-muted-foreground',
        )}
        aria-hidden
      >
        {lead ? <Crown className="size-4" /> : row.rank}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate font-bold', lead ? 'text-base text-[var(--gold)]' : 'text-sm text-foreground')}>
          {primary}
        </span>
        {secondary && (
          <span className="block truncate text-[0.7rem] text-muted-foreground">{secondary}</span>
        )}
      </span>
      <span className={cn('tabular shrink-0 font-bold', lead ? 'text-base text-[var(--gold)]' : 'text-sm text-foreground')}>
        {row.value}
      </span>
    </>
  )

  const className = cn(
    'flex items-center gap-2.5 py-1.5',
    lead && 'border-l-2 border-[var(--gold)] bg-[var(--selected-surface)] px-2',
    !lead && 'border-b border-[var(--line)] last:border-b-0',
  )

  /* The whole row is the link when there is a profile to reach; otherwise it is plain text. */
  if (row.slug) {
    return (
      <Link
        href={`/players/${encodeURIComponent(row.slug)}`}
        className={cn(className, 'transition-colors hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]')}
        aria-label={`Rank ${row.rank}, CueVerse ID ${primary}${secondary ? `, ${secondary}` : ''}, ${row.value}`}
      >
        {body}
      </Link>
    )
  }
  return <div className={className}>{body}</div>
}
