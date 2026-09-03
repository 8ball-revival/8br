'use client'

import { useRef, useState } from 'react'

import { SeasonGroupBoard } from '@/components/seasons/season-group-board'
import { usePrefersReducedMotion } from '@/components/players/profile/motion'
import type { GroupBoard } from '@/lib/seasons/group-board'
import { cn } from '@/lib/utils'

/**
 * The Groups view: the season overview, the group navigation, and one board per group.
 *
 * ── Every figure has exactly one home ───────────────────────────────────────────────────────────
 * The old page showed Groups / Players / Matches / Qualified in a deck AND repeated them beside the
 * "Groups" heading, and the two were computed separately. The season totals now live only in the
 * overview; the heading's space is spent on navigation instead; and a group header carries only
 * facts about that group. Nothing on the page is stated twice.
 */
export function GroupBoards({ board, status, initialGroup }: {
  board: GroupBoard
  /** The stage label and its live state, from the Season's lifecycle. */
  status: { label: string; note: string; live: boolean }
  /**
   * The group named in the URL, resolved on the SERVER.
   *
   * Passed in rather than read from `window` in an effect. Reading it here would mean the first
   * paint shows every group and then drops to one — a visible flash on a shared link — and would set
   * state during an effect, which is the pattern React now warns about.
   */
  initialGroup: string
}) {
  const { groups, totals } = board
  /*
    Which group is showing. `all` is the default and the URL's absence.

    Held here rather than in a route param because switching groups must not re-fetch a page whose
    data is already in the browser — but it IS written to the URL below, so a refresh or a shared
    link comes back to the same group.
  */
  const [showing, setShowing] = useState<string>(initialGroup)

  const choose = (code: string) => {
    setShowing(code)
    /*
      `replaceState`, not a router navigation.

      Switching group is a change of view over data already loaded. A router push would re-render
      the whole route to show rows the browser already has, and would put every group tap into the
      back-button history, which is not what Back means to a reader on this page.
    */
    const url = new URL(window.location.href)
    if (code === 'all') url.searchParams.delete('group')
    else url.searchParams.set('group', code)
    window.history.replaceState(null, '', url)
  }

  const visible = showing === 'all' ? groups : groups.filter((g) => g.code === showing)

  return (
    <div className="flex flex-col gap-5">
      <SeasonOverview board={board} status={status} />

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2">
        <h2 className="flex items-center gap-2.5 font-display text-2xl font-black uppercase tracking-[0.04em] text-foreground">
          <span aria-hidden className="inline-block h-6 w-[3px] bg-[var(--neon-cyan)]" />
          Groups
        </h2>
        {/*
          The navigation the repeated figures used to occupy.

          Generated from the groups that exist, so a season with three or six of them gets three or
          six buttons — nothing here assumes four.
        */}
        <nav className="gb-nav" aria-label="Jump to a group">
          <button
            type="button"
            className="gb-nav-btn"
            aria-pressed={showing === 'all'}
            onClick={() => choose('all')}
          >
            All groups
          </button>
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              className="gb-nav-btn"
              aria-pressed={showing === g.code}
              onClick={() => choose(g.code)}
            >
              {g.code}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex flex-col gap-6">
        {visible.map((g) => (
          <SeasonGroupBoard key={g.id} group={g} />
        ))}
      </div>

      {/* Screen readers are told what the buttons did, since the change is purely visual otherwise. */}
      <p aria-live="polite" className="sr-only">
        {showing === 'all'
          ? `Showing all ${groups.length} groups.`
          : `Showing group ${showing} only.`}
      </p>
      <p className="sr-only">{totals.entrants} entrants across {totals.groups} groups.</p>
    </div>
  )
}

/**
 * The season overview: four figures, a format badge, and an honest completion rail.
 *
 * ── The rail ────────────────────────────────────────────────────────────────────────────────────
 * The width and the label are the same number. That sounds trivial and was the previous version's
 * actual defect: a two-colour bar whose fill came from a different quantity than the caption, so
 * 22 of 112 rendered as roughly half and read as "nearly there".
 */
function SeasonOverview({ board, status }: {
  board: GroupBoard
  status: { label: string; note: string; live: boolean }
}) {
  const railRef = useRef<HTMLDivElement>(null)
  /*
    The sheen is the only motion here and it is the least important thing on the page, so it is
    switched off by the same preference that governs everything else. `usePrefersReducedMotion`
    rather than the full gate: this sits at the top of the page and is effectively always on screen.
  */
  const reduced = usePrefersReducedMotion()
  const { totals, gamesPerSet } = board

  return (
    <section
      aria-label="Season overview"
      className="gb-panel px-4 py-3.5 sm:px-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className={cn(
              'cyber-clip-sm border px-2.5 py-0.5 font-condensed text-[0.66rem] font-bold uppercase tracking-[0.16em]',
              status.live
                ? 'border-[var(--hot-red)]/60 text-[var(--hot-red)]'
                : 'border-border text-muted-foreground',
            )}>
              {status.label}
            </span>
            {/*
              The format rule, as a badge rather than a headline figure.

              "10 games per set" answers "how is this played", not "how far along is it" — it sat in
              the statistics row looking like progress and was the only number there that never
              changed.
            */}
            <span className="cyber-clip-sm border border-border px-2.5 py-0.5 font-condensed text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {gamesPerSet} games per set
            </span>
          </p>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">{status.note}</p>
        </div>

        <div className="min-w-0 flex-1">
          <dl className="flex flex-wrap items-start justify-end gap-x-7 gap-y-3 sm:gap-x-9">
            <Figure label="Entrants" value={String(totals.entrants)} />
            <Figure label="Groups" value={String(totals.groups)} />
            <Figure
              label="Sets played"
              value={`${totals.setsPlayed} / ${totals.setsTotal}`}
              srValue={`${totals.setsPlayed} of ${totals.setsTotal} sets played`}
            />
            <Figure label="Clinched" value={String(totals.clinched)} />
          </dl>

          <div className="mt-3.5">
            <div
              ref={railRef}
              className={cn('gb-rail', !reduced && 'gb-rail-live')}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={totals.percent}
              aria-label={`Group stage ${totals.percent}% complete`}
            >
              {/*
                One number, two uses. `percent` is what the label prints and what the fill is drawn
                from, so the bar cannot say something the caption contradicts.
              */}
              <span className="gb-rail-fill" style={{ width: `${totals.percent}%` }} />
            </div>
            <p className="mt-1.5 text-right font-condensed text-[0.66rem] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
              {totals.percent}% complete
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

function Figure({ label, value, srValue }: { label: string; value: string; srValue?: string }) {
  return (
    <div className="text-right">
      <dd className="tabular font-display text-2xl font-black leading-none text-foreground">
        {srValue ? (
          <>
            <span className="sr-only">{srValue}</span>
            <span aria-hidden>{value}</span>
          </>
        ) : value}
      </dd>
      <dt className="mt-1.5 font-condensed text-[0.6rem] font-bold uppercase leading-none tracking-[0.16em] text-[var(--text-muted)]">
        {label}
      </dt>
    </div>
  )
}
