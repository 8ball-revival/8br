import Link from 'next/link'
import { Trophy, Users, LayoutGrid, Swords, Target, ArrowRight } from 'lucide-react'

import { cn } from '@/lib/utils'
import { identityLines } from '@/lib/identity/display'
import { SEASON_STATE_LABEL, type SeasonState } from '@/lib/seasons/shared'
import type { SeasonGlance } from '@/lib/seasons/browse'

/**
 * The Season masthead: identity, champion, and the Season at a glance, across the full page width.
 *
 * Three sections in one frame. The champion is the focal point and gets the widest column, because
 * on a finished Season that is the thing people came to see; the identity block on the left answers
 * "which Season am I looking at" and the figures on the right answer "how big was it".
 *
 * A Season with no champion never shows a provisional one. Until the final is decided the middle
 * section says plainly that the Season is in progress and names the stage it has reached.
 *
 * Every value comes from the registry row it is handed. Nothing here is derived from a formula that
 * could drift from what the database actually holds.
 */
export function SeasonMasthead({
  competitionName,
  competitionShortName,
  number,
  year,
  subtitle,
  state,
  glance,
  champion,
  playoffsHref,
}: {
  competitionName: string
  competitionShortName: string
  number: number
  year: number
  subtitle: string | null
  state: SeasonState
  glance: SeasonGlance
  /** Present only once the Season is closed and a champion is recorded. */
  champion: {
    cueverseId: string | null
    preferredName: string | null
    runnerUpCueverseId: string | null
    runnerUpName: string | null
    finalScore: string | null
  } | null
  /** Switches the view toggle to the bracket; the URL carries `view=playoffs`. */
  playoffsHref: string
}) {
  return (
    <section
      aria-label={`${competitionName} Season ${number}, ${year}`}
      className="w-full overflow-hidden rounded-2xl border border-[color-mix(in_oklch,var(--gold-dim)_60%,transparent)] bg-card"
    >
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1.05fr)]">
        <Identity
          competitionShortName={competitionShortName}
          number={number}
          year={year}
          subtitle={subtitle}
          state={state}
          entrants={glance.entrants}
          groups={glance.groups}
          playoffsHref={playoffsHref}
        />

        {/* Dividers are charcoal hairlines that follow the stacking direction: a top border while
            the sections are stacked, a left border once they sit side by side. */}
        <div className="border-t border-border lg:border-l lg:border-t-0">
          {champion ? <Champion {...champion} /> : <InProgress state={state} />}
        </div>

        <div className="border-t border-border lg:border-l lg:border-t-0">
          <Glance glance={glance} />
        </div>
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- left: identity */

function Identity({
  competitionShortName, number, year, subtitle, state, entrants, groups, playoffsHref,
}: {
  competitionShortName: string
  number: number
  year: number
  subtitle: string | null
  state: SeasonState
  entrants: number
  groups: number
  playoffsHref: string
}) {
  return (
    <div className="flex flex-col gap-3 p-5 sm:p-6">
      <p className="text-[0.65rem] font-extrabold uppercase tracking-[0.16em] text-[var(--gold)]">
        {competitionShortName}
      </p>
      <div>
        <h1 className="font-display text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-4xl">
          Season {number} <span className="text-[var(--gold)]">·</span> {year}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={state === 'COMPLETED' ? 'gold' : 'live'}>{SEASON_STATE_LABEL[state]}</Pill>
        <Pill>{entrants} entrant{entrants === 1 ? '' : 's'}</Pill>
        <Pill>{groups} group{groups === 1 ? '' : 's'}</Pill>
      </div>

      <Link
        href={playoffsHref}
        className="mt-auto inline-flex w-fit items-center gap-2 rounded-lg border border-[var(--gold-dim)] bg-[color-mix(in_oklch,var(--gold)_10%,transparent)] px-4 py-2 text-sm font-semibold text-[var(--gold-soft)] transition-colors hover:bg-[color-mix(in_oklch,var(--gold)_18%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/45"
      >
        View Playoffs <ArrowRight className="size-4" aria-hidden />
      </Link>
    </div>
  )
}

function Pill({ children, tone }: { children: React.ReactNode; tone?: 'gold' | 'live' }) {
  return (
    <span className={cn(
      'whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[0.72rem]',
      tone === 'gold' ? 'border-[var(--gold-dim)] text-[var(--gold-soft)]'
        : tone === 'live' ? 'border-[var(--gold-dim)]/60 text-[var(--gold-soft)]'
          : 'border-border text-muted-foreground',
    )}>
      {children}
    </span>
  )
}

/* ---------------------------------------------------------------- centre: champion */

function Champion({
  cueverseId, preferredName, runnerUpCueverseId, runnerUpName, finalScore,
}: {
  cueverseId: string | null
  preferredName: string | null
  runnerUpCueverseId: string | null
  runnerUpName: string | null
  finalScore: string | null
}) {
  // The preferred name leads HERE, deliberately against the site-wide rule. This is a single
  // celebratory line about one person rather than a list to tell people apart in, and the CueVerse
  // ID sits directly beneath it, so nothing is lost.
  const lines = identityLines({ cueverseId, preferredName })
  const primary = preferredName?.trim() || lines.primary
  const secondary = preferredName?.trim() ? lines.primary : null
  const runnerUp = identityLines({ cueverseId: runnerUpCueverseId, preferredName: runnerUpName })

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 bg-[radial-gradient(120%_120%_at_50%_0%,color-mix(in_oklch,var(--gold)_11%,transparent),transparent_70%)] p-5 text-center sm:p-6">
      <ChampionTrophy />
      <p className="text-[0.62rem] font-extrabold uppercase tracking-[0.22em] text-[var(--gold)]">
        Season Champion
      </p>
      <p className="font-display text-4xl font-bold leading-none tracking-tight text-foreground sm:text-5xl">
        {primary}
      </p>
      {secondary && <p className="text-sm text-muted-foreground">{secondary}</p>}

      {finalScore && (
        <p className="tabular mt-1 text-2xl font-bold text-[var(--gold)]">{finalScore}</p>
      )}
      {(runnerUpName || runnerUpCueverseId) && (
        <p className="text-sm text-muted-foreground">
          def. <span className="text-foreground">{runnerUp.primary}</span>
          {runnerUp.secondary && <span className="text-muted-foreground"> ({runnerUp.secondary})</span>}
        </p>
      )}
    </div>
  )
}

/**
 * The championship trophy.
 *
 * Drawn with the project's icon set and lit with two layered drop-shadows built from the gold token
 * — a tight one for definition and a wider, weaker one for the halo. Shadows keep the silhouette
 * sharp, which a blur or a glow filter would not; there is no animation, so it reads as prestige
 * rather than decoration.
 */
function ChampionTrophy() {
  return (
    <span className="relative flex size-16 items-center justify-center sm:size-[4.5rem]">
      <span
        aria-hidden
        className="absolute inset-0 rounded-full bg-[radial-gradient(circle,color-mix(in_oklch,var(--gold)_28%,transparent),transparent_68%)]"
      />
      <Trophy
        aria-hidden
        strokeWidth={1.5}
        className="relative size-12 fill-[color-mix(in_oklch,var(--gold)_32%,transparent)] text-[var(--gold-soft)] drop-shadow-[0_0_6px_color-mix(in_oklch,var(--gold)_70%,transparent)] sm:size-14"
      />
    </span>
  )
}

/* ---------------------------------------------------------------- centre: not finished */

/** What each stage means for someone waiting on a result. */
const STAGE_NOTE: Record<SeasonState, string> = {
  REGISTRATION_SCHEDULED: 'Registration opens soon.',
  REGISTRATION_OPEN: 'Registration is open — entrants are still joining.',
  REGISTRATION_CLOSED: 'Registration is closed. The groups are being drawn.',
  GROUP_SETUP: 'The groups are being drawn.',
  GROUP_STAGE_LIVE: 'Group matches are being played and results appear as they are entered.',
  GROUPS_CLOSED: 'The group stage is complete. The playoff field is being finalised.',
  PLAYOFF_SETUP: 'The playoff field is being finalised.',
  PLAYOFFS_LIVE: 'The playoff bracket is under way.',
  COMPLETED: '',
}

function InProgress({ state }: { state: SeasonState }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-5 text-center sm:p-6">
      <span className="relative flex size-14 items-center justify-center">
        <Trophy aria-hidden strokeWidth={1.5} className="size-11 text-[var(--gold-dim)]/60" />
      </span>
      <p className="text-[0.62rem] font-extrabold uppercase tracking-[0.22em] text-muted-foreground">
        Season In Progress
      </p>
      <p className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
        {SEASON_STATE_LABEL[state]}
      </p>
      <p className="max-w-xs text-sm text-muted-foreground">{STAGE_NOTE[state]}</p>
      <p className="text-xs text-muted-foreground/80">
        A champion appears here once the final is decided.
      </p>
    </div>
  )
}

/* ---------------------------------------------------------------- right: at a glance */

function Glance({ glance }: { glance: SeasonGlance }) {
  const cards = [
    { label: 'Entrants', value: glance.entrants, Icon: Users },
    { label: 'Groups', value: glance.groups, Icon: LayoutGrid },
    { label: 'Games per Match', value: glance.gamesPerMatch, Icon: Target },
    { label: 'Total Matches', value: glance.totalMatches, Icon: Swords },
  ]
  return (
    <div className="flex h-full flex-col gap-3 p-5 sm:p-6">
      <p className="text-[0.62rem] font-extrabold uppercase tracking-[0.16em] text-muted-foreground">
        Season at a Glance
      </p>
      {/* Four equal cells, so no figure looks more important than another. */}
      <div className="grid flex-1 grid-cols-2 gap-2.5">
        {cards.map(({ label, value, Icon }) => (
          <div
            key={label}
            className="flex flex-col justify-center gap-1 rounded-lg border border-border bg-surface px-3 py-3"
          >
            <span className="flex items-center gap-1.5 text-[0.62rem] font-semibold uppercase tracking-wide text-muted-foreground">
              <Icon className="size-3.5 shrink-0 text-[var(--gold-dim)]" aria-hidden />
              {label}
            </span>
            <span className="tabular font-display text-2xl font-bold leading-none text-foreground">
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
