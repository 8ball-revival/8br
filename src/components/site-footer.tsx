import Link from 'next/link'
import { Wide } from '@/components/primitives'
import * as Icons from 'lucide-react'
import type { ComponentType } from 'react'
import { getFooter } from '@/lib/site-builder/globals'
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
  /*
    The published footer, with the built-in one as its floor.

    `getFooter` falls back when nothing is published or the document cannot be read, so this cannot
    produce a footer with nothing in it. Standalone pages an administrator has opted into the
    navigation are still appended, because those are a property of the page rather than of the footer
    configuration -- publishing an About page should put it here without an extra edit.
  */
  const published = await getFooter().catch(() => null)
  // Standalone pages an administrator has opted into the navigation. Read here rather than
  // hard-coded, so publishing an About page puts it in the footer without a code change. A database
  // that is unavailable costs the site a few links, never the footer.
  const pages = await navPages().catch(() => [])
  const configured = published?.columns.flatMap((c) => c.links) ?? []
  const links = [
    ...(configured.length ? configured : FOOTER_LINKS.filter(publishable)),
    ...pages.map((p) => ({ label: p.title, href: `/pages/${p.slug}` })),
  ]
  /*
    The icon is resolved from its NAME to a component here.

    The built-in list stores components; the published one stores lucide names, because a component
    cannot cross a serialisation boundary into a stored document. Passing the string straight through
    type-checked -- JSX accepts a string as an intrinsic tag -- and would have rendered <twitter />,
    an unknown element that draws nothing. Resolving it here keeps one shape for the renderer below.
  */
  const iconMap = Icons as unknown as Record<string, ComponentType<{ className?: string }>>
  const socials = published?.social.length
    ? published.social.map((s) => ({ label: s.label, href: s.href, icon: iconMap[s.icon] ?? Icons.Globe }))
    : SOCIAL.filter(publishable)
  const legal = published?.legal || 'All rights reserved.'

  return (
    <footer className="mt-16 border-t-2 border-nav-border bg-[var(--graphite)] text-foreground">
      <Wide name="footer" className="flex flex-col items-center gap-4 py-6 text-sm lg:flex-row lg:justify-between lg:gap-6">
        <p className="text-xs text-muted-foreground">
          © {year} {brandName}. {legal}
        </p>

        {links.length > 0 && (
          <nav aria-label="Footer" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            {links.map((l) => (
              <Link
                key={l.label}
                href={safeHref(l.href)}
                className="text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-[var(--cyan)]"
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
                  className="cyber-clip-sm flex size-8 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-[var(--cyan)]"
                >
                  <Icon className="size-4" aria-hidden />
                </Link>
              )
            })}
          </div>
        )}
      </Wide>
    </footer>
  )
}
