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
] as const
