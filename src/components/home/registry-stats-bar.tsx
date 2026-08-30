import { cn } from '@/lib/utils'

/**
 * The thin bar of site-wide totals across the bottom of the page.
 *
 * ── Why the totals moved here ───────────────────────────────────────────────────────────────────
 * They used to sit on cards among the achievements, where a count of every player on the site read
 * as though somebody had won it. Totals describe the archive rather than a person, so they belong in
 * a rule at the foot of the page, in the same register as a status line — which is also why the
 * numbers are quiet here and the achievements above are not.
 *
 * ── Every figure is queried ─────────────────────────────────────────────────────────────────────
 * Nothing on this component knows what any of these numbers are. They arrive from `getRegistryStats`
 * and are formatted here, so a bar that says 8,228 matches says it because that is how many there
 * are today.
 */
export function RegistryStatsBar({
  players, matches, seasons,
  playersLabel, matchesLabel, seasonsLabel,
  tagline, liveLabel, liveState,
}: {
  players: number
  matches: number
  seasons: number
  playersLabel: string
  matchesLabel: string
  seasonsLabel: string
  tagline: string
  liveLabel: string
  liveState: string
}) {
  return (
    <section
      aria-label="Registry totals"
      className="border-y border-[var(--line-strong)] bg-[var(--surface-inset)]"
    >
      <div className="mx-auto flex w-full max-w-[var(--sb-container-width,96rem)] flex-col items-center gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:justify-between lg:gap-6 lg:px-8">
        <dl className="flex flex-wrap items-baseline justify-center gap-x-6 gap-y-1.5 lg:justify-start">
          <Stat label={playersLabel} value={players} />
          <Stat label={matchesLabel} value={matches} />
          <Stat label={seasonsLabel} value={seasons} />
        </dl>

        {tagline && (
          <p className="text-center font-condensed text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[var(--steel-bright)]">
            {tagline}
          </p>
        )}

        <p className="flex items-center gap-2 font-condensed text-[0.66rem] font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">
          {liveLabel}
          <span className="inline-flex items-center gap-1.5 text-[var(--signal)]">
            {/*
              A dot AND the word. Colour alone would make the state invisible to anybody who cannot
              distinguish it, and a status indicator is exactly the kind of thing that has to survive
              being seen in greyscale.
            */}
            <span aria-hidden className="size-1.5 rounded-full bg-[var(--signal)]" />
            {liveState}
          </span>
        </p>
      </div>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="font-condensed text-[0.66rem] font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">
        {label}
      </dt>
      <dd
        className={cn(
          'font-condensed text-base font-bold leading-none text-[var(--text-primary)]',
          '[font-variant-numeric:tabular-nums]',
        )}
      >
        {value.toLocaleString('en-GB')}
      </dd>
    </div>
  )
}
