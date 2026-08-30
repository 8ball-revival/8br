import type { YahooSummary as Summary } from '@/lib/yahoo/archive'

/**
 * The archive in six figures, all counted rather than estimated.
 *
 * ── "Unique champions", not "26 of 48" ───────────────────────────────────────────────────────────
 * The champions cell used to read "26 of 48", which looks like a completeness figure — as though
 * twenty-two seasons had no recorded winner. Every one of the forty-eight does. Twenty-six is the
 * number of DIFFERENT people who hold them, which is a fact about how hard the era was to win, not
 * about how much of it survived. Seasons already has its own cell, so the "of 48" was doing nothing
 * except inviting the wrong reading.
 */
export function YahooSummary({ summary }: { summary: Summary }) {
  const years = summary.firstYear != null && summary.lastYear != null
    ? `${summary.firstYear}–${summary.lastYear}`
    : 'Unknown'

  const cells: { label: string; value: string; hint?: string }[] = [
    { label: 'Seasons', value: String(summary.seasons) },
    { label: 'Players', value: String(summary.players) },
    { label: 'Matches', value: summary.matches.toLocaleString() },
    { label: 'Years', value: years },
    {
      label: 'Unique champions',
      value: String(summary.distinctChampions),
      hint: `${summary.distinctChampions} different people won the ${summary.champions} decided seasons`,
    },
    { label: 'Tournaments', value: String(summary.tournaments) },
  ]

  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden border border-border bg-border sm:grid-cols-3">
      {cells.map((c) => (
        <div key={c.label} className="bg-card px-3 py-2.5" title={c.hint}>
          <dt className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{c.label}</dt>
          <dd className="tabular mt-0.5 font-display text-xl font-black text-foreground">{c.value}</dd>
        </div>
      ))}
    </dl>
  )
}
