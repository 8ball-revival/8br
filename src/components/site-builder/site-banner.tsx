import Link from 'next/link'

import { cn } from '@/lib/utils'
import { isExternalUrl } from '@/lib/site-builder/urls'
import type { BannerConfig } from '@/lib/site-builder/globals'

/**
 * The site-wide banner, above the header.
 *
 * A server component with no state: it is either published and shown, or it is not there at all.
 * Making it dismissible would need client JavaScript on every page for something an administrator
 * schedules and unschedules anyway, and a notice the reader has dismissed is a notice the
 * administrator cannot tell was seen.
 */
const TONES = {
  accent: 'bg-[var(--hot-red)] text-white',
  gold: 'bg-[var(--gold)] text-black',
  teal: 'bg-[var(--brcam-teal)] text-black',
  graphite: 'bg-[var(--graphite)] text-foreground border-b border-[var(--line-strong)]',
} as const

export function SiteBanner({ banner }: { banner: BannerConfig }) {
  const external = banner.linkHref ? isExternalUrl(banner.linkHref) : false
  return (
    <aside
      aria-label="Site announcement"
      className={cn(
        'flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-center text-xs font-bold uppercase tracking-[0.12em]',
        TONES[banner.tone as keyof typeof TONES] ?? TONES.accent,
      )}
    >
      <span>{banner.message}</span>
      {banner.linkLabel && banner.linkHref && (
        external
          ? <a href={banner.linkHref} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{banner.linkLabel}</a>
          : <Link href={banner.linkHref} className="underline underline-offset-4">{banner.linkLabel}</Link>
      )}
    </aside>
  )
}
