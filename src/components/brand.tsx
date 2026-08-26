import Link from 'next/link'
import Image from 'next/image'

import { cn } from '@/lib/utils'
import { brandTagline } from '@/lib/site'
import { BRANDING_FALLBACK } from '@/lib/site-content/service'

/**
 * Site identity — the logo mark + the wordmark shown in the global header.
 *
 * The name, image and alt text are admin-managed (the `site-branding` Payload global, published
 * version only) and passed in by the caller; the props default to the built-in branding so this
 * still renders correctly before anything is published.
 *
 * The PRESENTATION is fixed: a 40px-high mark with `w-auto` so the aspect ratio is never
 * distorted, next/image serving a correctly-sized copy for HiDPI, and the wordmark at its set
 * size and weight. Admins change what it says and which image it uses — not how it looks.
 */
export function Logo({
  className,
  showTagline = false,
  href = '/',
  siteName = BRANDING_FALLBACK.siteName,
  logoUrl = BRANDING_FALLBACK.logoUrl,
  logoWidth = BRANDING_FALLBACK.logoWidth,
  logoHeight = BRANDING_FALLBACK.logoHeight,
  logoAlt = BRANDING_FALLBACK.logoAlt,
}: {
  className?: string
  showTagline?: boolean
  href?: string | null
  siteName?: string
  logoUrl?: string | null
  logoWidth?: number | null
  logoHeight?: number | null
  logoAlt?: string
}) {
  const mark = (
    <span className="flex items-center gap-2.5">
      {logoUrl ? (
        <Image
          src={logoUrl}
          // Empty alt keeps the logo decorative when the wordmark beside it already names the site,
          // so a screen reader announces the name once rather than twice.
          alt={logoAlt}
          width={logoWidth ?? 1536}
          height={logoHeight ?? 1024}
          priority
          sizes="60px"
          /*
        The glow is gone rather than retuned. It was a yellow drop-shadow, which existed to lift the
        mark off a dark bar; the bar is acid now, so the same shadow only softens the logo's edge
        against a background of its own colour. A dark ring gives it the separation instead.
      */
          className="h-10 w-auto shrink-0 object-contain"
        />
      ) : null}
      <span className="flex flex-col leading-none">
        <span className="font-display text-lg font-bold tracking-tight text-[var(--acid-ink)] sm:text-xl">{siteName}</span>
        {showTagline && (
          <span className="eyebrow mt-1 text-[0.6rem] text-[var(--acid-ink)]/65">{brandTagline}</span>
        )}
      </span>
    </span>
  )

  if (href === null) return <span className={cn('select-none', className)}>{mark}</span>

  return (
    <Link
      href={href}
      aria-label={siteName}
      className={cn('select-none transition-opacity hover:opacity-90', className)}
    >
      {mark}
    </Link>
  )
}
