/** Public navigation — single source of truth for header, mobile nav, and footer.
 *  Final site architecture (some destinations are Coming Soon stubs for now). */
export type NavItem = { label: string; href: string }

export const PRIMARY_NAV: NavItem[] = [
  { label: 'Home', href: '/' },
  { label: 'Seasons', href: '/seasons' },
  { label: 'Cups', href: '/cups' },
  { label: 'Rankings', href: '/rankings' },
  { label: 'Players', href: '/players' },
  { label: 'Records', href: '/records' },
  { label: 'Hall of Fame', href: '/hall-of-fame' },
  { label: 'Rules', href: '/rules' },
]

/** Slim footer links (some are Coming Soon stubs for now). */
export const FOOTER_LINKS: NavItem[] = [
  { label: 'About', href: '/about' },
  { label: 'Contact', href: '/contact' },
  { label: 'Discord', href: '#' },
  { label: 'Privacy Policy', href: '/privacy' },
  { label: 'Terms of Service', href: '/terms' },
]
