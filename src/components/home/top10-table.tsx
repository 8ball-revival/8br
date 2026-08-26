import Link from 'next/link'

import type { LeaderRow } from '@/lib/home/leaderboard'
import { identityLines } from '@/lib/identity/display'
import { DataTableFrame } from '@/components/cyber/primitives'
import { PanelLink } from './competition-history'
import { cn } from '@/lib/utils'

/**
 * Rankings Top 10: a dense leaderboard, not a stack of cards.
 *
 * ── Why a table ──────────────────────────────────────────────────────────────────────────────────
 * Six figures per player across ten players is tabular data, and a table is the only presentation
 * where a reader can compare a column down the page. The card version this replaces made each row a
 * self-contained object, which is exactly the wrong shape: nobody wants ten profiles, they want a
 * ranking.
 *
 * ── The Form column is a measured streak, not rank movement ──────────────────────────────────────
 * The design shows a Trend column of arrows. Nothing in the data records where a player stood last
 * month, so a movement arrow would be invented. `streak` is real — a signed run of consecutive
 * results — so the column shows that, is headed Form, and spells out the direction for a screen
 * reader. Colour is never the only carrier: the letter W or L is there too.
 */
export function Top10Table({ rows, platform }: { rows: LeaderRow[]; platform: 'CUEVERSE' | 'YAHOO' }) {
  return (
    <section
      aria-labelledby="top10-heading"
      className="cyber-clip flex h-full flex-col border border-[var(--line-strong)] bg-[var(--graphite)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
        <h2 id="top10-heading" className="flex items-baseline gap-2">
          <span className="font-display text-sm font-bold uppercase tracking-[0.14em] text-[var(--hot-red)]">
            Rankings Top 10
          </span>
          {/* Which ladder this is. Stated rather than assumed, because the homepage falls back. */}
          <span className="text-[0.6rem] font-bold uppercase tracking-wider text-muted-foreground">
            {platform === 'CUEVERSE' ? 'CueVerse' : 'Yahoo Archive'}
          </span>
        </h2>
        <PanelLink href={`/rankings?platform=${platform}`}>View full rankings</PanelLink>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">No ranked players yet.</p>
      ) : (
        /*
         * Scrolls in its own frame, at the same height as Season Results beside it.
         *
         * Ten rows is taller than five, so before this the two panels in the row ended at different
         * heights and the grid had a ragged bottom edge. Capping both at the same height and letting
         * each scroll means the row is level regardless of how much either one holds.
         */
        <DataTableFrame label="Top ten ranked players" className="max-h-[22rem] flex-1 overflow-auto">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-[var(--graphite)] text-[0.6rem] uppercase tracking-[0.12em] text-muted-foreground">
              <tr className="border-b border-[var(--line-strong)]">
                <th scope="col" className="bg-[var(--graphite)] px-3 py-2 text-left font-bold">#</th>
                <th scope="col" className="bg-[var(--graphite)] px-2 py-2 text-left font-bold">Player</th>
                <th scope="col" className="bg-[var(--graphite)] px-2 py-2 text-right font-bold">Wins</th>
                <th scope="col" className="bg-[var(--graphite)] px-2 py-2 text-right font-bold">Losses</th>
                <th scope="col" className="bg-[var(--graphite)] px-2 py-2 text-right font-bold">Win %</th>
                <th scope="col" className="bg-[var(--graphite)] px-2 py-2 text-right font-bold">Rating</th>
                <th scope="col" className="bg-[var(--graphite)] px-3 py-2 text-right font-bold">Form</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const { primary, secondary } = identityLines(r)
                const lead = r.rank === 1
                return (
                  <tr
                    key={r.playerId}
                    className={cn(
                      'border-b border-[var(--line)] transition-colors last:border-b-0 hover:bg-[var(--accent)]',
                      lead && 'bg-[var(--selected-surface)]',
                    )}
                  >
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          'cyber-clip-sm inline-flex size-6 items-center justify-center text-[0.7rem] font-bold tabular',
                          lead ? 'bg-[var(--acid)] text-[var(--acid-ink)]' : 'text-muted-foreground',
                        )}
                      >
                        {r.rank}
                      </span>
                    </td>
                    <th scope="row" className="min-w-0 px-2 py-2 text-left font-normal">
                      {r.slug ? (
                        <Link
                          href={`/players/${encodeURIComponent(r.slug)}`}
                          className="block min-w-0 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                          aria-label={`CueVerse ID ${primary}${secondary ? `, ${secondary}` : ''}`}
                        >
                          <span className={cn('block truncate font-semibold', lead ? 'text-[var(--acid)]' : 'text-foreground')}>
                            {primary}
                          </span>
                          {secondary && <span className="block truncate text-[0.7rem] text-muted-foreground">{secondary}</span>}
                        </Link>
                      ) : (
                        <>
                          <span className="block truncate font-semibold text-foreground">{primary}</span>
                          {secondary && <span className="block truncate text-[0.7rem] text-muted-foreground">{secondary}</span>}
                        </>
                      )}
                    </th>
                    <td className="tabular px-2 py-2 text-right text-foreground">{r.wins.toLocaleString()}</td>
                    <td className="tabular px-2 py-2 text-right text-muted-foreground">{r.losses.toLocaleString()}</td>
                    <td className="tabular px-2 py-2 text-right text-foreground">{r.winPct.toFixed(1)}%</td>
                    <td className={cn('tabular px-2 py-2 text-right font-bold', lead ? 'text-[var(--acid)]' : 'text-foreground')}>
                      {r.rating.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Form streak={r.streak} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </DataTableFrame>
      )}
    </section>
  )
}

/**
 * A run of results.
 *
 * Under three either way is not a run and shows a dash, so the column marks genuine form rather than
 * turning every player's last result into a signal.
 */
function Form({ streak }: { streak: number }) {
  if (Math.abs(streak) < 3) {
    return (
      <span className="text-muted-foreground">
        <span aria-hidden>—</span>
        <span className="sr-only">no current run</span>
      </span>
    )
  }
  const up = streak > 0
  const n = Math.abs(streak)
  return (
    <span className={cn('tabular text-xs font-bold', up ? 'text-[var(--success)]' : 'text-[var(--hot-red)]')}>
      <span aria-hidden>{up ? '▲' : '▼'} {up ? 'W' : 'L'}{n}</span>
      <span className="sr-only">{up ? `winning run of ${n}` : `losing run of ${n}`}</span>
    </span>
  )
}
