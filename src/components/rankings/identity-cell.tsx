'use client'

import Link from 'next/link'

import { cn } from '@/lib/utils'

/**
 * How a player is named on every Rankings surface.
 *
 * Two lines, no brackets: the preferred name leads in bold gold, the CueVerse ID sits beneath it in
 * white. Both belong to ONE canonical Player record — the ID is a current field on that record, not
 * a separate account — which is why updating a CueVerse ID changes every season, tournament, match
 * and export at once without any historical row being rewritten.
 *
 * ── The fallbacks, and why each one ──────────────────────────────────────────────────────────────
 *  - both present and different  → two lines.
 *  - both present but the same after normalisation → one line. Printing "Starkiller" twice, once in
 *    gold and once in white, looks like a rendering fault rather than an identity.
 *  - only a CueVerse ID → one line, WHITE. Keeping the ID's colour rather than promoting it to gold
 *    means the colour still tells you which half you are reading.
 *  - only a preferred name → one line, GOLD, for the same reason.
 *  - neither → an em dash, so a row can never render as an empty cell.
 *
 * A long ID truncates with an ellipsis and carries its full value on the element, reachable by
 * hover and by keyboard focus. `title` is deliberate: it is the one tooltip mechanism that works
 * for a mouse, a screen reader and a focused element without a custom popup and its focus trap.
 */

export interface Identity {
  preferredName: string
  cueverseId: string | null
  /** Profile slug. When present the whole cell is a link to the player's profile. */
  slug?: string | null
}

const norm = (v: string) => v.trim().toLowerCase()

export type IdentityShape = 'both' | 'name-only' | 'id-only' | 'none'

/** Which of the four shapes this identity is. Exported so the rules can be tested directly. */
export function identityShape(id: Identity): IdentityShape {
  const name = id.preferredName?.trim() ?? ''
  const cue = id.cueverseId?.trim() ?? ''
  if (!name && !cue) return 'none'
  if (name && cue && norm(name) !== norm(cue)) return 'both'
  if (name) return 'name-only'
  return 'id-only'
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
  const name = identity.preferredName?.trim() ?? ''
  const cue = identity.cueverseId?.trim() ?? ''

  const body = (() => {
    if (shape === 'none') {
      return <span className="text-muted-foreground">—</span>
    }
    if (shape === 'name-only') {
      return <span className="block truncate font-semibold text-[var(--gold)]" title={name}>{name}</span>
    }
    if (shape === 'id-only') {
      return <span className="block truncate text-foreground" title={cue}>{cue}</span>
    }
    return (
      <>
        <span className="block truncate font-semibold leading-tight text-[var(--gold)]" title={name}>
          {name}
        </span>
        <span
          className={cn(
            'block truncate leading-tight text-foreground',
            compact ? 'text-[0.75rem]' : 'text-[0.78rem]',
          )}
          // The full value, for the ellipsis case. Reachable by pointer and by focus.
          title={cue}
          tabIndex={0}
        >
          {cue}
        </span>
      </>
    )
  })()

  const accessibleName = shape === 'both' ? `${name}, CueVerse ID ${cue}`
    : shape === 'name-only' ? name
      : shape === 'id-only' ? `CueVerse ID ${cue}`
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
          'block min-w-0 rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60',
          className,
        )}
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
