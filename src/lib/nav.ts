/** Public navigation — single source of truth for header, mobile nav, and footer. */
export type NavItem = { label: string; href: string }

/**
 * Build the navigation for one request.
 *
 * ── Seasons and Cups are permanent top-level tabs ────────────────────────────────────────────────
 * They used to be Live and Archives: two dropdown triggers, each opening a Seasons/Cups pair, so
 * reaching a Season meant knowing in advance whether it had finished. That is a distinction the site
 * cares about and the reader does not — they want the Seasons, and whether one is still running is
 * something the page should tell them, not something they should have to guess before clicking.
 *
 * So there is one destination per competition type, always present, and each page leads with what is
 * running and follows with what is finished.
 *
 * Creator and Admin are administrative. Hiding them here is presentation only: every Creator route
 * and every mutation enforces authorisation server-side regardless of what this returns.
 */
export function buildNav(opts: {
  canCreate?: boolean
  adminItems?: NavItem[]
}): NavItem[] {
  const { canCreate = false, adminItems = [] } = opts

  const entries: NavItem[] = [
    { label: 'Home', href: '/' },
    { label: 'Seasons', href: '/seasons' },
    { label: 'Cups', href: '/cups' },
  ]

  if (canCreate) entries.push({ label: 'Creator', href: '/creator' })
  entries.push({ label: 'Rankings', href: '/rankings' })
  // The Break — the site's publishing section. Labelled "News" because that is what a visitor is
  // looking for; "The Break" is the section's name, used on the page.
  entries.push({ label: 'News', href: '/news' })
  entries.push(...adminItems)

  return entries
}

/** Legacy flat list, kept for the footer and anything that cannot render the full nav. */
export const PRIMARY_NAV: NavItem[] = [
  { label: 'Home', href: '/' },
  { label: 'Seasons', href: '/seasons' },
  { label: 'Cups', href: '/cups' },
  { label: 'Rankings', href: '/rankings' },
  { label: 'News', href: '/news' },
]
/** Slim footer links. */
/**
 * Footer links. `active: false` means "not configured yet" — the footer HIDES those rather than
 * rendering a link that goes nowhere. Give one a real destination and flip the flag to publish it.
 */
export interface FooterLink extends NavItem {
  active?: boolean
}

export const FOOTER_LINKS: FooterLink[] = [
  // No /about route exists yet, so this stays hidden rather than 404ing.
  { label: 'About', href: '/about', active: false },
  { label: 'Contact', href: '/contact' },
  // Placeholder '#' — hidden until a real invite URL is set.
  { label: 'Discord', href: '#', active: false },
  { label: 'Privacy Policy', href: '/privacy' },
  { label: 'Terms of Service', href: '/terms' },
]
