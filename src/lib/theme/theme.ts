/**
 * Personal-theme model: the three theme choices, the semantic CSS-variable set each one produces, and
 * the accessible derivation of a full interface from just two source colors (Custom). Pure + isomorphic
 * (server SSR injection, client live preview, tsx tests all import this). No DOM, no server-only.
 *
 * Design rules baked in here:
 *  - WCC_DEFAULT emits NO overrides, so the committed black+crimson design renders byte-identical.
 *  - A theme changes COLORS ONLY. It never emits layout/spacing/typography values.
 *  - Status + winner/loser + rating-tier colors are intentionally NOT in the override set, so they fall
 *    back to the fixed :root tokens and stay WCC-controlled under every theme.
 *  - Custom derives all surfaces/text/borders/accent shades from Main + Accent, choosing foreground by
 *    contrast and nudging the accent to meet WCAG AA against the page. Never renders unreadable text.
 */
import {
  contrastRatio, darken, ensureContrast, isHex6, lighten, lightnessOf,
  mix, normalizeHex, readableText, relativeLuminance,
} from './color'

export const THEME_TYPES = ['WCC_DEFAULT', 'YAHOO_CLASSIC', 'CUSTOM'] as const
export type ThemeType = (typeof THEME_TYPES)[number]

export interface ThemePreference {
  type: ThemeType
  /** Custom only — canonical #rrggbb. Ignored/omitted for presets. */
  mainColor?: string | null
  accentColor?: string | null
}

/** The exact CSS custom-property names a theme may override (must mirror globals.css). */
export const THEME_VARS = [
  '--background', '--foreground', '--surface', '--card', '--card-foreground',
  '--popover', '--popover-foreground', '--muted', '--muted-foreground',
  '--secondary', '--secondary-foreground', '--accent', '--accent-foreground',
  '--border', '--input', '--nav-bg', '--nav-foreground', '--nav-border',
  '--primary', '--primary-foreground', '--primary-hover',
  '--brand', '--brand-hover', '--brand-soft', '--brand-dim', '--ring',
] as const

export type ThemeVars = Partial<Record<(typeof THEME_VARS)[number], string>>
export interface DerivedTheme { vars: ThemeVars; warnings: string[] }

// WCAG AA thresholds.
const AA_TEXT = 4.5
const AA_UI = 3

// ---- Custom defaults (shown in the editor before the user picks) ------------
export const CUSTOM_DEFAULT_MAIN = '#0d0d0d'
export const CUSTOM_DEFAULT_ACCENT = '#c8102e'

// ---- Yahoo Classic: a modern reading of the old Yahoo Pool palette ----------
// Cream page, white panels, olive nav, blue interactive accent (readable links/buttons), gold
// highlight. Color language only — no layout/logo/branding borrowed. All pairings checked ≥ AA.
const YAHOO: ThemeVars = {
  '--background': '#f3efe4', // pale cream
  '--foreground': '#232016', // dark readable text
  '--surface': '#ebe6d6',
  '--card': '#ffffff', // white raised panels
  '--card-foreground': '#232016',
  '--popover': '#ffffff',
  '--popover-foreground': '#232016',
  '--muted': '#e6e0cd',
  '--muted-foreground': '#5b5647', // ≥4.5 on cream
  '--secondary': '#e2dcc6',
  '--secondary-foreground': '#232016',
  '--accent': '#e0d9c1', // hover surface
  '--accent-foreground': '#232016',
  '--border': '#cbc4ab',
  '--input': '#cbc4ab',
  '--nav-bg': '#565a2c', // olive nav / supporting surface
  '--nav-foreground': '#f3efe4',
  '--nav-border': '#454826',
  '--primary': '#1d4ed8', // blue interactive accent (links, buttons, selected)
  '--primary-foreground': '#ffffff',
  '--primary-hover': '#2563eb',
  '--brand': '#1d4ed8',
  '--brand-hover': '#2563eb',
  '--brand-soft': '#c69a3a', // muted-gold highlight
  '--brand-dim': '#9c7726',
  '--ring': '#1d4ed8',
}

/**
 * Derive a full, accessible interface from Main (surfaces) + Accent (interactive emphasis).
 * Foreground is chosen by contrast; the accent is nudged to meet AA against the page background.
 */
export function deriveCustom(mainHex: string, accentHex: string): DerivedTheme {
  const warnings: string[] = []
  const main = normalizeHex(mainHex)
  const accent = normalizeHex(accentHex)
  if (!main || !accent) return { vars: {}, warnings: ['Invalid color — using WCC Default.'] }

  const dark = relativeLuminance(main) < 0.5
  const bg = dark ? main : (lightnessOf(main) > 0.95 ? darken(main, 0.05) : main) // leave room for whiter cards in light mode
  const fg = readableText(bg)
  if (contrastRatio(fg, bg) < AA_TEXT) warnings.push('The Main color is mid-toned, which limits text contrast. A lighter or darker Main reads better.')

  // Surfaces: raised panels move toward white in BOTH modes (reads as elevation); borders take a
  // contrasting line (lighter in dark mode, darker in light mode).
  const up = (k: number) => lighten(bg, k)
  const line = (k: number) => (dark ? lighten(bg, k) : darken(bg, k))
  const surface = up(0.03), card = up(0.07), muted = up(0.05), secondary = up(0.09), hover = up(0.11)

  // Accent → readable-on-background shade (works as link/text AND as a fill; text on it chosen by contrast).
  const rawContrast = contrastRatio(accent, bg)
  const acc = ensureContrast(accent, bg, AA_TEXT)
  if (!acc.met) warnings.push('The Accent color can’t reach AA contrast on this background; the closest readable shade is shown.')
  else if (rawContrast < AA_TEXT) warnings.push('The Accent color was darkened/lightened slightly so text and links stay legible.')
  if (contrastRatio(acc.color, bg) < AA_UI) warnings.push('Main and Accent are too similar to form a clear interface. Pick more contrasting colors.')
  const accentHover = dark ? lighten(acc.color, 0.1) : darken(acc.color, 0.08)

  const vars: ThemeVars = {
    '--background': bg,
    '--foreground': fg,
    '--surface': surface,
    '--card': card,
    '--card-foreground': readableText(card),
    '--popover': card,
    '--popover-foreground': readableText(card),
    '--muted': muted,
    '--muted-foreground': ensureContrast(mix(fg, bg, 0.42), bg, AA_TEXT).color,
    '--secondary': secondary,
    '--secondary-foreground': readableText(secondary),
    '--accent': hover,
    '--accent-foreground': readableText(hover),
    '--border': line(0.16),
    '--input': line(0.16),
    '--nav-bg': surface,
    '--nav-foreground': readableText(surface),
    '--nav-border': line(0.16),
    '--primary': acc.color,
    '--primary-foreground': readableText(acc.color),
    '--primary-hover': accentHover,
    '--brand': acc.color,
    '--brand-hover': accentHover,
    '--brand-soft': lighten(acc.color, 0.12),
    '--brand-dim': darken(acc.color, 0.16),
    '--ring': acc.color,
  }
  return { vars, warnings }
}

/** The CSS variables (and any warnings) for a stored preference. WCC_DEFAULT → no overrides. */
export function deriveTheme(pref: ThemePreference): DerivedTheme {
  switch (pref.type) {
    case 'YAHOO_CLASSIC':
      return { vars: YAHOO, warnings: [] }
    case 'CUSTOM':
      return deriveCustom(pref.mainColor ?? CUSTOM_DEFAULT_MAIN, pref.accentColor ?? CUSTOM_DEFAULT_ACCENT)
    case 'WCC_DEFAULT':
    default:
      return { vars: {}, warnings: [] }
  }
}

/** The value for the root `data-theme` attribute (drives any theme-scoped CSS + FOUC guard). */
export const dataThemeAttr = (type: ThemeType): string =>
  type === 'YAHOO_CLASSIC' ? 'yahoo' : type === 'CUSTOM' ? 'custom' : 'wcc'

/** Serialize theme vars into an inline `style` string for the root element (SSR, FOUC-safe). */
export function themeStyleString(vars: ThemeVars): string {
  return Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';')
}

// ---- Validation (shared by client + server; server is authoritative) --------
export interface ValidationResult { ok: boolean; pref?: ThemePreference; error?: string }

/**
 * Validate + normalize an untrusted theme payload. Rejects unknown theme names, malformed/out-of-range
 * colors, and anything that isn't a plain #rrggbb (no CSS expressions, urls, alpha, or markup can pass).
 */
export function validateThemePreference(input: unknown): ValidationResult {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Missing theme.' }
  const { type, mainColor, accentColor } = input as Record<string, unknown>
  if (typeof type !== 'string' || !THEME_TYPES.includes(type as ThemeType)) return { ok: false, error: 'Unknown theme.' }
  if (type !== 'CUSTOM') return { ok: true, pref: { type: type as ThemeType, mainColor: null, accentColor: null } }

  const main = typeof mainColor === 'string' ? normalizeHex(mainColor) : null
  const accent = typeof accentColor === 'string' ? normalizeHex(accentColor) : null
  if (!main) return { ok: false, error: 'Main color must be a hex value like #1a2b3c.' }
  if (!accent) return { ok: false, error: 'Accent color must be a hex value like #1a2b3c.' }
  return { ok: true, pref: { type: 'CUSTOM', mainColor: main, accentColor: accent } }
}

/** Guard for a raw RGB triple from the editor (each channel 0–255 integer). */
export const isValidRgb = (r: number, g: number, b: number): boolean =>
  [r, g, b].every((n) => Number.isInteger(n) && n >= 0 && n <= 255)

export { isHex6 }
