import Link from 'next/link'
import Image from 'next/image'

import { cn } from '@/lib/utils'
import { brandName, brandTagline } from '@/lib/site'

/**
 * 8 Ball Revival logo: the 8BR shield emblem (dark-bg badge, works in both themes)
 * + the brand wordmark. `showTagline` adds the "Formerly known as 8BRCAM" eyebrow.
 * Emblem lives at public/logo/8br-emblem.png (cropped from the full logo).
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
        src="/logo/8br-emblem.png"
        alt=""
        width={400}
        height={438}
        unoptimized
        priority
        className="h-10 w-auto rounded-md ring-1 ring-brand/20"
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
