import Link from 'next/link'
import Image from 'next/image'

import { cn } from '@/lib/utils'
import { brandTagline } from '@/lib/site'
import { BRANDING_FALLBACK } from '@/lib/site-content/service'

/**
 * The header mark, as a file in this repository.
 *
 * It used to come from the admin-managed branding record, which pointed at an upload in Blob
 * storage. That made the one image every page shows depend on a database row and a remote object,
 * and it is how the header ended up serving artwork nobody had chosen in months: replacing it meant
 * a re-upload, and a re-upload under the same name is served from cache anyway.
 *
 * So the mark is a tracked asset, versioned by FILENAME. A new crest gets a new name, which is a
 * URL no browser and no CDN has ever seen, so nothing has to be purged and nothing can be stale.
 * The wordmark beside it is still admin-managed — the words are content, the mark is identity.
 */
const HEADER_MARK = {
  src: '/assets/branding/registry-crest-20260827.png',
  /** The artwork's real pixel dimensions, so next/image reserves the right box before it loads. */
  width: 1261,
  height: 1247,
} as const

/**
 * Site identity — the logo mark + the wordmark shown in the global header.
 *
 * The NAME and its alt text are admin-managed (the `site-branding` Payload global, published
 * version only) and passed in by the caller; they default to the built-in branding so this still
 * renders correctly before anything is published. The MARK is not: see HEADER_MARK above.
 *
 * The PRESENTATION is fixed: a 40px-high mark with `w-auto` so the aspect ratio is never
 * distorted, next/image serving a correctly-sized copy for HiDPI, and the wordmark at its set
 * size and weight. Admins change what it says — not the mark, and not how either one looks.
 */
export function Logo({
  className,
  showTagline = false,
  href = '/',
  siteName = BRANDING_FALLBACK.siteName,
  logoAlt = BRANDING_FALLBACK.logoAlt,
}: {
  className?: string
  showTagline?: boolean
  href?: string | null
  siteName?: string
  logoAlt?: string
}) {
  const mark = (
    <span className="flex items-center gap-2.5">
      {/*
        No glow. It was a yellow drop-shadow that existed to lift the mark off a dark bar; the bar is
        acid now, so the same shadow only softened the mark's edge against a background of its own
        colour. `w-auto` beside the fixed height is what keeps the crest's proportions its own, and
        object-contain means a future mark of a different shape still fits rather than crops.
      */}
      <Image
        src={HEADER_MARK.src}
        // Empty alt keeps the mark decorative when the wordmark beside it already names the site,
        // so a screen reader announces the name once rather than twice.
        alt={logoAlt}
        width={HEADER_MARK.width}
        height={HEADER_MARK.height}
        priority
        sizes="60px"
        className="h-10 w-auto shrink-0 object-contain"
      />
      <span className="flex flex-col leading-none">
        {/*
          font-black is font-weight 900, and `font-sans` is what lets it mean anything.

          The wordmark was set in the display face, whose variable weight axis stops at 700 — so
          asking for 900 got silently clamped and rendered pixel-for-pixel identically to the 700 it
          already was. `font-sans` is Inter, which is already loaded for body text (no extra
          download) and whose axis reaches 900, so the weight is real rather than requested.

          The size is untouched: this is weight, not scale.
        */}
        <span className="font-sans text-lg font-black tracking-tight text-[var(--nav-foreground)] sm:text-xl">{siteName}</span>
        {showTagline && (
          <span className="eyebrow mt-1 text-[0.6rem] text-[var(--nav-inactive)]">{brandTagline}</span>
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
