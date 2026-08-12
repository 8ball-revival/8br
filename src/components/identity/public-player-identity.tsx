import Link from 'next/link'

import { formatIdentityLabel } from '@/lib/identity/public-identity'
import { cn } from '@/lib/utils'

/**
 * PublicPlayerIdentity — the ONE component for rendering a player's current public identity
 * as `Preferred Name (CueVerse ID)`. The whole label links to the public profile when a
 * `slug` is provided; otherwise it renders as plain text (e.g. an account-less manual
 * entrant, or before the public profile route exists for this player). Never renders email.
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
  /** Render the CueVerse ID portion in a muted tone. */
  muted?: boolean
}) {
  const id = (cueverseId || '').trim()
  const name = (preferredName || '').trim() || id || 'Unknown'
  // Show the "(CueVerse ID)" suffix only when a DISTINCT Preferred Name exists; otherwise the
  // name IS the CueVerse ID (fallback), so render it once.
  const showId = !!id && name.toLowerCase() !== id.toLowerCase()
  const inner = (
    <>
      <span className="font-medium">{name}</span>
      {showId && <span className={cn('ml-1', muted ? 'text-muted-foreground' : undefined)}>({id})</span>}
    </>
  )
  if (slug) {
    return (
      <Link href={`/players/${slug}`} className={cn('hover:text-brand transition-colors', className)} title={formatIdentityLabel(name, id)}>
        {inner}
      </Link>
    )
  }
  return <span className={className} title={formatIdentityLabel(name, id)}>{inner}</span>
}
