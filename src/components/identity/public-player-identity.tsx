import Link from 'next/link'

import { formatIdentityLabel } from '@/lib/identity/public-identity'
import { identityLines, NO_IDENTITY } from '@/lib/identity/display'
import { cn } from '@/lib/utils'

/**
 * PublicPlayerIdentity — the ONE component for rendering a player's current public identity on
 * ONE line, as `CueVerse ID (Preferred Name)`. The ID leads because it is the half that tells
 * competitors apart. The whole label links to the public profile when a `slug` is provided;
 * otherwise it renders as plain text (e.g. an account-less manual entrant, or before the public
 * profile route exists for this player). Never renders email.
 *
 * Use `PlayerName` instead where there is vertical room for two lines (tables, brackets, rosters).
 */
export function PublicPlayerIdentity({
  preferredName,
  cueverseId,
  slug,
  className,
  muted = false,
}: {
  preferredName: string
  cueverseId?: string | null
  slug?: string | null
  className?: string
  /** Render the trailing Preferred Name in a muted tone. */
  muted?: boolean
}) {
  const { primary, secondary } = identityLines({ cueverseId, preferredName })
  const inner = (
    <>
      <span className="font-medium">{primary === NO_IDENTITY ? 'Unknown' : primary}</span>
      {secondary && <span className={cn('ml-1', muted ? 'text-muted-foreground' : undefined)}>({secondary})</span>}
    </>
  )
  const full = formatIdentityLabel(preferredName, cueverseId)
  if (slug) {
    return (
      <Link href={`/players/${encodeURIComponent(slug)}`} className={cn('hover:text-brand transition-colors', className)} title={full}>
        {inner}
      </Link>
    )
  }
  return <span className={className} title={full}>{inner}</span>
}
