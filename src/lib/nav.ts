/** Public navigation — single source of truth for header, mobile nav, and footer.
 *  Final site architecture (some destinations are Coming Soon stubs for now). */
export type NavItem = { label: string; href: string }

export const PRIMARY_NAV: NavItem[] = [
  { label: 'Home', href: '/' },
  { label: 'Groups', href: '/groups' },
  { label: 'Playoffs', href: '/playoffs' },
  { label: 'Seasons', href: '/seasons' },
  { label: 'Cups', href: '/cups' },
  { label: 'Rankings', href: '/rankings' },
  { label: 'Predictions', href: '/predictions' },
  { label: 'Rules', href: '/rules' },
]

// Hall of Fame is intentionally NOT in the primary nav (replaced by Predictions),
// but its route, data, and services remain intact and reachable at /hall-of-fame.

/** Slim footer links (some are Coming Soon stubs for now). */
export const FOOTER_LINKS: NavItem[] = [
  { label: 'About', href: '/about' },
  { label: 'Contact', href: '/contact' },
  { label: 'Discord', href: '#' },
  { label: 'Privacy Policy', href: '/privacy' },
  { label: 'Terms of Service', href: '/terms' },
]
