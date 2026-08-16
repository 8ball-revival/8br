import Link from 'next/link'
import Image from 'next/image'

import { cn } from '@/lib/utils'
import { brandName, brandTagline } from '@/lib/site'

/**
 * Site identity — the 8BR logo mark + the full wordmark.
 * The logo asset lives at public/assets/branding/8br-logo.png (1536x1024, 3:2).
 * Rendered at a fixed 40px height with `w-auto`, so the aspect ratio is never distorted;
 * next/image serves a correctly-sized, optimised copy so it stays sharp on HiDPI screens.
 * `showTagline` adds the eyebrow tagline.
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
      <Image
        src="/assets/branding/8br-logo.png"
        alt=""
        width={1536}
        height={1024}
        priority
        sizes="60px"
        className="h-10 w-auto shrink-0 object-contain"
      />
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
