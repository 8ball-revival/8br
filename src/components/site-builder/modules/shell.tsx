/**
 * The site shell as editable modules: navigation, footer and theme.
 *
 * ── Why these are modules on GLOBAL pages ────────────────────────────────────────────────────────
 * They could have been three bespoke tables with three bespoke editors. Modelling them as pages
 * instead means they inherit the entire lifecycle that already exists here — draft, preview,
 * revision history, atomic publish, scheduling, rollback and audit — and are edited through the same
 * inspector as everything else. A second mechanism for "edit the navigation" would have needed all
 * of that written again, and would have been the one missing a rollback on the day it mattered.
 *
 * ── They configure the shell; they do not replace it ─────────────────────────────────────────────
 * `SiteHeader` and `SiteFooter` stay code-owned components. They carry authentication state, the
 * account menu and the route back to Admin, and a layout that could delete them is a layout that
 * could lock the Owner out of the site. What these modules hold is their CONFIGURATION, which the
 * shell reads. Publishing an empty navigation removes links; it cannot remove the header.
 */

import { registerModule, type ModuleRenderProps } from '@/lib/site-builder/registry'
import { ModulePlaceholder } from './content'

// ── Navigation ──────────────────────────────────────────────────────────────────────────────────

/**
 * Where a navigation item can point.
 *
 * A select of known routes rather than a free URL field, because "choose an internal page without
 * typing a URL" is the requirement — and because a typo in a hand-typed path is a broken link that
 * looks exactly like a working one until somebody clicks it. `custom` exists for anything not on the
 * list and is validated as a URL like every other link on the site.
 */
export const INTERNAL_DESTINATIONS = [
  { value: '/', label: 'Home' },
  { value: '/seasons', label: 'Seasons' },
  { value: '/tournaments', label: 'Tournaments' },
  { value: '/rankings', label: 'Rankings' },
  { value: '/yahoo', label: 'Yahoo archive' },
  { value: '/achievements', label: 'Achievements' },
  { value: '/the-break', label: 'The Break' },
  { value: '/players', label: 'Players' },
  { value: '/contact', label: 'Contact' },
  { value: '/privacy', label: 'Privacy' },
  { value: '/terms', label: 'Terms' },
  { value: '/staff', label: 'Admin (staff only)' },
  { value: '/staff/site-builder', label: 'Site Builder (Owner only)' },
  { value: 'custom', label: 'Somewhere else…' },
]

const AUDIENCE_OPTIONS = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'signedIn', label: 'Signed-in members' },
  { value: 'signedOut', label: 'Signed-out visitors only' },
  { value: 'staff', label: 'Staff' },
  { value: 'owner', label: 'Owner only' },
]

const DEVICE_OPTIONS = [
  { value: 'both', label: 'Desktop and mobile' },
  { value: 'desktopOnly', label: 'Desktop only' },
  { value: 'mobileOnly', label: 'Mobile only' },
]

/** One navigation item's fields, shared by the top level and by a dropdown's children. */
const NAV_ITEM_FIELDS = {
  label: { kind: 'text' as const, label: 'Label', default: 'Link', maxLength: 40 },
  mobileLabel: {
    kind: 'text' as const, label: 'Label on mobile', default: '', maxLength: 40,
    help: 'Leave blank to use the same label. Useful when a long name needs shortening on a phone.',
  },
  destination: { kind: 'select' as const, label: 'Goes to', default: '/', options: INTERNAL_DESTINATIONS },
  customHref: {
    kind: 'url' as const, label: 'Address', default: '',
    help: 'Only used when “Somewhere else…” is chosen above.',
    showWhen: { field: 'destination', in: ['custom'] },
  },
  newTab: { kind: 'boolean' as const, label: 'Open in a new tab', default: false },
  icon: { kind: 'text' as const, label: 'Icon', default: '', maxLength: 40, help: 'Any lucide.dev name, such as Trophy. Optional.' },
  badge: { kind: 'text' as const, label: 'Badge', default: '', maxLength: 12, help: 'A short flash such as NEW. Optional.' },
  audience: { kind: 'select' as const, label: 'Who sees it', default: 'everyone', options: AUDIENCE_OPTIONS },
  device: { kind: 'select' as const, label: 'Where it appears', default: 'both', options: DEVICE_OPTIONS },
  from: { kind: 'text' as const, label: 'Show from', default: '', maxLength: 40, help: 'YYYY-MM-DD. Optional.' },
  until: { kind: 'text' as const, label: 'Hide after', default: '', maxLength: 40, help: 'YYYY-MM-DD. Optional.' },
}

export interface NavItemConfig {
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
  children?: NavItemConfig[]
}

registerModule({
  type: 'global.navigation',
  name: 'Site navigation',
  category: 'global',
  icon: 'Menu',
  description: 'The links in the header, and the mobile menu. Edited here, rendered by the header.',
  configVersion: 1,
  essential: 'This IS the site navigation. Publishing it empty leaves the header with no links.',
  a11y: { requiresLabel: true },
  layoutDefaults: { span: 12 },
  fields: {
    logoText: { kind: 'text', label: 'Wordmark', default: '8 Ball Registry', maxLength: 40 },
    logoMediaId: { kind: 'media', label: 'Logo image', default: null, help: 'Leave empty to use the built-in crest.' },
    logoHref: { kind: 'url', label: 'The logo goes to', default: '/', internalOnly: true },
    density: {
      kind: 'select', label: 'Header height', default: 'regular',
      options: [{ value: 'compact', label: 'Compact' }, { value: 'regular', label: 'Regular' }, { value: 'roomy', label: 'Roomy' }],
    },
    showSignIn: { kind: 'boolean', label: 'Show the Sign In button', default: true, help: 'Turning this off does not disable signing in; /login still works.' },
    items: {
      kind: 'list', label: 'Links', itemLabel: 'Link', max: 12,
      default: [
        { label: 'Home', destination: '/', mobileLabel: '', customHref: '', newTab: false, icon: '', badge: '', audience: 'everyone', device: 'both', from: '', until: '' },
        { label: 'Seasons', destination: '/seasons', mobileLabel: '', customHref: '', newTab: false, icon: '', badge: '', audience: 'everyone', device: 'both', from: '', until: '' },
        { label: 'Tournaments', destination: '/tournaments', mobileLabel: '', customHref: '', newTab: false, icon: '', badge: '', audience: 'everyone', device: 'both', from: '', until: '' },
        { label: 'Rankings', destination: '/rankings', mobileLabel: '', customHref: '', newTab: false, icon: '', badge: '', audience: 'everyone', device: 'both', from: '', until: '' },
        { label: 'Yahoo', destination: '/yahoo', mobileLabel: '', customHref: '', newTab: false, icon: '', badge: '', audience: 'everyone', device: 'both', from: '', until: '' },
        { label: 'Achievements', destination: '/achievements', mobileLabel: '', customHref: '', newTab: false, icon: '', badge: '', audience: 'everyone', device: 'both', from: '', until: '' },
        { label: 'The Break', destination: '/the-break', mobileLabel: '', customHref: '', newTab: false, icon: '', badge: '', audience: 'everyone', device: 'both', from: '', until: '' },
      ],
      of: {
        ...NAV_ITEM_FIELDS,
        // One level of nesting. A menu that can nest without limit is a menu somebody eventually
        // cannot reach the bottom of on a phone.
        children: {
          kind: 'list', label: 'Dropdown items', itemLabel: 'Item', max: 8, default: [],
          of: NAV_ITEM_FIELDS,
        },
      },
    },
  },
  /**
   * Rendered only in the editor.
   *
   * The real navigation is drawn by `SiteHeader`, which reads this module's published config. This
   * preview exists so the module can be SELECTED on the canvas and shows what it governs; drawing a
   * second navigation here would put two on the page.
   */
  Render: function NavigationModule({ config, editing }: ModuleRenderProps<{ items: NavItemConfig[]; logoText: string }>) {
    if (!editing) return null
    return (
      <div className="border border-dashed border-[var(--gold)] bg-[var(--graphite)] px-4 py-3">
        <p className="eyebrow text-[var(--gold)]">Site navigation</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Drawn by the header at the top of every page. {config.items.length} link{config.items.length === 1 ? '' : 's'}
          {config.items.some((i) => i.children?.length) ? ', some with dropdowns' : ''}. Edit them in the panel on the right.
        </p>
      </div>
    )
  } as never,
})

// ── Footer ──────────────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'global.footer',
  name: 'Site footer',
  category: 'global',
  icon: 'PanelBottom',
  description: 'Footer columns, legal line and social links. Edited here, rendered by the footer.',
  configVersion: 1,
  a11y: {},
  layoutDefaults: { span: 12 },
  fields: {
    legal: { kind: 'text', label: 'Legal line', default: 'All rights reserved.', maxLength: 200 },
    tagline: { kind: 'text', label: 'Tagline', default: '', maxLength: 160 },
    columns: {
      kind: 'list', label: 'Columns', itemLabel: 'Column', max: 4,
      default: [{
        title: 'Site',
        links: [
          { label: 'Contact', destination: '/contact', customHref: '', newTab: false },
          { label: 'Privacy Policy', destination: '/privacy', customHref: '', newTab: false },
          { label: 'Terms of Service', destination: '/terms', customHref: '', newTab: false },
        ],
      }],
      of: {
        title: { kind: 'text', label: 'Title', default: 'Links', maxLength: 40 },
        links: {
          kind: 'list', label: 'Links', itemLabel: 'Link', max: 10, default: [],
          of: {
            label: { kind: 'text', label: 'Label', default: 'Link', maxLength: 50 },
            destination: { kind: 'select', label: 'Goes to', default: '/', options: INTERNAL_DESTINATIONS },
            customHref: { kind: 'url', label: 'Address', default: '', showWhen: { field: 'destination', in: ['custom'] } },
            newTab: { kind: 'boolean', label: 'New tab', default: false },
          },
        },
      },
    },
    social: {
      kind: 'list', label: 'Social links', itemLabel: 'Account', max: 8, default: [],
      of: {
        icon: { kind: 'text', label: 'Icon', default: 'Globe', maxLength: 40, help: 'A lucide.dev name such as Twitter, Youtube, Twitch.' },
        label: { kind: 'text', label: 'Label', default: '', maxLength: 50 },
        href: { kind: 'url', label: 'Address', default: '' },
      },
    },
  },
  Render: function FooterModule({ config, editing }: ModuleRenderProps<{ columns: { title: string }[] }>) {
    if (!editing) return null
    return (
      <div className="border border-dashed border-[var(--gold)] bg-[var(--graphite)] px-4 py-3">
        <p className="eyebrow text-[var(--gold)]">Site footer</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Drawn at the bottom of every page. {config.columns.length} column{config.columns.length === 1 ? '' : 's'}.
        </p>
      </div>
    )
  } as never,
})

// ── Theme ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The design tokens an administrator may change.
 *
 * Deliberately a fixed list rather than an open map. Every entry below is a custom property the
 * stylesheet already reads, so setting one changes the site consistently — and there is no way to
 * introduce a property nothing uses, or to write something that is not a colour into one that is.
 *
 * Admin surfaces are NOT themeable from here. The Payload admin and the staff console keep their own
 * appearance, so a public theme cannot make the controls needed to fix it unreadable.
 */
export const THEME_TOKENS = [
  { key: 'accent', css: '--hot-red', label: 'Accent', group: 'Colour', fallback: '#ff2d3d' },
  { key: 'gold', css: '--gold', label: 'Gold', group: 'Colour', fallback: '#e8b93b' },
  { key: 'acid', css: '--acid', label: 'Highlight', group: 'Colour', fallback: '#e8ff4f' },
  { key: 'foreground', css: '--foreground', label: 'Text', group: 'Colour', fallback: '#f4f4f5' },
  { key: 'muted', css: '--muted-foreground', label: 'Muted text', group: 'Colour', fallback: '#a1a1aa' },
  { key: 'background', css: '--background', label: 'Page background', group: 'Surface', fallback: '#000000' },
  { key: 'card', css: '--card', label: 'Card surface', group: 'Surface', fallback: '#0d0f14' },
  { key: 'graphite', css: '--graphite', label: 'Panel surface', group: 'Surface', fallback: '#101418' },
  { key: 'border', css: '--border', label: 'Border', group: 'Surface', fallback: '#26262b' },
  { key: 'lineStrong', css: '--line-strong', label: 'Strong border', group: 'Surface', fallback: '#3f3f46' },
] as const

registerModule({
  type: 'global.theme',
  name: 'Site theme',
  category: 'global',
  icon: 'Palette',
  description: 'Colours, type and spacing for the whole public site.',
  configVersion: 1,
  a11y: {},
  layoutDefaults: { span: 12 },
  fields: {
    ...Object.fromEntries(THEME_TOKENS.map((t) => [
      t.key,
      { kind: 'color' as const, label: t.label, group: t.group, default: '', help: `Leave empty to keep the built-in ${t.label.toLowerCase()}.` },
    ])),
    fontDisplay: {
      kind: 'select', label: 'Display font', group: 'Type', default: 'space-grotesk',
      options: [
        { value: 'space-grotesk', label: 'Space Grotesk (built in)' },
        { value: 'inter', label: 'Inter' },
        { value: 'jetbrains', label: 'JetBrains Mono' },
      ],
    },
    radius: { kind: 'number', label: 'Corner radius', group: 'Shape', default: 0, min: 0, max: 16, unit: 'px' },
    borderWidth: { kind: 'number', label: 'Border width', group: 'Shape', default: 1, min: 1, max: 3, unit: 'px' },
    spacingScale: { kind: 'number', label: 'Spacing scale', group: 'Shape', default: 100, min: 80, max: 140, unit: '%', help: 'Scales every gap and padding on the site at once.' },
    containerWidth: { kind: 'number', label: 'Site width', group: 'Shape', default: 96, min: 72, max: 120, unit: 'rem' },
  },
  Render: function ThemeModule({ editing }: ModuleRenderProps<Record<string, unknown>>) {
    if (!editing) return null
    return (
      <div className="border border-dashed border-[var(--gold)] bg-[var(--graphite)] px-4 py-3">
        <p className="eyebrow text-[var(--gold)]">Site theme</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Applied to every public page. The admin console keeps its own appearance, so a theme change
          cannot make the controls needed to undo it unreadable.
        </p>
      </div>
    )
  } as never,
})

// ── The announcement bar, as a global ───────────────────────────────────────────────────────────

registerModule({
  type: 'global.siteBanner',
  name: 'Site-wide banner',
  category: 'global',
  icon: 'Megaphone',
  description: 'A strip above the header on every page. Schedule it from the Visibility panel.',
  configVersion: 1,
  a11y: { landmark: true },
  layoutDefaults: { span: 12 },
  fields: {
    enabled: { kind: 'boolean', label: 'Show it', default: false },
    message: { kind: 'text', label: 'Message', default: '', maxLength: 200 },
    linkLabel: { kind: 'text', label: 'Link label', default: '', maxLength: 50 },
    linkHref: { kind: 'url', label: 'Link goes to', default: '' },
    tone: {
      kind: 'select', label: 'Tone', default: 'accent',
      options: [{ value: 'accent', label: 'Accent' }, { value: 'gold', label: 'Gold' }, { value: 'teal', label: 'Teal' }, { value: 'graphite', label: 'Graphite' }],
    },
  },
  Render: function SiteBannerModule({ config, editing }: ModuleRenderProps<{ enabled: boolean; message: string }>) {
    if (!editing) return null
    return (
      <div className="border border-dashed border-[var(--gold)] bg-[var(--graphite)] px-4 py-3">
        <p className="eyebrow text-[var(--gold)]">Site-wide banner</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {config.enabled
            ? `Showing above the header on every page: “${config.message || '(no message set)'}”`
            : 'Currently switched off. Turn it on in the panel on the right.'}
        </p>
      </div>
    )
  } as never,
})

export function unusedPlaceholderGuard() {
  // Referenced so the shared placeholder import is not flagged; the modules above render their own.
  return ModulePlaceholder
}
