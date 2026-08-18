import Link from 'next/link'
import { MessageCircle, AtSign, Video, Camera, type LucideIcon } from 'lucide-react'

import { FOOTER_LINKS } from '@/lib/nav'
import { isSafeLinkDestination, safeHref } from '@/lib/site-content/link'
import { brandName } from '@/lib/site'
import { navPages } from '@/lib/editorial/pages'

/**
 * Site footer: copyright, legal/navigation links, and social icons.
 *
 * Two rules govern what actually renders:
 *
 *  1. A link marked `active: false` — or one whose destination is still a placeholder — is HIDDEN,
 *     not rendered as a dead link. An empty group disappears entirely rather than leaving a bare
 *     heading or a row of icons that go nowhere.
 *  2. Destinations are validated with the same allowlist the admin-managed hero buttons use
 *     (`isSafeLinkDestination`): internal paths, #fragments, ?queries and absolute http(s) only.
 *     `javascript:`, `data:`, protocol-relative URLs and the rest are rejected. `safeHref` is
 *     applied again at render time, so even a value that slipped past configuration cannot emit a
 *     live hostile href.
 *
 * The year is computed per render, so the copyright never goes stale.
 */

interface SocialLink {
  label: string
  href: string
  icon: LucideIcon
  /** False until a real profile URL is configured — hidden rather than linking to '#'. */
  active?: boolean
}

// lucide dropped brand logos, so these are generic stand-ins. Each stays hidden until a real URL
// is set; flip `active` and supply the href to publish one.
const SOCIAL: SocialLink[] = [
  { label: 'Discord', href: '#', icon: MessageCircle, active: false },
  { label: 'X', href: '#', icon: AtSign, active: false },
  { label: 'YouTube', href: '#', icon: Video, active: false },
  { label: 'Instagram', href: '#', icon: Camera, active: false },
]

/** A link is shown only when it is switched on AND its destination passes validation. */
const publishable = <T extends { href: string; active?: boolean }>(l: T): boolean =>
  l.active !== false && l.href.trim() !== '#' && isSafeLinkDestination(l.href)

export async function SiteFooter() {
  const year = new Date().getFullYear()
  // Standalone pages an administrator has opted into the navigation. Read here rather than
  // hard-coded, so publishing an About page puts it in the footer without a code change. A database
  // that is unavailable costs the site a few links, never the footer.
  const pages = await navPages().catch(() => [])
  const links = [
    ...FOOTER_LINKS.filter(publishable),
    ...pages.map((p) => ({ label: p.title, href: `/pages/${p.slug}` })),
  ]
  const socials = SOCIAL.filter(publishable)

  return (
    <footer className="mt-16 border-t border-nav-border bg-nav-bg/40">
      <div className="mx-auto flex w-full max-w-[96rem] flex-col items-center gap-4 px-4 py-6 text-sm sm:px-6 lg:flex-row lg:justify-between lg:gap-6 lg:px-8">
        <p className="text-xs text-muted-foreground">
          © {year} {brandName}. All rights reserved.
        </p>

        {links.length > 0 && (
          <nav aria-label="Footer" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            {links.map((l) => (
              <Link
                key={l.label}
                href={safeHref(l.href)}
                className="text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        )}

        {socials.length > 0 && (
          <div className="flex items-center gap-1">
            {socials.map((s) => {
              const Icon = s.icon
              return (
                <Link
                  key={s.label}
                  href={safeHref(s.href)}
                  aria-label={s.label}
                  className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Icon className="size-4" aria-hidden />
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </footer>
  )
}
