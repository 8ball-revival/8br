/** Public navigation — single source of truth for header, mobile nav, and footer.
 *  Final site architecture (some destinations are Coming Soon stubs for now). */
export type NavItem = { label: string; href: string }

export const PRIMARY_NAV: NavItem[] = [
  { label: 'Home', href: '/' },
  // Seasons are 8BR's premier competition — listed before Tournaments.
  { label: 'Seasons', href: '/seasons' },
  { label: 'Tournaments', href: '/tournaments' },
  { label: 'Ladder', href: '/rankings' },
  // Predictions: coming in a future release — hidden from nav until implemented.
  { label: 'Rules', href: '/rules' },
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
