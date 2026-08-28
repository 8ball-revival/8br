import Link from 'next/link'

import type { SeasonResultRow } from '@/lib/home/season-results'
import { identityLines } from '@/lib/identity/display'
import { PanelLink } from './competition-history'

/**
 * Season Results: every completed Season, oldest first.
 *
 * ── The whole archive, in a fixed frame ──────────────────────────────────────────────────────────
 * This lists all forty-eight completed Seasons rather than the five most recent, and scrolls inside
 * a frame the same height as the Top 10 beside it. That combination is the point: the panel keeps
 * the row's height without truncating the archive, so the homepage stays a dashboard while still
 * offering the whole record.
 *
 * Ordered oldest to newest, which is how an archive reads — you start at the beginning.
 *
 * ── The row is the link ──────────────────────────────────────────────────────────────────────────
 * Every cell is inside one anchor per row, so the target is the full width of the row rather than a
 * word in the last column. `display: contents` on the anchor lets it wrap the cells without breaking
 * the table's own layout, which is what makes the columns still line up.
 *
 * ── A forfeited final shows no score ─────────────────────────────────────────────────────────────
 * The service suppresses the stored value for a forfeited final and sets a flag instead. Printing
 * "9-0" for a match nobody played would be inventing the most consequential result in a Season.
 */
export function SeasonResults({ rows }: { rows: SeasonResultRow[] }) {
  return (
    <section
      aria-labelledby="season-results-heading"
      /*
        `min-w-0` for the same reason as Rankings Top 10 beside it: the table inside carries
        `min-w-[34rem]`, and a grid item's default `min-width: auto` lets that minimum escape the
        scroll frame and set the panel's floor, which made the whole page scroll sideways on a
        phone. The table still scrolls in its own frame; the page no longer scrolls with it.
      */
      className="dl-surface cyber-clip flex h-full min-w-0 flex-col border border-[var(--line-strong)] bg-[var(--graphite)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
        <h2 id="season-results-heading" className="flex items-center gap-2">
          <span className="font-display text-sm font-bold uppercase tracking-[0.14em] text-[var(--hot-red)]">
            Season Results
          </span>
          <span aria-hidden className="text-[var(--hot-red)]/50">{'//'}</span>
        </h2>
        <PanelLink href="/seasons">View all results</PanelLink>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          No Season has been completed yet. Champions appear here as they are decided.
        </p>
      ) : (
        /*
         * Scrolls in BOTH directions inside its own frame.
         *
         * Vertically because it holds the whole archive; horizontally because the five columns are
         * wider than a phone. The container is focusable and labelled, so somebody without a pointer
         * can reach and scroll it — a bare overflow container is unreachable by keyboard.
         *
         * The max height is what matches this panel to the Top 10 beside it.
         */
        <div
          role="region"
          aria-label="Season championship results, scrollable"
          tabIndex={0}
          /* `relative` for the same reason as DataTableFrame: it contains the `sr-only` labels inside, which
             otherwise resolve against the page and drag its scroll area past the right edge. */
          className="scrollbar-themed relative max-h-[22rem] w-full overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          <table className="w-full min-w-[34rem] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-[var(--graphite)] text-[0.6rem] uppercase tracking-[0.12em] text-muted-foreground">
              <tr className="border-b border-[var(--line-strong)]">
                <th scope="col" className="bg-[var(--graphite)] px-4 py-2 text-left font-bold">Season</th>
                <th scope="col" className="bg-[var(--graphite)] px-2 py-2 text-left font-bold">Winner</th>
                <th scope="col" className="bg-[var(--graphite)] px-2 py-2 text-left font-bold">Runner up</th>
                <th scope="col" className="bg-[var(--graphite)] px-2 py-2 text-right font-bold">Score</th>
                <th scope="col" className="bg-[var(--graphite)] px-4 py-2 text-left font-bold">Event</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.seasonId}
                  className="border-b border-[var(--line)] transition-colors last:border-b-0 hover:bg-[var(--accent)] focus-within:bg-[var(--accent)]"
                >
                  <th scope="row" className="whitespace-nowrap px-4 py-2.5 text-left font-semibold text-foreground">
                    <Link
                      href={r.href}
                      className="outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                      aria-label={`${r.label}, ${r.event}. Open this Season.`}
                    >
                      <span aria-hidden className="mr-2 inline-block size-1.5 rounded-full bg-[var(--hot-red)] align-middle" />
                      {r.label}
                    </Link>
                  </th>
                  <td className="px-2 py-2.5">
                    <Identity handle={r.winnerHandle} name={r.winnerName} tone="gold" />
                  </td>
                  <td className="px-2 py-2.5">
                    <Identity handle={r.runnerUpHandle} name={r.runnerUpName} tone="muted" />
                  </td>
                  <td className="tabular whitespace-nowrap px-2 py-2.5 text-right font-bold text-foreground">
                    {r.finalsForfeit ? (
                      <span className="text-[var(--hot-red)]" title="Won by forfeit — no score was played">
                        FF
                      </span>
                    ) : (
                      r.finalScore ?? <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <Link
                      href={r.href}
                      className="text-[var(--cyan)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    >
                      {r.event}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/** The handle leads, the preferred name follows — the site-wide rule, in a tight cell. */
function Identity({ handle, name, tone }: { handle: string | null; name: string | null; tone: 'gold' | 'muted' }) {
  const { primary, secondary } = identityLines({ cueverseId: handle, preferredName: name })
  return (
    <span className="block min-w-0">
      <span
        className={
          tone === 'gold'
            ? 'block truncate font-semibold text-[var(--gold)]'
            : 'block truncate font-medium text-foreground'
        }
      >
        {primary}
      </span>
      {secondary && <span className="block truncate text-[0.7rem] text-muted-foreground">{secondary}</span>}
    </span>
  )
}
