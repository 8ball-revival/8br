'use client'

import Link from 'next/link'
import { Star, Target, Trophy, Flame, Snowflake } from 'lucide-react'

import type { ExplorerRow } from '@/lib/stats/ladder-explorer'
import { identityLines } from '@/lib/identity/display'
import { cn } from '@/lib/utils'

/**
 * The analytical rail beside the leaderboard.
 *
 * ── It cannot disagree with the table ────────────────────────────────────────────────────────────
 * Every panel here is computed from the SAME rows the table is rendering — the array is passed in,
 * not fetched again. That is the whole design: a "highest rating" card that ran its own query could
 * name a different player from the one sitting at rank 1 six inches to its left, and both would look
 * authoritative. Derivation from the rendered rows makes that impossible rather than unlikely.
 *
 * It also means the rail responds to the filters. Narrow the ladder to one competition and the rail
 * describes that competition, which is what a reader who just applied a filter expects.
 *
 * ── "Recent Movers" shows streaks, and says so ───────────────────────────────────────────────────
 * The design implies rank movement. There is no canonical previous-period standing to compare
 * against, so a movement arrow here would be invented. What the data does hold is `currentStreak` —
 * a signed count of an active, unbroken run — which is genuinely recent and genuinely measured. The
 * panel therefore shows form and is labelled as form, rather than showing form dressed as movement.
 */
export function RankingsRail({ rows, className }: { rows: ExplorerRow[]; className?: string }) {
  if (rows.length === 0) return null

  const best = <K extends keyof ExplorerRow>(key: K) =>
    rows.reduce((a, b) => ((b[key] as number) > (a[key] as number) ? b : a))

  const topRated = best('rating')
  const mostWins = best('wins')
  const titlesOf = (r: ExplorerRow) => r.seasonTitles + r.tournamentTitles
  const mostTitles = rows.reduce((a, b) => (titlesOf(b) > titlesOf(a) ? b : a))

  /* Longest active runs, in both directions. A run of one or two is not a run. */
  const hot = rows.filter((r) => r.currentStreak >= 3).sort((a, b) => b.currentStreak - a.currentStreak).slice(0, 3)
  const cold = rows.filter((r) => r.currentStreak <= -3).sort((a, b) => a.currentStreak - b.currentStreak).slice(0, 2)

  const highestPeak = best('peakRating')
  const longestStreak = best('longestStreak')
  const mostSeasons = best('seasonsPlayed')

  return (
    <aside className={cn('flex flex-col gap-3', className)} aria-label="Ranking analysis">
      <RailPanel title="Ranking leaders">
        <LeaderRow icon={<Star className="size-3.5" aria-hidden />} label="Highest rating" row={topRated} value={topRated.rating.toLocaleString()} tone="gold" />
        <LeaderRow icon={<Target className="size-3.5" aria-hidden />} label="Most wins" row={mostWins} value={mostWins.wins.toLocaleString()} tone="cyan" />
        {titlesOf(mostTitles) > 0 && (
          <LeaderRow icon={<Trophy className="size-3.5" aria-hidden />} label="Most championships" row={mostTitles} value={String(titlesOf(mostTitles))} tone="gold" />
        )}
      </RailPanel>

      {(hot.length > 0 || cold.length > 0) && (
        <RailPanel title="Recent movers" note="Active streaks">
          {hot.map((r) => (
            <StreakRow key={r.playerId} row={r} />
          ))}
          {cold.map((r) => (
            <StreakRow key={r.playerId} row={r} />
          ))}
        </RailPanel>
      )}

      <RailPanel title="Milestones">
        <LeaderRow label="Highest ever rating" row={highestPeak} value={highestPeak.peakRating.toLocaleString()} tone="gold" />
        <LeaderRow label="Longest win streak" row={longestStreak} value={String(longestStreak.longestStreak)} tone="cyan" />
        <LeaderRow label="Most seasons played" row={mostSeasons} value={String(mostSeasons.seasonsPlayed)} tone="cyan" />
      </RailPanel>
    </aside>
  )
}

function RailPanel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="dl-surface cyber-clip border border-[var(--hot-red)] bg-[var(--graphite)]">
      <div className="flex items-baseline justify-between gap-2 border-b border-[var(--line)] px-3 py-2">
        <h2 className="font-display text-[0.68rem] font-bold uppercase tracking-[0.14em] text-[var(--hot-red)]">
          {title}
        </h2>
        {note && (
          <p className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">{note}</p>
        )}
      </div>
      <div className="divide-y divide-[var(--line)]">{children}</div>
    </section>
  )
}

function Identity({ row }: { row: ExplorerRow }) {
  const { primary, secondary } = identityLines(row)
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-semibold text-foreground">{primary}</span>
      {secondary && <span className="block truncate text-[0.68rem] text-muted-foreground">{secondary}</span>}
    </span>
  )
}

function LeaderRow({
  icon, label, row, value, tone,
}: {
  icon?: React.ReactNode
  label: string
  row: ExplorerRow
  value: string
  tone: 'gold' | 'cyan'
}) {
  return (
    <Link
      href={`/players/${encodeURIComponent(row.slug)}`}
      className="flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      <span
        className={cn(
          'cyber-clip-sm flex size-7 shrink-0 items-center justify-center',
          tone === 'gold' ? 'bg-[var(--selected-surface)] text-[var(--gold)]' : 'bg-[var(--selected-surface)] text-[var(--cyan)]',
        )}
        aria-hidden
      >
        {icon ?? <span className="text-[0.6rem] font-bold">#</span>}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.6rem] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </span>
        <Identity row={row} />
      </span>
      <span className={cn('tabular shrink-0 text-sm font-bold', tone === 'gold' ? 'text-[var(--gold)]' : 'text-foreground')}>
        {value}
      </span>
    </Link>
  )
}

/**
 * One streak.
 *
 * The direction is carried by the letter (W/L) as well as the colour and the icon, so a reader who
 * cannot separate green from red still knows which way the run is going.
 */
function StreakRow({ row }: { row: ExplorerRow }) {
  const up = row.currentStreak > 0
  const n = Math.abs(row.currentStreak)
  return (
    <Link
      href={`/players/${encodeURIComponent(row.slug)}`}
      className="flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      <span
        className={cn('shrink-0', up ? 'text-[var(--streak-hot)]' : 'text-[var(--streak-cold)]')}
        aria-hidden
      >
        {up ? <Flame className="size-4" /> : <Snowflake className="size-4" />}
      </span>
      <Identity row={row} />
      <span
        className={cn(
          'tabular shrink-0 text-sm font-bold',
          up ? 'text-[var(--streak-hot)]' : 'text-[var(--streak-cold)]',
        )}
      >
        {up ? 'W' : 'L'}{n}
        <span className="sr-only">{up ? ` winning run of ${n}` : ` losing run of ${n}`}</span>
      </span>
    </Link>
  )
}
