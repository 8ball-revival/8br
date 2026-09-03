import Link from 'next/link'
import { PlatformBadge, divisionLabel, UnrankedBadge } from '@/components/platform/platform-badge'
import { Trophy, ArrowRight } from 'lucide-react'

import { cn } from '@/lib/utils'
import { identityLines } from '@/lib/identity/display'
import { SEASON_STATE_LABEL, type SeasonState } from '@/lib/seasons/shared'

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
  champion,
  playoffsHref,
  platform,
  division,
  ranked,
}: {
  platform: 'CUEVERSE' | 'YAHOO'
  division: string | null
  /** False for Division B: recorded in full, contributes to no ladder. */
  ranked: boolean
  competitionName: string
  competitionShortName: string
  number: number
  year: number
  subtitle: string | null
  state: SeasonState
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
      className="dl-surface cyber-clip w-full overflow-hidden border border-[var(--line-strong)] bg-[var(--graphite)]"
    >
      {/*
        Two panels, not three.

        "Season at a Glance" used to sit here with Entrants, Groups, Games per Match and Total
        Matches — every one of which the Groups view's own overview now states, from the same
        derivation the tables beneath it use. Two panels counting the same season a few inches apart
        is how the page came to disagree with itself, so the figures live in one place and the
        masthead keeps what only it can say: which Season this is, and who won it.
      */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Identity
          competitionShortName={competitionShortName}
          number={number}
          year={year}
          subtitle={subtitle}
          state={state}
          platform={platform}
          division={division}
          ranked={ranked}
          playoffsHref={playoffsHref}
        />

        {/* Dividers are charcoal hairlines that follow the stacking direction: a top border while
            the sections are stacked, a left border once they sit side by side. */}
        <div className="border-t border-border lg:border-l lg:border-t-0">
          {champion ? <Champion {...champion} /> : <InProgress state={state} />}
        </div>
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- left: identity */

function Identity({
  competitionShortName, number, year, subtitle, state, playoffsHref,
  platform, division, ranked,
}: {
  platform: 'CUEVERSE' | 'YAHOO'
  division: string | null
  ranked: boolean
  competitionShortName: string
  number: number
  year: number
  subtitle: string | null
  state: SeasonState
  playoffsHref: string
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3.5">
      <p className="text-[0.65rem] font-extrabold uppercase tracking-[0.16em] text-[var(--gold)]">
        {competitionShortName}
      </p>
      <div>
        <h1 className="font-display text-2xl font-bold leading-tight tracking-tight text-foreground">
          Season {number} <span className="text-[var(--gold)]">·</span> {year}
        </h1>
        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Pill tone={state === 'COMPLETED' ? 'gold' : 'live'}>{SEASON_STATE_LABEL[state]}</Pill>
        {/*
          Entrants and groups are NOT repeated here.

          They are two of the four figures the Groups overview states directly beneath this
          masthead, derived from the same rows the tables use. A second copy a few inches away is
          the duplication the redesign set out to remove — and it was the copy most likely to be
          stale, because it came from a different service than the tables did.
        */}
        {division && <Pill>{divisionLabel(division)}</Pill>}
        {/*
          Unranked is stated rather than left to be inferred. Without it, the only clue that a
          Division B Season ranks nothing is that its players have no rating — which reads as
          missing data rather than as the rule it is.
        */}
        {!ranked && <UnrankedBadge />}
        <PlatformBadge platform={platform} className="ml-auto" />
      </div>

      <Link
        href={playoffsHref}
        className="inline-flex w-fit items-center gap-1.5 cyber-clip border border-[var(--gold-dim)] bg-[var(--drop-surface)] px-3 py-1.5 text-[0.8rem] font-semibold text-[var(--gold-soft)] transition-colors hover:bg-[var(--drop-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/45"
      >
        View Playoffs <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </div>
  )
}

function Pill({ children, tone }: { children: React.ReactNode; tone?: 'gold' | 'live' }) {
  return (
    <span className={cn(
      'whitespace-nowrap cyber-clip-sm border px-2.5 py-0.5 text-[0.72rem]',
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
    // Laid out sideways: the trophy and its label on the left, the winner on the right. Stacking
    // them made the section tall enough to set the height of the whole masthead, which meant
    // shrinking the trophy to compensate. Across the width, the trophy keeps its presence and the
    // section costs barely more height than a line of text.
    //
    // A gold RULE, not a gold wash. This panel was backed by a radial gradient of gold at 11% over
    // the card, and a warm colour at low alpha on a dark surface does not read as a pale gold tint
    // but as olive-brown. It was the largest remaining instance of that in the interface. The
    // champion is marked by a lit top edge and by the gold the trophy and the name already carry,
    // which is stronger and stays gold.
    <div className="flex h-full items-center justify-center gap-3 border-t-2 border-[var(--gold)] bg-[var(--selected-surface)] px-4 py-3.5">
      <div className="flex shrink-0 flex-col items-center gap-1">
        <ChampionTrophy />
        <p className="whitespace-nowrap text-[0.66rem] font-extrabold uppercase tracking-[0.16em] text-[var(--gold)]">
          Season Champion
        </p>
      </div>

      <div className="min-w-0">
        <p className="truncate font-display text-2xl font-bold leading-none tracking-tight text-foreground">
          {primary}
        </p>
        {secondary && <p className="truncate text-xs text-muted-foreground">{secondary}</p>}

        {/* Score and runner-up share one line — two short facts about the same match. */}
        <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
          {finalScore && <span className="tabular text-lg font-bold text-[var(--gold)]">{finalScore}</span>}
          {(runnerUpName || runnerUpCueverseId) && (
            <span className="truncate">
              def. <span className="text-foreground">{runnerUp.primary}</span>
              {runnerUp.secondary && <span className="text-muted-foreground"> ({runnerUp.secondary})</span>}
            </span>
          )}
        </p>
      </div>
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
    <span className="relative flex size-12 items-center justify-center">
      <span
        aria-hidden
        /*
        The halo behind the trophy is gone for the same reason, and because a circular glow around a
        medal is the decorative treatment this design brief rules out by name. The icon keeps its own
        drop-shadow, which is light rather than a fill and so cannot mix with the surface.
      */
        className="absolute inset-0"
      />
      <Trophy
        aria-hidden
        strokeWidth={1.5}
        className="relative size-9 fill-[color-mix(in_oklch,var(--gold)_32%,transparent)] text-[var(--gold-soft)] drop-shadow-[0_0_6px_color-mix(in_oklch,var(--gold)_70%,transparent)]"
      />
    </span>
  )
}

/* ---------------------------------------------------------------- centre: not finished */

/** What each stage means for someone waiting on a result. */
const STAGE_NOTE: Record<SeasonState, string> = {
  REGISTRATION_SCHEDULED: 'Registration opens soon.',
  REGISTRATION_OPEN: 'Registration is open — entrants are still joining.',
  REGISTRATION_CLOSED: 'Registration Closed — groups will be published shortly.',
  GROUP_SETUP: 'Registration Closed — groups will be published shortly.',
  GROUP_STAGE_LIVE: 'Group matches are being played and results appear as they are entered.',
  GROUPS_CLOSED: 'Group Stage Complete — playoff bracket coming shortly.',
  PLAYOFF_SETUP: 'The playoff field is being finalised.',
  PLAYOFFS_LIVE: 'The playoff bracket is under way.',
  COMPLETED: '',
}

function InProgress({ state }: { state: SeasonState }) {
  return (
    <div className="flex h-full items-center justify-center gap-4 px-4 py-3.5">
      <div className="flex shrink-0 flex-col items-center gap-1">
        <Trophy aria-hidden strokeWidth={1.5} className="size-11 text-[var(--gold-dim)]/60" />
        <p className="whitespace-nowrap text-[0.66rem] font-extrabold uppercase tracking-[0.16em] text-muted-foreground">
          Season In Progress
        </p>
      </div>
      <div className="min-w-0">
        <p className="font-display text-xl font-bold leading-tight tracking-tight text-foreground">
          {SEASON_STATE_LABEL[state]}
        </p>
        <p className="text-xs text-muted-foreground">{STAGE_NOTE[state]}</p>
        <p className="mt-0.5 text-[0.7rem] text-muted-foreground/80">
          A champion appears here once the final is decided.
        </p>
      </div>
    </div>
  )
}

