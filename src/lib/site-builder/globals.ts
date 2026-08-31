import 'server-only'

/**
 * Reading the published navigation, footer, banner and theme.
 *
 * ── Why every one of these has a fallback ────────────────────────────────────────────────────────
 * These are read by the site SHELL, which renders on every page including the ones an administrator
 * would use to fix a mistake. So none of them may throw, none may return nothing useful, and all of
 * them fall back to the built-in configuration when the published document is missing, empty or
 * unreadable. Publishing an empty navigation removes the links; it cannot remove the header, and it
 * cannot take `/staff/site-builder` with it.
 *
 * ── Why the Owner's route back is added rather than stored ───────────────────────────────────────
 * `ensureRecoveryLinks` appends Admin and Site Builder for anyone who can reach them, whatever the
 * published navigation says. An Owner who publishes a navigation with no Admin link has not locked
 * themselves out — they have hidden it from everybody else. That behaviour is deliberate and is the
 * reason a broken publish is recoverable from the browser rather than from the database.
 */

import { getPublishedLayout } from './service'
import { validateConfig } from './fields'
import { getModule } from './registry'
import type { ModuleInstance } from './document'
import '@/components/site-builder/modules'

export const NAV_PAGE_KEY = 'nav'
export const FOOTER_PAGE_KEY = 'footer'
export const THEME_PAGE_KEY = 'theme'

/** Find the first module of a type in a published global page, already validated. */
async function readGlobal<T>(pageKey: string, moduleType: string): Promise<T | null> {
  try {
    const layout = await getPublishedLayout(pageKey)
    const found = layout.document.sections
      .flatMap((s) => s.modules)
      .find((m: ModuleInstance) => m.type === moduleType)
    if (!found) return null
    const def = getModule(moduleType)
    if (!def) return null
    // The stored config is validated on the way out as well as in. A global reaches every page, so
    // this is the one read where a stale or hand-edited value must not be able to propagate.
    return validateConfig(def.fields, found.config).value as T
  } catch (err) {
    console.error(`[site-builder] could not read the published "${pageKey}" global`, err)
    return null
  }
}

// ── Navigation ──────────────────────────────────────────────────────────────────────────────────

export interface NavLink {
  label: string
  mobileLabel: string
  href: string
  newTab: boolean
  icon: string
  badge: string
  audience: string
  device: string
  children: NavLink[]
}

export interface NavConfig {
  logoText: string
  logoMediaId: number | null
  logoHref: string
  density: string
  showSignIn: boolean
  items: NavLink[]
}

export interface RawNavItem {
  label: string
  mobileLabel: string
  destination: string
  customHref: string
  newTab: boolean
  icon: string
  badge: string
  audience: string
  device: string
  from: string
  until: string
  children?: RawNavItem[]
}

/**
 * Turn a stored item into a link, or drop it.
 *
 * The date window is applied HERE rather than in the browser: a link that is meant to appear next
 * month must not be in the markup this month, where anybody reading the source would find it.
 */
export function toLink(raw: RawNavItem, now: Date): NavLink | null {
  const from = raw.from ? Date.parse(raw.from) : NaN
  const until = raw.until ? Date.parse(raw.until) : NaN
  if (!Number.isNaN(from) && now.getTime() < from) return null
  if (!Number.isNaN(until) && now.getTime() > until) return null

  const href = raw.destination === 'custom' ? raw.customHref : raw.destination
  if (!href) return null

  return {
    label: raw.label,
    mobileLabel: raw.mobileLabel || raw.label,
    href,
    newTab: raw.newTab,
    icon: raw.icon,
    badge: raw.badge,
    audience: raw.audience,
    device: raw.device,
    children: (raw.children ?? []).map((c) => toLink(c, now)).filter((c): c is NavLink => c !== null),
  }
}

/** The built-in navigation, used when nothing is published or the document cannot be read. */
export function factoryNav(): NavConfig {
  return {
    logoText: '8 Ball Registry',
    logoMediaId: null,
    logoHref: '/',
    density: 'regular',
    showSignIn: true,
    items: [
      ['Home', '/'], ['Seasons', '/seasons'], ['Tournaments', '/tournaments'],
      ['Rankings', '/rankings'], ['Yahoo', '/yahoo'], ['Achievements', '/achievements'], ['The Break', '/the-break'],
    ].map(([label, href]) => ({
      label, mobileLabel: label, href, newTab: false, icon: '', badge: '',
      audience: 'everyone', device: 'both', children: [],
    })),
  }
}

export async function getNavigation(now: Date = new Date()): Promise<NavConfig> {
  const raw = await readGlobal<{
    logoText: string; logoMediaId: number | null; logoHref: string; density: string
    showSignIn: boolean; items: RawNavItem[]
  }>(NAV_PAGE_KEY, 'global.navigation')
  if (!raw) return factoryNav()

  const items = (raw.items ?? []).map((i) => toLink(i, now)).filter((i): i is NavLink => i !== null)
  // An empty published navigation is a legitimate choice — a one-page site — but an EMPTY read is
  // far more likely to be a mistake than a decision, so a document with no items at all falls back.
  if (!items.length) return { ...factoryNav(), logoText: raw.logoText || '8 Ball Registry' }

  return {
    logoText: raw.logoText,
    logoMediaId: raw.logoMediaId,
    logoHref: raw.logoHref || '/',
    density: raw.density,
    showSignIn: raw.showSignIn,
    items,
  }
}

/** Which links this viewer should actually see. */
export function visibleLinks(
  items: NavLink[],
  viewer: { signedIn: boolean; isStaff: boolean; isOwner: boolean },
  device: 'desktop' | 'mobile',
): NavLink[] {
  const allowed = (link: NavLink): boolean => {
    if (link.device === 'desktopOnly' && device !== 'desktop') return false
    if (link.device === 'mobileOnly' && device !== 'mobile') return false
    switch (link.audience) {
      case 'signedIn': return viewer.signedIn
      case 'signedOut': return !viewer.signedIn
      case 'staff': return viewer.isStaff
      case 'owner': return viewer.isOwner
      default: return true
    }
  }
  return items
    .filter(allowed)
    .map((link) => ({ ...link, children: link.children.filter(allowed) }))
}

/**
 * The routes an administrator must always be able to reach.
 *
 * Appended after the published navigation rather than stored in it, so removing them is not
 * something a publish can do. This is what makes a broken navigation recoverable from the browser.
 */
export function ensureRecoveryLinks(
  items: NavLink[],
  viewer: { isStaff: boolean; isOwner: boolean },
): NavLink[] {
  const out = [...items]
  const has = (href: string) => out.some((i) => i.href === href || i.children.some((c) => c.href === href))
  const add = (label: string, href: string) => out.push({
    label, mobileLabel: label, href, newTab: false, icon: '', badge: '',
    audience: 'everyone', device: 'both', children: [],
  })
  if (viewer.isStaff && !has('/staff')) add('Admin', '/staff')
  if (viewer.isOwner && !has('/staff/site-builder')) add('Site Builder', '/staff/site-builder')
  return out
}

// ── Footer ──────────────────────────────────────────────────────────────────────────────────────

export interface FooterConfig {
  legal: string
  tagline: string
  columns: { title: string; links: { label: string; href: string; newTab: boolean }[] }[]
  social: { icon: string; label: string; href: string }[]
}

export function factoryFooter(): FooterConfig {
  return {
    legal: 'All rights reserved.',
    tagline: '',
    columns: [{
      title: 'Site',
      links: [
        { label: 'Contact', href: '/contact', newTab: false },
        { label: 'Privacy Policy', href: '/privacy', newTab: false },
        { label: 'Terms of Service', href: '/terms', newTab: false },
      ],
    }],
    social: [],
  }
}

export async function getFooter(): Promise<FooterConfig> {
  const raw = await readGlobal<{
    legal: string; tagline: string
    columns: { title: string; links: { label: string; destination: string; customHref: string; newTab: boolean }[] }[]
    social: { icon: string; label: string; href: string }[]
  }>(FOOTER_PAGE_KEY, 'global.footer')
  if (!raw) return factoryFooter()
  const columns = (raw.columns ?? []).map((c) => ({
    title: c.title,
    links: (c.links ?? [])
      .map((l) => ({ label: l.label, href: l.destination === 'custom' ? l.customHref : l.destination, newTab: l.newTab }))
      .filter((l) => l.href),
  }))
  if (!columns.length) return { ...factoryFooter(), legal: raw.legal || factoryFooter().legal }
  return { legal: raw.legal, tagline: raw.tagline, columns, social: raw.social ?? [] }
}

// ── Banner ──────────────────────────────────────────────────────────────────────────────────────

export interface BannerConfig {
  enabled: boolean
  message: string
  linkLabel: string
  linkHref: string
  tone: string
}

export async function getBanner(): Promise<BannerConfig | null> {
  const raw = await readGlobal<BannerConfig>(NAV_PAGE_KEY, 'global.siteBanner')
  if (!raw?.enabled || !raw.message) return null
  return raw
}

// ── Theme ───────────────────────────────────────────────────────────────────────────────────────

export interface ThemeConfig {
  /** Custom-property declarations, ready to inline. Empty when nothing is overridden. */
  vars: Record<string, string>
  fontDisplay: string
}

export async function getTheme(): Promise<ThemeConfig> {
  const { THEME_TOKENS } = await import('@/components/site-builder/modules/shell')
  const { tokenVars } = await import('@/lib/theme/presets')
  const { TOKEN_BY_KEY } = await import('@/lib/theme/registry')
  const raw = await readGlobal<Record<string, unknown>>(THEME_PAGE_KEY, 'global.theme')
  if (!raw) return { vars: {}, fontDisplay: 'space-grotesk' }

  /*
    The palette, through the same validator the browser preview uses.

    `tokenVars` drops any key the registry does not declare and any value that is not a plain hex
    colour — so a config hand-edited in the database, or written by a version of this code that
    allowed something looser, cannot put an arbitrary declaration into a style block that reaches
    every visitor. It is applied on the way OUT as well as in, deliberately.
  */
  const vars: Record<string, string> = tokenVars(raw as Record<string, string>)

  /*
    And the keys an older theme used.

    The first version of this module had ten tokens with different names — `accent` for what is now
    `signal`, `foreground` for what is now `cleanWhite`. A site that published one of those has it
    stored under the old key, and the registry lookup above skips it. Rather than migrate the rows,
    the old names are read as aliases: nothing has to be rewritten, and a theme published a year ago
    keeps rendering exactly as it did. A new key always wins, so re-saving in Display Lab quietly
    completes the move.
  */
  for (const legacy of THEME_TOKENS) {
    const value = raw[legacy.key]
    if (typeof value !== 'string' || !value.trim()) continue
    if (!/^#[0-9a-f]{3,8}$/i.test(value.trim())) continue
    // Only when the new registry has not already spoken for that custom property.
    const claimed = [...TOKEN_BY_KEY.values()].some((t) => t.css === legacy.css && vars[t.css])
    if (!claimed) vars[legacy.css] = value.trim().toLowerCase()
  }
  const radius = Number(raw.radius)
  if (Number.isFinite(radius) && radius > 0) vars['--radius'] = `${radius}px`
  const border = Number(raw.borderWidth)
  if (Number.isFinite(border) && border > 1) vars['--border-width'] = `${border}px`
  const spacing = Number(raw.spacingScale)
  if (Number.isFinite(spacing) && spacing !== 100) vars['--sb-spacing-scale'] = String(spacing / 100)
  const width = Number(raw.containerWidth)
  if (Number.isFinite(width) && width !== 96) vars['--sb-container-width'] = `${width}rem`

  return { vars, fontDisplay: String(raw.fontDisplay ?? 'space-grotesk') }
}

/*
  Contrast lives in `./contrast`, not here.

  The theme inspector recalculates it as a colour is dragged, so it has to run in the browser — and
  this file is `server-only`. Re-exported so existing callers keep working.
*/
export { contrastRatio, contrastLevel, themeContrastPairs, type ContrastPair } from './contrast'
