/** Public navigation. Single source of truth for header + footer + mobile nav.
 *  Season 2 launch: the primary nav centers the live competition (Groups,
 *  Playoffs, Seasons). Historical archive surfaces move to the footer. */
export type NavItem = { label: string; href: string }

export const PRIMARY_NAV: NavItem[] = [
  { label: 'Home', href: '/' },
  { label: 'Groups', href: '/groups' },
  { label: 'Playoffs', href: '/playoffs' },
  { label: 'Seasons', href: '/seasons' },
  { label: 'Rules', href: '/rules' },
]

/** Secondary links (historical archive, records) — footer only, not primary. */
export const SECONDARY_NAV: NavItem[] = [
  { label: 'Competitions', href: '/competitions' },
  { label: 'Rankings', href: '/rankings' },
  { label: 'Players', href: '/players' },
  { label: 'Hall of Fame', href: '/hall-of-fame' },
  { label: 'News', href: '/news' },
]
