import Link from 'next/link'

import { cn } from '@/lib/utils'
import { brandName, brandTagline, brandAbbreviation } from '@/lib/site'

/**
 * World Cue Championships identity — a simple text-based mark: a crimson "WCC"
 * monogram badge + the full wordmark. No image asset (intentionally lightweight
 * and easy for the new owner to restyle). `showTagline` adds the eyebrow tagline.
 */
export function Logo({
  className,
  showTagline = false,
  href = '/',
}: {
  className?: string
  showTagline?: boolean
  href?: string | null
}) {
  const mark = (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="grid size-10 shrink-0 place-items-center rounded-md bg-primary font-display text-sm font-bold tracking-tight text-primary-foreground"
      >
        {brandAbbreviation}
      </span>
      <span className="flex flex-col leading-none">
        <span className="font-display text-lg font-bold tracking-tight sm:text-xl">{brandName}</span>
        {showTagline && (
          <span className="eyebrow mt-1 text-[0.6rem] text-muted-foreground">{brandTagline}</span>
        )}
      </span>
    </span>
  )

  if (href === null) return <span className={cn('select-none', className)}>{mark}</span>

  return (
    <Link
      href={href}
      aria-label={brandName}
      className={cn('select-none transition-opacity hover:opacity-90', className)}
    >
      {mark}
    </Link>
  )
}
