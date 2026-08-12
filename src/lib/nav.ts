/** Public navigation — single source of truth for header, mobile nav, and footer.
 *  Final site architecture (some destinations are Coming Soon stubs for now). */
export type NavItem = { label: string; href: string }

export const PRIMARY_NAV: NavItem[] = [
  { label: 'Home', href: '/' },
  { label: 'Tournaments', href: '/tournaments' },
  { label: 'Rankings', href: '/rankings' },
  { label: 'Predictions', href: '/predictions' },
  { label: 'Rules', href: '/rules' },
]

/** Slim footer links. */
export const FOOTER_LINKS: NavItem[] = [
  { label: 'Contact', href: '/contact' },
  { label: 'Discord', href: '#' },
  { label: 'Privacy Policy', href: '/privacy' },
  { label: 'Terms of Service', href: '/terms' },
]
