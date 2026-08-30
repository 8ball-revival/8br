/**
 * The design tokens a published theme may set.
 *
 * ── Why this is a separate, dependency-free file ─────────────────────────────────────────────────
 * Three things need it and they sit on different sides of the client boundary: the theme MODULE
 * (server — it builds its fields from this), `getTheme` (server — it turns stored values into CSS
 * custom properties), and the contrast report in the inspector (browser — it needs the fallbacks to
 * check a token nobody overrode). Keeping it with the module would have dragged the whole module
 * registry, `next/image` and the competition services into the client bundle.
 *
 * `css` is the custom property the value is written to, and `fallback` is what the site uses when
 * the token is left empty — which is the normal case, since a theme usually changes two colours and
 * inherits the rest.
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

  /*
    ── The graphite-black roles ──────────────────────────────────────────────────────────────────

    Added when the homepage was rebuilt, because that design needs to name things the original ten
    could not: the grey that is neither text nor a line, the two extra surface steps, and the ink
    that goes on a filled button. A module that reached for `--hot-red` directly was a module no
    theme profile could move, which is exactly what these exist to prevent.

    Every one of them is optional, like the ten above -- a profile that sets an accent and nothing
    else still gets the built-in values for all of these.
  */
  { key: 'signal', css: '--signal', label: 'Signal (primary action)', group: 'Colour', fallback: '#ff2a2a' },
  { key: 'signalInk', css: '--signal-ink', label: 'Ink on the primary action', group: 'Colour', fallback: '#ffffff' },
  { key: 'steel', css: '--steel', label: 'Steel grey', group: 'Colour', fallback: '#6d7a83' },
  { key: 'steelBright', css: '--steel-bright', label: 'Steel grey, bright', group: 'Colour', fallback: '#98a4ac' },
  { key: 'plaque', css: '--surface-plaque', label: 'Plaque surface', group: 'Surface', fallback: '#171c21' },
  { key: 'inset', css: '--surface-inset', label: 'Inset surface', group: 'Surface', fallback: '#080b0d' },
  { key: 'navBg', css: '--nav-bg', label: 'Navigation surface', group: 'Surface', fallback: '#050607' },
  { key: 'navForeground', css: '--nav-foreground', label: 'Navigation text', group: 'Surface', fallback: '#f5f7f8' },
] as const
