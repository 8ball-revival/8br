import { THEME_TOKEN_REGISTRY, TOKEN_BY_KEY, WRITABLE_CSS_VARS } from './registry'

/**
 * Starting points, not stylesheets.
 *
 * Every preset is a set of values for the SAME tokens. There is no second code path, no alternate
 * stylesheet and nothing a preset can reach that an Owner cannot then edit — which is the property
 * that stops "themes" becoming five hardcoded designs that drift apart.
 *
 * A preset sets only what it means to change. Everything it leaves out inherits the built-in value,
 * so adding a token later does not silently break every preset written before it.
 */
export interface ThemePreset {
  id: string
  name: string
  blurb: string
  values: Record<string, string>
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'graphite-signal',
    name: 'Graphite Black + Signal Red',
    blurb: 'The approved default. Near-black grounds, warm-white type, steel supporting text, red used sparingly.',
    values: {},
  },
  {
    id: 'void-warm',
    name: 'Void Black + Warm White',
    blurb: 'Quieter still: true black, no accent on the navigation, and the red reserved for actions alone.',
    values: {
      void: '#000000',
      graphite: '#08090b',
      graphiteRaised: '#111316',
      plaque: '#141719',
      inset: '#000000',
      hover: '#1a1d21',
      cleanWhite: '#faf8f5',
      mutedText: '#a8a49c',
      steel: '#8b8880',
      steelBright: '#b0aca4',
      navActive: '#faf8f5',
      navBorder: '#2a2d31',
      line: '#1e2124',
      lineStrong: '#33373c',
      steelDim: '#4a4e53',
    },
  },
  {
    id: 'warm-light',
    name: 'Warm White + Black + Red',
    blurb: 'The composition inverted: a warm paper ground with black type. The one preset where the page is light.',
    values: {
      void: '#f5f2ec',
      graphite: '#ffffff',
      graphiteRaised: '#efece5',
      plaque: '#e9e5dc',
      inset: '#e4e0d6',
      hover: '#e4e0d6',
      cleanWhite: '#121316',
      mutedText: '#4a4d52',
      steel: '#5c6066',
      steelBright: '#43464b',
      textOnMedia: '#ffffff',
      navBg: '#121316',
      navForeground: '#f5f2ec',
      navInactive: '#a8a49c',
      line: '#d6d1c6',
      lineStrong: '#b8b2a4',
      steelDim: '#9b958a',
      acid: '#121316',
      acidInk: '#f5f2ec',
      playerName: '#0b6b78',
      info: '#0b6b78',
      ring: '#0b6b78',
      heroInk: '#ffffff',
      footerBg: '#efece5',
      statsBar: '#e4e0d6',
      scrim: '#121316',
      bracketSurface: '#efece5',
      bracketMuted: '#6d7178',
      card: '#efece5',
      cardInk: '#121316',
      secondary: '#e9e5dc',
      secondaryInk: '#121316',
      success: '#1a7a49',
      warning: '#8a5a00',
      gold: '#8a6a12',
    },
  },
  {
    id: 'graphite-gold',
    name: 'Graphite Black + Championship Gold',
    blurb: 'Gold promoted from a championship mark to the accent. Red steps back to warnings only.',
    values: {
      signal: '#e9b949',
      signalFill: '#8a6a12',
      signalInk: '#fffaf0',
      navActive: '#e9b949',
      navBorder: '#8a6a12',
      ring: '#e9b949',
      playerName: '#e0c67a',
      info: '#e0c67a',
      primary: '#8a6a12',
      primaryHover: '#6d5310',
      primaryInk: '#fffaf0',
    },
  },
  {
    id: 'deep-green',
    name: 'Deep Green + Warm White + Gold',
    blurb: 'A baize ground. Gold keeps its championship meaning and becomes the accent alongside it.',
    values: {
      void: '#06120d',
      graphite: '#0b1c15',
      graphiteRaised: '#12261d',
      plaque: '#163024',
      inset: '#040d09',
      hover: '#1b3a2c',
      cleanWhite: '#f4f6f1',
      mutedText: '#9db3a6',
      steel: '#7f9a8b',
      steelBright: '#a6bcae',
      signal: '#e9b949',
      signalFill: '#7a5c0f',
      signalInk: '#fffaf0',
      navBg: '#040d09',
      navActive: '#e9b949',
      navBorder: '#2c5a44',
      navInactive: '#a6bcae',
      line: '#1c3b2c',
      lineStrong: '#2c5a44',
      steelDim: '#3d6b54',
      ring: '#e9b949',
      playerName: '#7fd3a8',
      info: '#7fd3a8',
      primary: '#7a5c0f',
      primaryHover: '#5e470b',
      primaryInk: '#fffaf0',
      footerBg: '#0b1c15',
      statsBar: '#040d09',
      scrim: '#06120d',
      bracketSurface: '#12261d',
      card: '#12261d',
      acid: '#f4f6f1',
      acidInk: '#06120d',
    },
  },
]

export const PRESET_BY_ID = new Map(THEME_PRESETS.map((p) => [p.id, p]))

/**
 * A hex colour, or nothing.
 *
 * ── Why this is strict ──────────────────────────────────────────────────────────────────────────
 * These values are written into a `style` attribute as custom properties. A value like
 * `red;background:url(...)` would close the declaration and open another, so the validator is an
 * allow-list of exactly what a colour can look like rather than a search for things that look
 * dangerous. Three, six or eight hex digits and nothing else — no `rgb()`, no `var()`, no
 * `color-mix()`, because none of those are needed here and each one is a parser to be tricked.
 */
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

export function isValidTokenValue(v: unknown): v is string {
  return typeof v === 'string' && HEX.test(v.trim())
}

/**
 * Normalise a stored override map: drop unknown keys, drop invalid values, lower-case the rest.
 *
 * Applied on read as well as on write, so a value that was stored before a token existed — or by an
 * older version of this code — cannot reach the page.
 */
export function normaliseTokens(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!TOKEN_BY_KEY.has(k)) continue
    if (!isValidTokenValue(v)) continue
    out[k] = v.trim().toLowerCase()
  }
  return out
}

/** The custom properties a set of overrides should write. Only ever registry-declared properties. */
export function tokenVars(overrides: Record<string, string>): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [key, value] of Object.entries(normaliseTokens(overrides))) {
    const token = TOKEN_BY_KEY.get(key)
    if (!token || !WRITABLE_CSS_VARS.has(token.css)) continue
    vars[token.css] = value
  }
  return vars
}

/** Which tokens a preset leaves at the built-in value, for the panel's inherited/overridden mark. */
export function inheritedKeys(overrides: Record<string, string>): string[] {
  const set = new Set(Object.keys(normaliseTokens(overrides)))
  return THEME_TOKEN_REGISTRY.filter((t) => !set.has(t.key)).map((t) => t.key)
}
