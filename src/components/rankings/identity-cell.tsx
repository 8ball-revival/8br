'use client'

import Link from 'next/link'

import { cn } from '@/lib/utils'
import { identityLines, identityText } from '@/lib/identity/display'

/**
 * How a player is named on every Rankings surface.
 *
 * ── What changed, and why it mattered ────────────────────────────────────────────────────────────
 * This used to lead with the Preferred Name in gold and put the CueVerse ID underneath — the exact
 * opposite of `PlayerName`, which every other surface on the site uses. Two components, one job,
 * two answers: the same player read as "James / cue.ball" in the ladder and "cue.ball / James" in a
 * group table.
 *
 * The ID leads, everywhere. There are six players called Chris on this site and six called Craig; a
 * Preferred Name is something a competitor also has, never the thing that identifies them. So the
 * ordering decision now lives in exactly one place — `identityLines` — and this component only
 * decides how the two lines it is handed should LOOK.
 *
 * ── Colour ───────────────────────────────────────────────────────────────────────────────────────
 * The handle is cyan because it is a link to the profile, and cyan is what an interactive thing is
 * in this palette. Gold is not used here at all: gold means a championship, and a name is not one.
 *
 * ── The fallbacks ────────────────────────────────────────────────────────────────────────────────
 *  - both, and different  → two lines.
 *  - the same after normalisation → one line, because printing "Starkiller" twice reads as a fault.
 *  - a handle only → one line.
 *  - a Preferred Name only → one line, and nothing is invented to fill the gap. Seven of the 516
 *    players carry no handle; fabricating one would be worse than showing the name they do have.
 *  - neither → an em dash, so a row can never render as an empty cell.
 *
 * A long value truncates and carries its full text in `title` — the one tooltip mechanism that works
 * for a pointer, a screen reader and a focused element without a custom popup and its focus trap.
 */

export interface Identity {
  preferredName: string
  cueverseId: string | null
  /** Profile slug. When present the whole cell is a link to the player's profile. */
  slug?: string | null
}

const norm = (v: string) => v.trim().toLowerCase()

export type IdentityShape = 'both' | 'name-only' | 'id-only' | 'none'

/**
 * Which of the four shapes this identity is. Exported so the rules can be tested directly.
 *
 * Deliberately still describes the DATA rather than the layout: "name-only" means no handle exists,
 * not that the name is shown first. Nothing shows a Preferred Name in the leading position any more.
 */
export function identityShape(id: Identity): IdentityShape {
  const name = id.preferredName?.trim() ?? ''
  const cue = id.cueverseId?.trim() ?? ''
  if (!name && !cue) return 'none'
  if (name && cue && norm(name) !== norm(cue)) return 'both'
  if (cue) return 'id-only'
  return 'name-only'
}

export function IdentityCell({
  identity, className, compact = false,
}: {
  identity: Identity
  className?: string
  /** Single-line rendering for tight places: chips, comparison headers, autocomplete rows. */
  compact?: boolean
}) {
  const shape = identityShape(identity)
  // One source of truth for WHICH half leads. This component only styles the result.
  const { primary, secondary } = identityLines(identity)

  const body = (() => {
    if (shape === 'none') return <span className="text-muted-foreground">—</span>
    return (
      <>
        <span
          className="block truncate font-semibold leading-tight text-[var(--player-name)]"
          title={primary}
        >
          {primary}
        </span>
        {secondary && (
          <span
            className={cn(
              'block truncate leading-tight text-muted-foreground',
              compact ? 'text-[0.75rem]' : 'text-[0.78rem]',
            )}
            title={secondary}
          >
            {secondary}
          </span>
        )}
      </>
    )
  })()

  /*
   * The spoken form always names the ID as an ID.
   *
   * "cue.ball, James" is ambiguous read aloud; "CueVerse ID cue.ball, James" is not. Where no handle
   * exists that is said too, rather than leaving a listener to wonder which half they just heard.
   */
  const accessibleName = shape === 'both'
    ? `CueVerse ID ${primary}, ${secondary}`
    : shape === 'id-only'
      ? `CueVerse ID ${primary}`
      : shape === 'name-only'
        ? `${primary}, no CueVerse ID`
        : 'Unknown player'

  const inner = (
    <span className={cn('block min-w-0', compact && 'flex items-baseline gap-1.5')} aria-label={accessibleName}>
      {body}
    </span>
  )

  if (identity.slug) {
    return (
      <Link
        href={`/players/${encodeURIComponent(identity.slug)}`}
        className={cn(
          'block min-w-0 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
          className,
        )}
        title={identityText(identity)}
      >
        {inner}
      </Link>
    )
  }
  return <span className={cn('block min-w-0', className)}>{inner}</span>
}

/**
 * "Previously known as …" — historical aliases, shown in the expanded row rather than on the
 * primary row, where they would crowd out the identity they are context for.
 */
export function AliasLine({ aliases }: { aliases: string[] }) {
  if (!aliases.length) return null
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Previously known as</span>{' '}
      {aliases.join(', ')}
    </p>
  )
}
