/** Public navigation — single source of truth for header, mobile nav, and footer. */
export type NavItem = {
  label: string
  href: string
  /** Shown instead of `label` in the mobile menu, when the published navigation sets one. */
  mobileLabel?: string
  /** Open in a new tab. The built-in entries never do; the published navigation may. */
  newTab?: boolean
  /** A short flash such as NEW. */
  badge?: string
  /** A lucide icon name. */
  icon?: string
  /** Nested items: a dropdown on desktop, indented in the mobile menu. */
  children?: NavItem[]
}

/**
 * Build the navigation for one request.
 *
 * ── Seasons and Tournaments are permanent top-level tabs ────────────────────────────────────────────────
 * They used to be Live and Archives: two dropdown triggers, each opening a Seasons/Tournaments pair, so
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
    { label: 'Tournaments', href: '/tournaments' },
  ]

  if (canCreate) entries.push({ label: 'Creator', href: '/creator' })
  entries.push({ label: 'Rankings', href: '/rankings' })
  /*
   * Yahoo is a destination rather than a filter on Seasons.
   *
   * The Yahoo era ended in 2014 and nothing will be added to it: it is read, not followed. Folding
   * it into Seasons would bury ten years and 48 finished seasons under whatever is running this
   * month, and it would invite the one mistake this whole section exists to prevent -- reading a
   * legacy rating as if it were a current one.
   */
  entries.push({ label: 'Yahoo', href: '/yahoo' })
  /*
   * Players, where Achievements used to be.
   *
   * Achievements is a page about awards — a fine destination, and a strange one to hold a top-level
   * tab while there was no way to browse the PEOPLE the whole site is about. A profile could only
   * be reached by finding somebody in a table first. The /achievements route is unchanged and is
   * still linked from the homepage strip; it simply no longer occupies the tab.
   */
  entries.push({ label: 'Players', href: '/players' })
  // The Break — the community. It is named on the tab rather than labelled "News", because it is no
  // longer only news: predictions, history, memes and discussion all live there.
  entries.push({ label: 'The Break', href: '/the-break' })
  entries.push(...adminItems)

  return entries
}

/** Legacy flat list, kept for the footer and anything that cannot render the full nav. */
export const PRIMARY_NAV: NavItem[] = [
  { label: 'Home', href: '/' },
  { label: 'Seasons', href: '/seasons' },
  { label: 'Tournaments', href: '/tournaments' },
  { label: 'Rankings', href: '/rankings' },
  { label: 'Yahoo', href: '/yahoo' },
  { label: 'Players', href: '/players' },
  { label: 'The Break', href: '/the-break' },
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
