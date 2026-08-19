'use client'

import Link from 'next/link'
import { Crown, Loader2, Trophy } from 'lucide-react'

import type { ExplorerRow } from '@/lib/stats/ladder-explorer'
import type { PlayerDetail, RatingPoint } from '@/lib/stats/rankings-detail'
import { cn } from '@/lib/utils'

import { AliasLine } from './identity-cell'
import { Tip } from './tooltip'

/**
 * The expanded row: three balanced panels rather than one wide frame with a hole in the middle.
 *
 * By Competition (where a record came from) · Career Summary (what it adds up to) · Recent Form
 * (what just happened). At narrow widths they stack in that order, which is also the order of
 * decreasing detail, so a phone reader gets the specifics first.
 *
 * Every figure links back to the competition it came from where one exists, because a statistic
 * nobody can trace is a statistic nobody should believe.
 */

const RECORD = (r: { wins: number; losses: number; draws: number }) =>
  `${r.wins}–${r.losses}${r.draws > 0 ? `–${r.draws}` : ''}`

function PanelHeading({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mb-2 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h4>
  )
}

/** A labelled figure. `tip` explains how it was derived, on hover and on focus. */
function Stat({ label, value, tip, muted = false }: {
  label: string
  value: React.ReactNode
  tip?: string
  muted?: boolean
}) {
  return (
    <>
      <dt className="text-muted-foreground">
        {tip ? <Tip text={tip}><span className="underline decoration-dotted underline-offset-2">{label}</span></Tip> : label}
      </dt>
      <dd className={cn('text-right tabular-nums', muted && 'text-muted-foreground')}>{value}</dd>
    </>
  )
}

/**
 * A rating chart drawn only from real observations.
 *
 * One point per ranked match, joined in ledger order. There is no interpolation between them and no
 * synthetic point for a quiet month: a gap in play is a gap in the line, and the axis labels say
 * which matches the ends belong to rather than implying a continuous timeline.
 *
 * Fewer than two observations draws nothing — a single point is not a history, and a flat line
 * through one value would suggest a stability that was never measured.
 */
function RatingSpark({ points }: { points: RatingPoint[] }) {
  if (points.length < 2) {
    return (
      <p className="text-xs text-muted-foreground">
        {points.length === 1
          ? 'One rated match so far — not enough observations to draw a history.'
          : 'No rated matches yet.'}
      </p>
    )
  }

  const W = 220
  const H = 44
  const values = points.map((p) => p.rating)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const x = (i: number) => (i / (points.length - 1)) * W
  const y = (v: number) => H - ((v - min) / span) * H

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.rating).toFixed(1)}`).join(' ')
  const first = points[0]
  const last = points[points.length - 1]
  const summary = `Rating across ${points.length} rated matches: started ${first.rating}, `
    + `reached a high of ${max} and a low of ${min}, currently ${last.rating}.`

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-11 w-full"
        role="img"
        aria-label={summary}
        preserveAspectRatio="none"
      >
        <path d={path} fill="none" stroke="var(--gold)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* The text equivalent is present for everyone, not hidden behind the image role, because the
          numbers are genuinely useful and the chart is small. */}
      <figcaption className="mt-0.5 flex justify-between text-[0.65rem] tabular-nums text-muted-foreground">
        <span>{first.rating}</span>
        <span>high {max} · low {min}</span>
        <span>{last.rating}</span>
      </figcaption>
      <p className="sr-only">{summary}</p>
    </figure>
  )
}

export function ExpandedRow({
  row, detail,
}: {
  row: ExplorerRow
  detail: PlayerDetail | 'loading' | undefined
}) {
  if (detail === 'loading' || detail === undefined) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Loading this player’s history…
      </div>
    )
  }

  const titles = row.seasonTitles + row.tournamentTitles

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* ── By competition ───────────────────────────────────────────────── */}
      <section>
        <PanelHeading>By competition</PanelHeading>
        {detail.competitions.length === 0 ? (
          <p className="text-xs text-muted-foreground">No competition history in this scope.</p>
        ) : (
          <ul className="space-y-1">
            {detail.competitions.map((c) => (
              <li key={`${c.kind}-${c.label}-${c.year}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                {c.won && (
                  <Tip text={c.kind === 'season' ? 'Won this Season' : 'Won this Cup'}>
                    {c.kind === 'season'
                      ? <Crown className="size-3.5 shrink-0" style={{ color: 'var(--gold)' }} aria-label="Season Champion" />
                      : <Trophy className="size-3.5 shrink-0" style={{ color: 'var(--gold)' }} aria-label="Cup Titleholder" />}
                  </Tip>
                )}
                {c.href
                  ? <Link href={c.href} className="font-medium hover:text-[var(--gold)] hover:underline">{c.label}</Link>
                  : <span className="font-medium">{c.label}</span>}
                <span className="tabular-nums text-muted-foreground">
                  {c.wins}–{c.losses}{c.draws > 0 ? `–${c.draws}` : ''}
                  {c.matchesWithGameData > 0 && <> · GW–GL {c.gamesWon}–{c.gamesLost}</>}
                </span>
                {c.matchesWithGameData === 0 && (
                  <Tip text="This competition records who won each match but not the individual game scores, so no GW–GL is shown for it.">
                    <span className="rounded-full border border-border px-1.5 text-[0.6rem] text-muted-foreground">
                      no game scores
                    </span>
                  </Tip>
                )}
                {c.runnerUp && !c.won && (
                  <span className="rounded-full border border-border px-1.5 text-[0.6rem] text-muted-foreground">runner-up</span>
                )}
                {c.deepestRound && !c.won && !c.runnerUp && (
                  <span className="rounded-full border border-border px-1.5 text-[0.6rem] text-muted-foreground">
                    reached {c.deepestRound}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Career summary ───────────────────────────────────────────────── */}
      <section>
        <PanelHeading>Career summary</PanelHeading>
        {/* Capped, so a label and its figure stay near each other. Left to the column's full width
            the two drift apart and the eye has to travel to pair them up. */}
        <dl className="grid max-w-[20rem] grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs">
          <Stat label="Overall" value={RECORD(detail.overallRecord)}
            tip="Every recorded match, Seasons and Cups together." />
          <Stat label="Group play" value={RECORD(detail.groupRecord)}
            tip="Season group stages only." />
          <Stat label="Playoffs" value={RECORD(detail.playoffRecord)}
            tip="Season playoff brackets only." />
          <Stat label="Cups" value={RECORD(detail.tournamentRecord)}
            tip="Standalone Cups only." />

          <Stat
            label="Championships"
            value={titles === 0 ? '—' : (
              <span className="inline-flex items-center gap-1">
                {titles}
              </span>
            )}
            tip="Season Championships and Cup Titles together. The competitions behind them are listed on the left."
          />
          <Stat label="Finals reached" value={row.finalsAppearances || '—'}
            tip="Competitions where this player reached the final, counted from the round label stored on each match." />

          <Stat label="Peak rating" value={detail.peakRating ?? '—'}
            tip="The highest rating actually reached, read from the rating ledger. Not a reconstruction of a past position." />
          <Stat label="Longest winning run" value={detail.longestWinStreak ? `W${detail.longestWinStreak}` : '—'}
            tip="Longest unbroken run of wins across the whole recorded history." />

          <Stat
            label="Best season"
            tip="Highest match win percentage across a Season with at least 3 matches, then match wins, then game differential, then the more recent Season. The minimum stops a single-match Season reading as a perfect one."
            value={detail.bestSeason ? (
              <span className="whitespace-nowrap">
                {detail.bestSeason.winPct.toFixed(0)}% · {detail.bestSeason.wins}–{detail.bestSeason.losses}
              </span>
            ) : <span className="text-muted-foreground">—</span>}
            muted={!detail.bestSeason}
          />
          {detail.bestSeason && (
            <p className="col-span-2 -mt-0.5 max-w-[20rem] text-right text-[0.68rem] text-muted-foreground">
              <Link href={`/seasons/${detail.bestSeason.seasonId}`} className="hover:text-[var(--gold)] hover:underline">
                {detail.bestSeason.label}
              </Link>
            </p>
          )}

          <Stat
            label="Best playoff run"
            tip="A championship beats a runner-up finish, which beats any other run; between two of the same kind the deeper round wins, then the better playoff record, then the more recent Season."
            value={detail.bestPlayoffRun ? (
              <span className="whitespace-nowrap capitalize">
                {detail.bestPlayoffRun.outcome === 'round'
                  ? (detail.bestPlayoffRun.deepestRound ?? 'played')
                  : detail.bestPlayoffRun.outcome}
              </span>
            ) : <span className="text-muted-foreground">—</span>}
            muted={!detail.bestPlayoffRun}
          />
          {detail.bestPlayoffRun && (
            <p className="col-span-2 -mt-0.5 max-w-[20rem] text-right text-[0.68rem] text-muted-foreground">
              <Link href={`/seasons/${detail.bestPlayoffRun.seasonId}`} className="hover:text-[var(--gold)] hover:underline">
                {detail.bestPlayoffRun.label}
              </Link>
            </p>
          )}

          <Stat
            label="Strongest recorded win"
            tip="The opponent with the highest rating going INTO the match, as the rating engine recorded it at the time. Never their rating today, which would describe a different day."
            value={detail.strongestWin
              ? <span className="whitespace-nowrap">{detail.strongestWin.opponentRatingBefore}</span>
              : <span className="text-muted-foreground">unavailable</span>}
            muted={!detail.strongestWin}
          />
          {detail.strongestWin && (
            <p className="col-span-2 -mt-0.5 max-w-[20rem] text-right text-[0.68rem] text-muted-foreground">
              beat {detail.strongestWin.opponent}
              {detail.strongestWin.href
                ? <> · <Link href={detail.strongestWin.href} className="hover:text-[var(--gold)] hover:underline">{detail.strongestWin.competition}</Link></>
                : <> · {detail.strongestWin.competition}</>}
            </p>
          )}
          {!detail.strongestWin && detail.strongestWinUnavailable && (
            <p className="col-span-2 -mt-0.5 max-w-[20rem] text-right text-[0.68rem] text-muted-foreground">
              {detail.strongestWinUnavailable}
            </p>
          )}
        </dl>

        {detail.aliases.length > 0 && (
          <div className="mt-3 border-t border-border/60 pt-2">
            <AliasLine aliases={detail.aliases} />
          </div>
        )}
      </section>

      {/* ── Recent form ──────────────────────────────────────────────────── */}
      <section>
        <PanelHeading>Recent form</PanelHeading>
        {detail.recentForm.length === 0 ? (
          <p className="text-xs text-muted-foreground">No matches recorded in this scope.</p>
        ) : (
          <ul className="mb-3 flex flex-wrap gap-1">
            {detail.recentForm.map((f, i) => {
              const label = `${f.result === 'W' ? 'Win' : f.result === 'L' ? 'Loss' : 'Draw'} against ${f.opponent}`
                + `${f.score ? `, ${f.score}` : f.isForfeit ? ', by forfeit' : ', game score not recorded'}`
                + `, ${f.competition}${f.at ? `, ${new Date(f.at).toLocaleDateString()}` : ''}`
              const square = (
                <span
                  className={cn(
                    // A letter as well as a colour: the result must not depend on colour alone.
                    'grid size-7 place-items-center rounded text-[0.7rem] font-bold transition-transform',
                    'motion-safe:hover:scale-110',
                    f.result === 'W' ? 'bg-[var(--win)]/20 text-[var(--win)]'
                      : f.result === 'L' ? 'bg-[var(--loss)]/20 text-[var(--loss)]'
                        : 'bg-muted text-muted-foreground',
                  )}
                >
                  {f.result}
                </span>
              )
              return (
                <li key={`${f.at}-${i}`}>
                  <Tip text={label}>
                    {f.href ? (
                      <Link href={f.href} aria-label={label} className="block rounded">{square}</Link>
                    ) : square}
                  </Tip>
                </li>
              )
            })}
          </ul>
        )}

        <PanelHeading>Rating history</PanelHeading>
        <RatingSpark points={detail.ratingHistory} />

        {/* Where to go next, gathered in one place now that the row itself is just a control that
            opens this panel. Comparison lives here too: it used to be a checkbox on every row,
            which put a permanent form control in front of a reader who mostly wanted to read. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link
            href={`/players/${row.slug}`}
            className="inline-block rounded text-xs text-[var(--gold)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
          >
            Full profile →
          </Link>
        </div>
      </section>
    </div>
  )
}
