/**
 * A player's own colours for their own profile.
 *
 * ── Scoping, and why it is not optional ─────────────────────────────────────────────────────────
 * Every value here is emitted as a CSS custom property on the profile's root element and nowhere
 * else. The profile's styles read `var(--pf-accent)` and friends, so one player's choices reach
 * exactly one subtree: they cannot restyle the header, the footer, another profile, or the rest of
 * the site. Nothing is written to a global stylesheet and no `<style>` tag is generated.
 *
 * ── Why only hex ────────────────────────────────────────────────────────────────────────────────
 * A colour typed by a player ends up inside a `style` attribute. CSS is a language, and the values
 * it accepts include `url(...)`, `var(...)` and functions that can reference other properties — so
 * "is this a colour" has to be answered strictly rather than by trusting the browser to ignore what
 * it cannot parse. A three- or six-digit hex is unambiguous, covers everything a colour picker
 * produces, and cannot express anything but a colour. Anything else is refused.
 *
 * ── Contrast is checked, not hoped for ──────────────────────────────────────────────────────────
 * A player is free to make an unusual profile; they are not free to make an unreadable one, because
 * the profile is a public record other people come to read. Text is required to clear WCAG AA
 * against the surface it sits on, and the accent to clear a lower bar suitable for large figures.
 * The check runs on the server, so it cannot be skipped by posting straight to the action.
 */

export interface ProfileTheme {
  /** Headline accent: active tab, key numbers, links, focus rings. */
  accent: string
  /** Supporting accent: secondary emphasis and the subtle frame details. */
  accentSecondary: string
  /** The profile's own background, beneath everything inside the frame. */
  surface: string
  /** The surface of each information rectangle. */
  panelSurface: string
  /** Section borders, and the tint laid over the neutral pool-table rails. */
  border: string
  /** Body text. */
  textPrimary: string
  /** Labels and secondary text. */
  textMuted: string
}

export const THEME_KEYS = [
  'accent', 'accentSecondary', 'surface', 'panelSurface', 'border', 'textPrimary', 'textMuted',
] as const
export type ThemeKey = (typeof THEME_KEYS)[number]

/**
 * What every profile looks like until its owner decides otherwise.
 *
 * The site's own palette rather than a colour invented for this page: `--hot-red` is the accent the
 * header, the rules and the brand marks already use, and `--void` / `--graphite` are the two dark
 * surfaces everything else on the site sits on. A profile therefore looks like part of 8 Ball
 * Registry before anybody customises it, and a player choosing their own colours is departing from
 * the house style rather than replacing an unrelated one.
 *
 * Kept as literal hex rather than `var(--hot-red)`: these values are validated, stored per player
 * and compared for contrast, and a CSS reference is none of those things.
 */
export const DEFAULT_THEME: ProfileTheme = {
  accent: '#ff2a2a',          // --hot-red
  accentSecondary: '#c21f1f', // --hot-red-dim
  surface: '#050607',         // --void
  /*
    The tiles sit only a hair above the page, not a step above it.

    `--graphite` (#0b0f12) made each rectangle read as a raised card; the approved design wants them
    to look cut into one dark surface, with the border doing the separating rather than a change in
    brightness.
  */
  panelSurface: '#07080a',
  border: '#232b31',          // --line
  textPrimary: '#f2f5f7',
  textMuted: '#8b97a1',
}

/**
 * Ready-made themes, for players who want a different profile without picking seven colours.
 *
 * ── Why whole themes rather than accents ────────────────────────────────────────────────────────
 * An accent alone does not make a coherent profile: a violet highlight over the red-black surfaces
 * looks like a mistake rather than a choice. Each preset therefore sets all seven tokens, with the
 * surfaces and the muted text nudged toward the accent's hue so the whole thing reads as one
 * decision.
 *
 * ── They obey the same rules as anything typed by hand ──────────────────────────────────────────
 * Every one of these is run through `validateTheme` by the test suite, and applying one simply fills
 * the editor's fields — Save takes the identical server-side path, contrast check included. A preset
 * is a shortcut, not a way around the rules.
 *
 * Deliberately a short list. Twenty swatches is a paint chart; these are six alternatives and the
 * house colours, which is enough to feel like a choice without becoming a task.
 */
export interface ThemePreset {
  id: string
  name: string
  theme: ProfileTheme
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'house-red',
    name: 'House Red',
    // The site's own palette, offered here too so the default is one click away like the rest.
    theme: DEFAULT_THEME,
  },
  {
    id: 'cue-blue',
    name: 'Cue Blue',
    theme: {
      accent: '#3b82f6', accentSecondary: '#60a5fa',
      surface: '#04070d', panelSurface: '#070b14', border: '#1e2a3f',
      textPrimary: '#eaf1fb', textMuted: '#8ba0bd',
    },
  },
  {
    id: 'chalk-cyan',
    name: 'Chalk Cyan',
    theme: {
      accent: '#22d3ee', accentSecondary: '#38bdf8',
      surface: '#04090c', panelSurface: '#070d12', border: '#1b2b33',
      textPrimary: '#e6f4f8', textMuted: '#87a3ad',
    },
  },
  {
    id: 'trophy-gold',
    name: 'Trophy Gold',
    theme: {
      accent: '#e0a92b', accentSecondary: '#f3d488',
      surface: '#080603', panelSurface: '#0b0904', border: '#2e2717',
      textPrimary: '#f7f2e6', textMuted: '#a89b7d',
    },
  },
  {
    id: 'neon-violet',
    name: 'Neon Violet',
    theme: {
      accent: '#a855f7', accentSecondary: '#c084fc',
      surface: '#08050d', panelSurface: '#0c0814', border: '#2c2140',
      textPrimary: '#f1eafb', textMuted: '#9c8db5',
    },
  },
  {
    id: 'table-emerald',
    name: 'Table Emerald',
    theme: {
      accent: '#2ee08a', accentSecondary: '#6ee7b7',
      surface: '#030806', panelSurface: '#060d0a', border: '#1a3029',
      textPrimary: '#e8f7f0', textMuted: '#87a89a',
    },
  },
  {
    id: 'ash-mono',
    name: 'Ash Mono',
    // No hue at all, for a profile that wants the figures to be the only colour on the page.
    theme: {
      accent: '#cbd5e1', accentSecondary: '#94a3b8',
      surface: '#060708', panelSurface: '#0a0c0e', border: '#262b31',
      textPrimary: '#f1f5f9', textMuted: '#8d959e',
    },
  },
]

/** Which preset a theme is, if it is exactly one of them. Used to mark the active swatch. */
export function matchPreset(theme: ProfileTheme): string | null {
  const same = (a: ProfileTheme, b: ProfileTheme) => THEME_KEYS.every((k) => a[k] === b[k])
  return THEME_PRESETS.find((p) => same(p.theme, theme))?.id ?? null
}

/** Human labels and one line of purpose each, for the editor. */
export const THEME_FIELDS: { key: ThemeKey; label: string; hint: string }[] = [
  { key: 'accent', label: 'Primary accent', hint: 'Active tab, key numbers, links and focus rings.' },
  { key: 'accentSecondary', label: 'Secondary accent', hint: 'Supporting emphasis and subtle frame details.' },
  { key: 'surface', label: 'Profile background', hint: 'The surface beneath the whole profile.' },
  { key: 'panelSurface', label: 'Section background', hint: 'The surface of each information rectangle.' },
  { key: 'border', label: 'Borders and rails', hint: 'Section borders and the tint over the table rails.' },
  { key: 'textPrimary', label: 'Primary text', hint: 'Headings, figures and body text.' },
  { key: 'textMuted', label: 'Muted text', hint: 'Labels and secondary text.' },
]

// ── Parsing ───────────────────────────────────────────────────────────────────────────────────

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/** A colour, or null. Deliberately narrow — see the note at the top of the file. */
export function parseHex(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const value = input.trim().toLowerCase()
  if (!HEX.test(value)) return null
  // Normalised to six digits so stored values are comparable and predictable.
  if (value.length === 4) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
  }
  return value
}

function channels(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

/** Relative luminance, per WCAG 2.1. */
export function luminance(hex: string): number {
  const srgb = channels(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2]
}

/** Contrast ratio between two colours, 1 (identical) to 21 (black on white). */
export function contrast(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

export interface ThemeValidation {
  ok: boolean
  theme?: ProfileTheme
  /** Per-field messages, so the editor can point at the offending swatch. */
  errors: Partial<Record<ThemeKey, string>>
}

/*
  The thresholds.

  4.5:1 is WCAG AA for body text, which is what `textPrimary` is. `textMuted` carries labels that are
  small but not essential to comprehension on their own, and 3:1 is the AA large-text bar — set here
  deliberately rather than waived, so a muted colour can be quiet without becoming invisible. The
  accent is held to 3:1 because it is used for large figures and for borders, not for paragraphs.
*/
const MIN_TEXT_CONTRAST = 4.5
const MIN_MUTED_CONTRAST = 3
const MIN_ACCENT_CONTRAST = 3

/**
 * Validate a submitted theme.
 *
 * Runs server-side on every save. Returns the normalised theme or the reasons it was refused —
 * never a partially applied one, because half a theme is a profile with unreadable patches.
 */
export function validateTheme(input: Partial<Record<ThemeKey, unknown>>): ThemeValidation {
  const errors: Partial<Record<ThemeKey, string>> = {}
  const parsed = {} as ProfileTheme

  for (const key of THEME_KEYS) {
    const hex = parseHex(input[key])
    if (!hex) {
      errors[key] = 'Enter a colour as a hex value, for example #ff2a2a.'
      continue
    }
    parsed[key] = hex
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }

  // Readability, against the surface each colour actually sits on.
  if (contrast(parsed.textPrimary, parsed.panelSurface) < MIN_TEXT_CONTRAST) {
    errors.textPrimary = 'Primary text is too close to the section background to read comfortably.'
  }
  if (contrast(parsed.textMuted, parsed.panelSurface) < MIN_MUTED_CONTRAST) {
    errors.textMuted = 'Muted text is too close to the section background to read.'
  }
  if (contrast(parsed.accent, parsed.panelSurface) < MIN_ACCENT_CONTRAST) {
    errors.accent = 'The primary accent does not stand out against the section background.'
  }
  /*
    The profile background matters too: the identity header and the frame sit directly on it, so a
    surface that matches the panels would erase every section boundary at once.
  */
  if (contrast(parsed.textPrimary, parsed.surface) < MIN_TEXT_CONTRAST) {
    errors.surface = 'Primary text is unreadable against the profile background.'
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, theme: parsed, errors: {} }
}

// ── Emission ──────────────────────────────────────────────────────────────────────────────────

/**
 * The theme as CSS custom properties, for the profile root's `style` attribute.
 *
 * Every value has been through `parseHex`, so what reaches the attribute is a six-digit hex and
 * nothing else. The `--pf-` prefix keeps these from colliding with the site's own tokens even
 * though they are scoped anyway.
 */
export function themeVars(theme: ProfileTheme): Record<string, string> {
  return {
    '--pf-accent': theme.accent,
    '--pf-accent-2': theme.accentSecondary,
    '--pf-surface': theme.surface,
    '--pf-panel': theme.panelSurface,
    '--pf-border': theme.border,
    '--pf-text': theme.textPrimary,
    '--pf-muted': theme.textMuted,
    /*
      Derived, so a caller never has to compose a colour by hand:
      · `-soft` is the accent at low opacity, for hovers and fills;
      · `-rail` tints the neutral pool-table media, which ships grey so one set of files serves
        every theme rather than one render per player.
    */
    '--pf-accent-soft': `${theme.accent}22`,
    '--pf-accent-line': `${theme.accent}55`,
    '--pf-rail-tint': `${theme.border}cc`,
    '--pf-panel-edge': `${theme.border}`,
  }
}

/** The default, as vars — used wherever a profile has no stored theme. */
export const DEFAULT_THEME_VARS = themeVars(DEFAULT_THEME)

/** A stored row, coerced back to a theme. Anything unreadable falls back to the default value. */
export function themeFromRow(row: Partial<Record<ThemeKey, string | null>> | null | undefined): ProfileTheme {
  if (!row) return DEFAULT_THEME
  const out = { ...DEFAULT_THEME }
  for (const key of THEME_KEYS) {
    const hex = parseHex(row[key])
    if (hex) out[key] = hex
  }
  return out
}
