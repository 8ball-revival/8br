import { cn } from '@/lib/utils'

/**
 * The bar across the foot of the Homepage and the Rankings page.
 *
 * ── Real figures only ────────────────────────────────────────────────────────────────────────────
 * The design mock showed 12,842 players and 1,274,591 matches. Those are invented numbers from a
 * picture, and printing them would make the most prominent summary of the site's scale a lie. The
 * rail takes its values from `getRegistryStats`, the same canonical service the homepage "By the
 * Numbers" panel uses, so the two can never disagree and neither can drift from the database.
 *
 * ── The status light is measured, not decorative ─────────────────────────────────────────────────
 * A hard-coded "SYSTEM: NOMINAL" is worse than no indicator: it says everything is fine at exactly
 * the moment it cannot know that. This one reports what it can actually observe — whether the
 * figures beside it came back. `getRegistryStats` falls back to zeroes when the query fails, so an
 * all-zero result means the database was not reachable when this page was rendered, and the light
 * says so. It claims nothing about anything it did not measure.
 */
export function StatusRail({
  players,
  matches,
  seasons,
  className,
}: {
  players: number
  matches: number
  seasons: number
  className?: string
}) {
  const reachable = players > 0 || seasons > 0

  return (
    <div
      className={cn(
        'mt-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t-2 border-[var(--hot-red)] bg-[var(--graphite)] px-4 py-3',
        className,
      )}
    >
      <dl className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <RailFigure label="Players" value={players} />
        <RailFigure label="Matches recorded" value={matches} />
        <RailFigure label="Seasons" value={seasons} />
      </dl>

      <p className="hidden text-[0.7rem] font-bold uppercase tracking-[0.35em] text-[var(--acid)] lg:block">
        Pool. Compete. Archive.
      </p>

      <div className="flex items-center gap-2">
        <span
          className={cn(
            'size-2 shrink-0 rounded-full',
            reachable ? 'bg-[var(--success)]' : 'bg-[var(--hot-red)]',
          )}
          aria-hidden
        />
        <span className="text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Registry data
        </span>
        {/*
          The word carries the state as well as the colour, so the indicator still means something
          to a reader who cannot tell the green dot from the red one.
        */}
        <span
          className={cn(
            'text-[0.62rem] font-bold uppercase tracking-[0.12em]',
            reachable ? 'text-[var(--success)]' : 'text-[var(--hot-red)]',
          )}
        >
          {reachable ? 'Live' : 'Unavailable'}
        </span>
      </div>
    </div>
  )
}

function RailFigure({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </dt>
      <dd className="tabular text-sm font-bold text-foreground">{value.toLocaleString()}</dd>
    </div>
  )
}
