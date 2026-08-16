import Image from 'next/image'

import { cn } from '@/lib/utils'
import { competitionIconUrl, competitionInitials } from '@/lib/competitions/shared'

export interface CompetitionBadgeProps {
  name: string
  shortName: string
  iconMediaId?: string | null
  /** Rendered pixel size of the square badge. */
  size?: number
  /** Show the Competition name as visible text beside the badge. */
  showName?: boolean
  className?: string
}

/**
 * The Competition mark shown beside a Season: the uploaded icon when there is one, otherwise a
 * clean initials badge derived from the short name.
 *
 * Accessibility: the badge itself is decorative (`aria-hidden`) and the Competition name is carried
 * by a visually-hidden span plus a `title` tooltip — so the name is always available to screen
 * readers and on hover, whether or not an icon exists, without duplicating text when `showName`
 * puts it on screen.
 */
export function CompetitionBadge({
  name,
  shortName,
  iconMediaId,
  size = 20,
  showName = false,
  className,
}: CompetitionBadgeProps) {
  const url = competitionIconUrl(iconMediaId)
  const initials = competitionInitials(shortName, name)

  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5', className)} title={name}>
      {url ? (
        <Image
          src={url}
          alt=""
          aria-hidden
          width={size}
          height={size}
          className="shrink-0 rounded-[4px] object-contain"
          style={{ width: size, height: size }}
        />
      ) : (
        <span
          aria-hidden
          className="inline-flex shrink-0 items-center justify-center rounded-[4px] border border-border bg-secondary font-display font-bold leading-none text-muted-foreground"
          style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.42)) }}
        >
          {initials}
        </span>
      )}
      {showName ? (
        <span className="truncate text-xs font-medium text-muted-foreground">{name}</span>
      ) : (
        <span className="sr-only">{name}</span>
      )}
    </span>
  )
}
