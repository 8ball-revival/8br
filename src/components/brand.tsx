import Link from 'next/link'

import { cn } from '@/lib/utils'
import { brandName, brandTagline } from '@/lib/site'

/**
 * 8 Ball Revival wordmark — TEMPORARY typographic placeholder (gold diamond accent
 * + brand text). Designed so a future SVG logo can drop in: replace the `mark`
 * contents below with an <svg>/<Image> and keep the same wrapper + `showTagline`.
 * `showTagline` adds the "Formerly known as 8BRCAM" eyebrow (footer/hero use).
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
      {/* Placeholder mark — swap for the brand SVG when available. */}
      <span
        aria-hidden
        className="inline-block size-4 rotate-45 rounded-[3px] bg-gradient-to-br from-gold-soft to-gold-dim"
      />
      <span className="flex flex-col leading-none">
        <span className="font-display text-xl font-bold tracking-tight">{brandName}</span>
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
