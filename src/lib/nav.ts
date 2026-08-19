/** Public navigation — single source of truth for header, mobile nav, and footer. */
export type NavItem = { label: string; href: string }

/**
 * Menu items are DROPDOWN TRIGGERS, not destinations.
 *
 * Live and Archives each cover two different competition types with genuinely different listings,
 * and there is no useful combined page for either — a mixed list of a running Season and a finished
 * Tournament answers nobody's question. So the trigger opens a two-option panel and only the option
 * navigates.
 */
export interface NavMenu {
  label: string
  /** The two destinations. One is dropped when nothing of that type qualifies. */
  items: NavItem[]
  /** Shown with a restrained live indicator. */
  live?: boolean
}

export type NavEntry = NavItem | NavMenu

export const isMenu = (e: NavEntry): e is NavMenu => 'items' in e

export const LIVE_MENU: NavMenu = {
  label: 'Live',
  live: true,
  items: [
    { label: 'Seasons', href: '/live/seasons' },
    { label: 'Cups', href: '/live/cups' },
  ],
}

export const ARCHIVES_MENU: NavMenu = {
  label: 'Archives',
  items: [
    { label: 'Seasons', href: '/archives/seasons' },
    { label: 'Cups', href: '/archives/cups' },
  ],
}

/**
 * Build the navigation for one request.
 *
 * Live is CONDITIONAL and its contents are conditional: with only Seasons running the panel offers
 * only Seasons, at full width, rather than a half-width option beside a dead one. With nothing
 * running the item disappears entirely — an empty Live tab is worse than no Live tab, because it
 * promises something is happening.
 *
 * Creator and Admin are administrative. Hiding them here is presentation only: every Creator route
 * and every mutation enforces authorisation server-side regardless of what this returns.
 */
export function buildNav(opts: {
  live: { seasons: number; tournaments: number }
  canCreate?: boolean
  adminItems?: NavItem[]
}): NavEntry[] {
  const { live, canCreate = false, adminItems = [] } = opts

  const entries: NavEntry[] = [{ label: 'Home', href: '/' }]

  const liveItems = LIVE_MENU.items.filter((i) =>
    i.href === '/live/seasons' ? live.seasons > 0 : live.tournaments > 0)
  if (liveItems.length > 0) entries.push({ ...LIVE_MENU, items: liveItems })

  // Archives always offers both: a competition type with no completed entries yet still has an
  // archive, and the empty state explains that better than a missing menu item does.
  entries.push(ARCHIVES_MENU)

  if (canCreate) entries.push({ label: 'Creator', href: '/creator' })
  entries.push({ label: 'Rankings', href: '/rankings' })
  // The Break — the site's publishing section. Labelled "News" because that is what a visitor is
  // looking for; "The Break" is the section's name, used on the page.
  entries.push({ label: 'News', href: '/news' })
  entries.push(...adminItems)

  return entries
}

/** Legacy flat list, kept for the footer and anything that cannot render a menu. */
export const PRIMARY_NAV: NavItem[] = [
  { label: 'Home', href: '/' },
  { label: 'Archives', href: '/archives/seasons' },
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
