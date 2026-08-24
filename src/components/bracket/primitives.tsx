/**
 * The one bracket presentation system.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────────
 * A bracket is drawn in six places — the public Season playoff, the Creator draft and score-entry
 * boards, the public Tournament bracket, and the Creator Tournament draft and scoring boards — and
 * until now two of them carried their own card, row, seed badge and name stack. The two drifted, as
 * duplicated presentation always does: different padding, different winner treatment, one with a
 * crown and one without.
 *
 * Everything visual now comes from here. Data adapters stay separate, because a Season playoff and a
 * Tournament bracket genuinely are different queries; what they may not have is different-looking
 * results.
 *
 * ── The result language ──────────────────────────────────────────────────────────────────────────
 * Gold means a decided winner and nothing else.
 *
 * Before a result both entrants are neutral, both scores are neutral, and every connector is grey —
 * nothing may hint at an outcome that has not happened. After one, the winning CueVerse ID, the
 * winning score and a thin rail on the winning row turn gold, and so does the connector carrying
 * that player forward. The loser stays cool grey; it is never reddened, because losing a frame of
 * pool is not an error state.
 *
 * No row is filled with gold. Gold at low opacity over charcoal mixes to olive-brown, not to a pale
 * gold wash, which is how the old highlight ended up muddy. Hierarchy, an edge and the connector do
 * the work instead.
 *
 * The champion needs no ornament. A finished bracket already carries an unbroken gold path from the
 * opening round to the Final, and the eye follows it without a crown, a circle or a halo.
 */
'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { identityLines, fromNameHandle } from '@/lib/identity/display'
import type { BracketSlot } from '@/lib/tournaments/service'

/** What a row is showing, which decides its wording and its weight. */
export type SlotState =
  | 'player'    // a real competitor
  | 'tbd'       // the match exists, the player is not known yet
  | 'open'      // a deliberately empty placement slot on a draft board
  | 'bye'       // nobody to play — never a scored victory

/** Read the state off a slot rather than making six call sites re-derive it. */
export function slotState(slot?: BracketSlot, openLabel = false): SlotState {
  if (slot?.name === 'Bye') return 'bye'
  if (!slot?.name) return openLabel ? 'open' : 'tbd'
  return 'player'
}

const PLACEHOLDER: Record<Exclude<SlotState, 'player'>, string> = {
  tbd: 'TBD',
  open: 'Open',
  bye: 'bye',
}

/**
 * The seed chip.
 *
 * A circle, because the mockup uses one and because a bare number beside a handle reads as part of
 * the handle. It stays neutral in every state: a seed is a fact about the draw, not about who won.
 */
export function BracketSeed({ seed, className }: { seed?: number | null; className?: string }) {
  if (seed == null) return null
  return (
    <span
      aria-hidden
      className={cn(
        'tabular inline-flex size-[1.15rem] shrink-0 items-center justify-center rounded-full',
        'border border-[var(--bracket-outline)] text-[0.6rem] font-medium leading-none',
        'text-[var(--bracket-text-neutral)]',
        className,
      )}
    >
      {seed}
    </span>
  )
}

/**
 * The identity stack: CueVerse ID first, preferred name beneath.
 *
 * The ID leads and is never replaced. The archive holds two Mikes in one group and several Chrises,
 * so the preferred name alone does not identify anybody — it is the secondary line, and it is
 * dropped rather than promoted when space is short.
 */
export function BracketIdentity({
  slot,
  won,
  state,
  linked = true,
}: {
  slot?: BracketSlot
  won?: boolean
  state: SlotState
  linked?: boolean
}) {
  if (state !== 'player') {
    return (
      <span className="block truncate text-[0.9rem] italic leading-tight text-[var(--bracket-text-muted)]">
        {PLACEHOLDER[state]}
      </span>
    )
  }

  const lines = identityLines(fromNameHandle(slot))
  const primary = (
    <span
      className={cn(
        'block truncate text-[0.92rem] leading-snug tracking-tight',
        won
          ? 'font-semibold text-[var(--bracket-winner)]'
          : 'font-medium text-[var(--bracket-text)]',
      )}
    >
      {lines.primary}
    </span>
  )
  const secondary = lines.secondary ? (
    <span className="block truncate text-[0.7rem] leading-tight text-[var(--bracket-text-neutral)]">
      {lines.secondary}
    </span>
  ) : null

  const profile = slot?.slug ?? slot?.handle
  if (!linked || !profile) return <>{primary}{secondary}</>
  return (
    <Link
      href={`/players/${encodeURIComponent(profile)}`}
      className="block rounded outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[var(--bracket-focus)]"
    >
      {primary}
      {secondary}
    </Link>
  )
}

/**
 * A team's identity: the team name leads, its roster's CueVerse IDs sit beneath it.
 *
 * The roster used to live entirely inside a hover popover, which put every player identity behind a
 * gesture that does not exist on touch and is invisible in a screenshot. The IDs are on the row now.
 * Preferred names are not — they are what a popover is for, and a five-a-side roster spelled out in
 * full would make the card taller than the bracket can carry.
 */
export function BracketTeamIdentity({
  slot,
  won,
  extra,
}: {
  slot?: BracketSlot
  won?: boolean
  /** The details popover trigger, when the surface offers one. */
  extra?: ReactNode
}) {
  const members = slot?.members ?? []
  return (
    <>
      <span className="flex items-center gap-1.5">
        <span
          className={cn(
            'block min-w-0 flex-1 truncate text-[0.92rem] leading-snug tracking-tight',
            won
              ? 'font-semibold text-[var(--bracket-winner)]'
              : 'font-medium text-[var(--bracket-text)]',
          )}
        >
          {slot?.name ?? 'TBD'}
        </span>
        {extra}
      </span>
      {members.length > 0 && (
        <span className="block truncate text-[0.68rem] leading-tight text-[var(--bracket-text-neutral)]">
          {members.map((m) => identityLines(fromNameHandle(m)).primary).join(' · ')}
        </span>
      )}
    </>
  )
}

/**
 * The score, or what stands in for one.
 *
 * A forfeit prints FF on the side that gave the match up and nothing at all on the other: they
 * advanced without playing, and a number there would be a frame nobody racked. A disqualification
 * reads DQ for the same reason. A bye shows nothing, because a bye is not a win.
 */
export function BracketScore({
  slot,
  won,
  state,
}: {
  slot?: BracketSlot
  won?: boolean
  state: SlotState
}) {
  if (state === 'bye' || state === 'tbd' || state === 'open') return null
  if (slot?.forfeit) {
    return (
      <span
        title="Forfeit — this player did not play"
        className="shrink-0 text-[0.72rem] font-semibold uppercase tracking-wider text-[var(--bracket-text-neutral)]"
      >
        FF
      </span>
    )
  }
  if (slot?.score == null) return null
  return (
    <span
      className={cn(
        'tabular shrink-0 text-[0.95rem]',
        won
          ? 'font-semibold text-[var(--bracket-winner)]'
          : 'font-medium text-[var(--bracket-text-neutral)]',
      )}
    >
      {slot.score}
    </span>
  )
}

/**
 * One player row.
 *
 * The winner is marked by a rail on its leading edge — an inset box-shadow rather than a border, so
 * marking a winner cannot move the row by a pixel and make the two halves of a card disagree about
 * their height.
 */
export function BracketRow({
  won,
  state,
  interactive,
  className,
  children,
  ...rest
}: {
  won?: boolean
  state?: SlotState
  interactive?: boolean
  className?: string
  children: ReactNode
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'className' | 'children'>) {
  return (
    <div
      data-won={won ? 'true' : undefined}
      data-state={state}
      className={cn(
        'flex items-center gap-2 px-2.5 py-1.5',
        won && 'shadow-[inset_2px_0_0_0_var(--bracket-winner)]',
        interactive && 'hover:bg-[var(--bracket-surface-raised)]',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

/**
 * The matchup card: two rows, one divider, one outline.
 *
 * The Final gets the same card as every other round. It is the end of the gold path, and that is
 * already the most conspicuous thing on the board.
 */
export function BracketCard({
  className,
  children,
  ...rest
}: { className?: string; children: ReactNode } & Omit<React.HTMLAttributes<HTMLDivElement>, 'className' | 'children'>) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border border-[var(--bracket-outline)] bg-[var(--bracket-surface)]',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

/** The hairline between the two rows of a card. */
export function BracketRowDivider() {
  return <div className="h-px bg-[var(--bracket-outline)]" aria-hidden />
}

/**
 * A round heading.
 *
 * The match count rides alongside the name rather than under it, so a column header stays one line
 * tall whatever the round is called.
 */
export function BracketRoundHeading({
  name,
  matchCount,
  active,
  className,
}: {
  name: string
  matchCount?: number
  active?: boolean
  className?: string
}) {
  return (
    <p
      className={cn(
        'eyebrow mb-3 flex items-baseline justify-center gap-1.5 text-center',
        active ? 'text-[var(--bracket-winner)]' : 'text-[var(--bracket-text-neutral)]',
        className,
      )}
    >
      <span>{name}</span>
      {matchCount != null && matchCount > 0 && (
        <span className="text-[0.85em] font-normal text-[var(--bracket-text-muted)]">{matchCount}</span>
      )}
    </p>
  )
}

/**
 * The private-draft marker.
 *
 * A small label, not a full-width coloured banner. A draft board is already visibly different — it
 * is on a Creator page behind a staff gate — and a warning stripe across the top of every draft
 * would train people to stop reading it.
 */
export function BracketDraftBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded border border-[var(--bracket-outline)]',
        'bg-[var(--bracket-surface)] px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.14em]',
        'text-[var(--bracket-text-neutral)]',
        className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-[var(--bracket-review)]" />
      Private draft
    </span>
  )
}

/**
 * A match-level note — needs review, corrected, unplayed.
 *
 * Review and correction are the only places a bracket says something is wrong, and they say it in
 * the warning token rather than in red: a corrected result is a record being kept honest, not a
 * failure.
 */
export function BracketNote({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'review'
}) {
  return (
    <span
      className={cn(
        'text-[0.55rem] uppercase tracking-wide',
        tone === 'review' ? 'text-[var(--bracket-review)]' : 'text-[var(--bracket-text-muted)]',
      )}
    >
      {children}
    </span>
  )
}

/**
 * The accessible name for a row.
 *
 * Both identities go in, always: a screen reader that hears only "Luis Ramirez" cannot tell which of
 * the two Chrises took the frame either.
 */
export function rowAccessibleName(slot: BracketSlot | undefined, state: SlotState): string {
  if (state !== 'player') return PLACEHOLDER[state as Exclude<SlotState, 'player'>]
  const lines = identityLines(fromNameHandle(slot))
  const roster = slot?.members?.length
    ? `, roster ${slot.members.map((m) => identityLines(fromNameHandle(m)).primary).join(', ')}`
    : ''
  return [lines.primary, lines.secondary].filter(Boolean).join(', ') + roster
}
