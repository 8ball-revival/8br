/**
 * Display Lab — what a visitor may change about the way this site looks, and nothing else.
 *
 * ── The one rule ─────────────────────────────────────────────────────────────────────────────────
 * Every value in here is a preference held by ONE browser. Nothing in this module reaches an
 * account, a database or a server: a Season's standings, a Player's rating and a published post are
 * identical whatever is set here, and two people looking at the same page are looking at the same
 * facts. That is why the panel says "Stored in this browser only" and why it is telling the truth.
 *
 * ── Why the settings are a data structure rather than a stylesheet ───────────────────────────────
 * `displayDom()` turns settings into a bag of attributes and CSS variables, and that bag is applied
 * to an ELEMENT — usually <html>, but the live preview applies it to a single container instead. So
 * the preview is not a second implementation of the theme with its own approximations of what each
 * control does: it is the same function writing to a smaller scope, and what a reader sees in the
 * preview is what they get when they save. Every CSS rule is therefore written as an attribute
 * selector (`[data-dl-frame='rails']`) rather than a `:root` selector, so it matches both.
 *
 * ── Why the defaults matter so much ──────────────────────────────────────────────────────────────
 * DISPLAY_DEFAULTS must render EXACTLY what the site looks like with nothing stored. A visitor who
 * has never opened this panel, and one who opens it and presses Reset, must both see the official
 * appearance — so `standard`, `minimal`, `flat`, `none` and the default accent are not neutral
 * placeholders, they are the current design expressed as settings.
 *
 * ── The one dependency ───────────────────────────────────────────────────────────────────────────
 * `lib/theme` — pure data and pure functions, no React, no server, no database. It is imported so
 * that the list of writable custom properties has exactly one definition, shared by this module,
 * the panel, the contrast engine and the pre-paint script. A second copy of that list is how a
 * property ends up writable in one place and rejected in another.
 */
import { THEME_TOKEN_REGISTRY } from '@/lib/theme/registry'
import { tokenVars } from '@/lib/theme/presets'

/* ────────────────────────────────────────────────────────────────────── the settings ──────────── */

export type Intensity = 'off' | 'subtle' | 'standard' | 'overdrive' | 'custom'
export type FontChoice = 'default' | 'grotesk' | 'inter' | 'mono'
export type Frame = 'minimal' | 'rails' | 'beveled' | 'neon' | 'broadcast' | 'glass'
export type Corners = 'chamfer' | 'square' | 'round'
export type Texture = 'flat' | 'carbon' | 'brushed' | 'frosted' | 'hex' | 'circuit' | 'grid' | 'holo'
export type SurfaceTone = 'dark' | 'light' | 'auto'
export type Background = 'none' | 'void-grid' | 'carbon-weave' | 'data-stream' | 'red-circuit' | 'holographic' | 'custom'
export type BackgroundFit = 'cover' | 'contain' | 'tile'
export type Motion = 'off' | 'calm' | 'normal' | 'fast'

export type BackgroundPosition =
  | 'top-left' | 'top' | 'top-right'
  | 'left' | 'center' | 'right'
  | 'bottom-left' | 'bottom' | 'bottom-right'

export interface DisplaySettings {
  /* ── Intensity ────────────────────────────────────────────────────────────────────────────────
   * The preset, and the seven values it sets. The values are stored rather than derived so that
   * moving one advanced control keeps the other six exactly where the preset put them — switching
   * to `custom` must not silently re-baseline everything else to some neutral middle.
   */
  intensity: Intensity
  glow: number        // 0–200 %, every lit shadow in the interface
  bloom: number       // 0–200 %, the light on a panel's border
  panelLight: number  // 0–200 %, interior lighting and depth
  linework: number    // 0–200 %, corner brackets and technical rules
  gridStrength: number    // 0–200 %
  scanStrength: number    // 0–200 %
  pulse: number       // 0–200 %, highlight and live pulses

  /*
   * The individually adjustable effects.
   *
   * Strengths rather than switches, and 0 IS off - which is why the separate on/off toggles these
   * replace are gone. Two controls for one effect means a slider that appears to do nothing because
   * a checkbox somewhere else is clear, and it doubles what a preset has to remember to set.
   */
  grainStrength: number
  aberrationStrength: number
  flickerStrength: number

  /* ── Colour ───────────────────────────────────────────────────────────────────────────────────
   * `accentInk` is stored alongside the accent rather than computed on load: it lets the pre-paint
   * script apply a custom accent without carrying a copy of the contrast maths, which is the only
   * way to have one implementation of "what text colour is readable on this".
   */
  accentMode: 'default' | 'custom'
  accentHex: string
  accentInk: string
  swatches: string[]
  /** The last few colours touched, newest first. A convenience, not a saved decision. */
  recentColors: string[]

  /* ── Structure ───────────────────────────────────────────────────────────────────────────────── */
  frame: Frame
  corners: Corners

  /* ── Surface ─────────────────────────────────────────────────────────────────────────────────── */
  texture: Texture
  textureStrength: number // 0–100 %
  fontFamily: FontChoice
  textureScale: number    // 50–200 %
  surfaceTone: SurfaceTone

  /* ── Background ──────────────────────────────────────────────────────────────────────────────── */
  background: Background
  bgFit: BackgroundFit
  bgPosition: BackgroundPosition
  bgOpacity: number // 0–100
  bgBlur: number    // 0–40 px
  bgDarken: number  // 0–90 %

  /* ── The semantic palette ─────────────────────────────────────────────────────────────────────
   * Overrides for the tokens declared in `lib/theme/registry.ts`, keyed by registry key rather than
   * by custom property — so a token can be renamed in CSS without orphaning everything an Owner has
   * already chosen.
   *
   * SPARSE on purpose. A key that is absent means "use the built-in value", which is what lets the
   * panel distinguish inherited from overridden, lets a reset be a delete rather than a re-guess,
   * and lets a token added next year arrive with its default already correct in every stored theme.
   */
  tokens: Record<string, string>
  /** The preset last applied, or 'custom' once anything has been changed by hand. */
  preset: string

  /* ── Effects ─────────────────────────────────────────────────────────────────────────────────── */
  depth: number     // 0–200 %, drop shadow under panels
  motion: Motion
  vignette: boolean
  borderPulse: boolean
  livePulse: boolean
}

/**
 * The official appearance, written as settings.
 *
 * Changing a value here changes what every visitor sees, including one who has never opened the
 * panel — this object IS the site's design, not a starting point for it.
 */
export const DISPLAY_DEFAULTS: DisplaySettings = {
  tokens: {},
  preset: 'graphite-signal',
  intensity: 'standard',
  glow: 100,
  bloom: 100,
  panelLight: 100,
  linework: 100,
  gridStrength: 100,
  scanStrength: 100,
  pulse: 100,
  grainStrength: 100,
  aberrationStrength: 0,
  flickerStrength: 0,

  accentMode: 'default',
  // Crystal White Pearl, the current accent. Black ink, as every accent surface requires.
  accentHex: '#f5f4f1',
  accentInk: '#050607',
  swatches: [],
  recentColors: [],

  frame: 'minimal',
  corners: 'chamfer',

  texture: 'flat',
  /*
   * Deliberately low.
   *
   * This is the value a reader meets the moment they pick a texture, and at 35% a white diagonal
   * crosshatch every four pixels sits over the numbers in a standings table and makes them swim.
   * A material should read as a material at a glance and disappear while the page is being read;
   * the slider goes to 100 for anybody who wants more.
   */
  textureStrength: 20,
  textureScale: 100,
  surfaceTone: 'dark',
  fontFamily: 'default',

  background: 'none',
  bgFit: 'cover',
  bgPosition: 'center',
  bgOpacity: 45,
  bgBlur: 0,
  bgDarken: 40,

  depth: 100,
  motion: 'normal',
  vignette: false,
  borderPulse: false,
  livePulse: true,
}

/* ────────────────────────────────────────────────────────────── the intensity presets ─────────── */

/** The seven values a preset controls. Everything else stays exactly where the visitor left it. */
export type IntensityValues = Pick<
  DisplaySettings,
  'glow' | 'bloom' | 'panelLight' | 'linework' | 'gridStrength' | 'scanStrength' | 'pulse'
  | 'textureStrength' | 'grainStrength' | 'aberrationStrength' | 'flickerStrength'
>

/**
 * What a preset sets, and it is deliberately most of the interface.
 *
 * It used to be seven lighting numbers, which meant choosing Overdrive left the grain, the texture
 * and the aberration exactly where they were - so the preset changed how lit the page was without
 * changing how it FELT, and two presets could look nearly identical because the loudest effects were
 * not theirs to move. A preset is a description of the whole atmosphere or it is a lighting slider
 * with four names.
 */
export const INTENSITY_FIELDS: (keyof IntensityValues)[] = [
  'glow', 'bloom', 'panelLight', 'linework', 'gridStrength', 'scanStrength', 'pulse',
  'textureStrength', 'grainStrength', 'aberrationStrength', 'flickerStrength',
]

/** The lighting core, which every preset must differ on. See `verify-display-lab`. */
export const INTENSITY_CORE_FIELDS: (keyof IntensityValues)[] = [
  'glow', 'bloom', 'panelLight', 'linework', 'gridStrength', 'scanStrength', 'pulse', 'textureStrength',
]

/**
 * Four presets that are actually four presets.
 *
 * Every field differs between every pair, on purpose: Standard and Overdrive used to be the same
 * numbers with one multiplier moved, which made "Overdrive" a claim the rendering did not support.
 * These are chosen so a reader switching between any two sees a change without hunting for it, and
 * so a test can assert the difference rather than an author asserting it in a comment.
 *
 * `standard` is all 100 because 100 means "as designed" — see DISPLAY_DEFAULTS.
 */
export const INTENSITY_PRESETS: Record<Exclude<Intensity, 'custom'>, IntensityValues> = {
  /*
   * Off keeps the palette, the layout and the type, and removes the atmosphere entirely. The site
   * still looks like itself, just unlit - which is the point: this is the setting for reading on, and
   * for a machine that cannot afford the rest.
   */
  off: {
    glow: 0, bloom: 0, panelLight: 0, linework: 20,
    gridStrength: 0, scanStrength: 0, pulse: 0,
    textureStrength: 0, grainStrength: 0, aberrationStrength: 0, flickerStrength: 0,
  },
  /* Present but quiet. Everything on, nothing loud. */
  subtle: {
    glow: 45, bloom: 40, panelLight: 50, linework: 60,
    gridStrength: 55, scanStrength: 50, pulse: 35,
    textureStrength: 12, grainStrength: 60, aberrationStrength: 0, flickerStrength: 0,
  },
  /* The site as designed. Every value at 100 means "as authored" - see DISPLAY_DEFAULTS. */
  standard: {
    glow: 100, bloom: 100, panelLight: 100, linework: 100,
    gridStrength: 100, scanStrength: 100, pulse: 100,
    textureStrength: 20, grainStrength: 100, aberrationStrength: 0, flickerStrength: 0,
  },
  /*
   * Allowed to be too much, and the only preset that turns on the two effects nobody should meet by
   * accident. Chromatic aberration is a lens defect and CRT flicker is tiring; both are legible
   * choices when somebody has asked for excess, and neither belongs in a default.
   */
  overdrive: {
    glow: 180, bloom: 195, panelLight: 165, linework: 155,
    gridStrength: 150, scanStrength: 140, pulse: 185,
    textureStrength: 45, grainStrength: 150, aberrationStrength: 55, flickerStrength: 35,
  },
}

/** Apply a preset, leaving every setting it does not own untouched. */
export function withIntensity(s: DisplaySettings, intensity: Intensity): DisplaySettings {
  if (intensity === 'custom') return { ...s, intensity }
  return { ...s, intensity, ...INTENSITY_PRESETS[intensity] }
}

/**
 * Does this set of values still match the preset it claims?
 *
 * Used to decide when a control switches the label to CUSTOM. Comparing against the preset rather
 * than tracking "has the user touched anything" means dragging a slider back to where it started
 * restores the preset name, which is what somebody experimenting expects.
 */
export function matchedPreset(v: IntensityValues): Exclude<Intensity, 'custom'> | null {
  for (const [name, preset] of Object.entries(INTENSITY_PRESETS) as [Exclude<Intensity, 'custom'>, IntensityValues][]) {
    if (INTENSITY_FIELDS.every((f) => v[f] === preset[f])) return name
  }
  return null
}

/* ──────────────────────────────────────────────────────────────────────── validation ──────────── */

const CHOICES = {
  intensity: ['off', 'subtle', 'standard', 'overdrive', 'custom'],
  accentMode: ['default', 'custom'],
  frame: ['minimal', 'rails', 'beveled', 'neon', 'broadcast', 'glass'],
  corners: ['chamfer', 'square', 'round'],
  texture: ['flat', 'carbon', 'brushed', 'frosted', 'hex', 'circuit', 'grid', 'holo'],
  surfaceTone: ['dark', 'light', 'auto'],
  background: ['none', 'void-grid', 'carbon-weave', 'data-stream', 'red-circuit', 'holographic', 'custom'],
  bgFit: ['cover', 'contain', 'tile'],
  bgPosition: ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'],
  motion: ['off', 'calm', 'normal', 'fast'],
  fontFamily: ['default', 'grotesk', 'inter', 'mono'],
} as const satisfies Partial<Record<keyof DisplaySettings, readonly string[]>>

/** Numeric fields and the range each is clamped to. */
const RANGES = {
  glow: [0, 200], bloom: [0, 200], panelLight: [0, 200], linework: [0, 200],
  gridStrength: [0, 200], scanStrength: [0, 200], pulse: [0, 200], depth: [0, 200],
  grainStrength: [0, 200], aberrationStrength: [0, 100], flickerStrength: [0, 100],
  textureStrength: [0, 100], textureScale: [50, 200],
  bgOpacity: [0, 100], bgBlur: [0, 40], bgDarken: [0, 90],
} as const satisfies Partial<Record<keyof DisplaySettings, readonly [number, number]>>

const BOOLEANS = ['vignette', 'borderPulse', 'livePulse'] as const

const HEX = /^#[0-9a-f]{6}$/i

/** The storage key. Versioned in the name, so a future incompatible shape simply is not read. */
export const DISPLAY_KEY = '8br-display-v1'

/** The key Display Lab replaced. Read once, to carry an existing reader's preferences forward. */
export const LEGACY_HUD_KEY = '8br-hud'

/**
 * Read stored settings, discarding anything that is not offered any more.
 *
 * ── Per FIELD, never per object ──────────────────────────────────────────────────────────────────
 * A stale value in one field falls back to that field's default and nothing else moves. Discarding
 * the whole object instead — the obvious implementation — means the day a texture is renamed, every
 * reader who had chosen one also loses their accent, their frame and their motion setting. Corrupt
 * or unparseable storage is the only case that falls back wholesale, because there is nothing left
 * to salvage.
 */
export function parseDisplay(raw: string | null | undefined): DisplaySettings {
  if (!raw) return { ...DISPLAY_DEFAULTS }
  let stored: Partial<DisplaySettings>
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DISPLAY_DEFAULTS }
    stored = parsed as Partial<DisplaySettings>
  } catch {
    return { ...DISPLAY_DEFAULTS }
  }

  const out: DisplaySettings = { ...DISPLAY_DEFAULTS, ...stored }
  /*
   * One loosely-typed view of `out`, rather than a cast at each assignment.
   *
   * These loops write a field whose name is only known at runtime, which no amount of generic
   * signature makes checkable — the alternative is three unchecked casts saying the same thing in
   * three places. The reads stay typed; only the write is widened, and the value written is always
   * that field's own default.
   */
  const bag = out as unknown as Record<string, unknown>

  for (const [field, allowed] of Object.entries(CHOICES) as [keyof typeof CHOICES, readonly string[]][]) {
    if (!allowed.includes(out[field] as string)) bag[field] = DISPLAY_DEFAULTS[field]
  }
  for (const [field, [lo, hi]] of Object.entries(RANGES) as [keyof typeof RANGES, readonly [number, number]][]) {
    const n = out[field]
    bag[field] = typeof n === 'number' && Number.isFinite(n)
      ? Math.min(hi, Math.max(lo, Math.round(n)))
      : DISPLAY_DEFAULTS[field]
  }
  for (const field of BOOLEANS) {
    if (typeof out[field] !== 'boolean') bag[field] = DISPLAY_DEFAULTS[field]
  }

  if (!HEX.test(out.accentHex)) { out.accentHex = DISPLAY_DEFAULTS.accentHex; out.accentMode = 'default' }
  if (!HEX.test(out.accentInk)) out.accentInk = DISPLAY_DEFAULTS.accentInk
  const colourList = (v: unknown, max: number) => (Array.isArray(v)
    ? v.filter((c): c is string => typeof c === 'string' && HEX.test(c)).slice(0, max)
    : [])
  out.swatches = colourList(out.swatches, 12)
  out.recentColors = colourList(out.recentColors, 8)

  /*
   * A stored `intensity` is believed only if the numbers still agree with it. Storage can hold a
   * preset name beside values that no longer match — an older build's preset, or a hand-edited
   * entry — and a panel showing "STANDARD" over overdrive numbers is lying about what is applied.
   */
  if (out.intensity !== 'custom' && matchedPreset(out) !== out.intensity) out.intensity = 'custom'

  return out
}

/**
 * Carry a reader's old HUD preferences into Display Lab.
 *
 * The old panel stored intensity, accent, glow, motion, corners and five toggles. Everything that
 * still exists is kept; `off` becomes `clean`, and the four fixed accents become the equivalent
 * custom colour rather than being dropped — somebody who chose the red interface should still have
 * a red interface. The old CRT flicker has no equivalent and is not invented one.
 */
const LEGACY_ACCENTS: Record<string, string> = {
  yellow: '#d8dc2f', red: '#ff2a2a', white: '#f5f4f1', blue: '#13d8e8',
}

export function migrateLegacyHud(raw: string | null | undefined): Partial<DisplaySettings> | null {
  if (!raw) return null
  let old: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    old = parsed as Record<string, unknown>
  } catch { return null }

  const next: Partial<DisplaySettings> = {}
  // 'off' meant the same thing in the old panel and means it again here, so it carries straight over.
  const intensity = old.intensity
  if (typeof intensity === 'string' && CHOICES.intensity.includes(intensity as Intensity)) {
    Object.assign(next, withIntensity(DISPLAY_DEFAULTS, intensity as Intensity))
    next.intensity = intensity as Intensity
  }
  if (typeof old.glow === 'number' && Number.isFinite(old.glow)) {
    next.glow = Math.min(200, Math.max(0, Math.round(old.glow)))
    if (next.glow !== DISPLAY_DEFAULTS.glow && next.intensity !== 'custom') {
      // A preset plus a hand-set glow is, by definition, a custom configuration.
      if (matchedPreset({ ...DISPLAY_DEFAULTS, ...next } as IntensityValues) == null) next.intensity = 'custom'
    }
  }
  if (typeof old.accent === 'string' && LEGACY_ACCENTS[old.accent] && old.accent !== 'white') {
    next.accentMode = 'custom'
    next.accentHex = LEGACY_ACCENTS[old.accent]
    next.accentInk = '#050607'
  }
  if (typeof old.corners === 'string' && CHOICES.corners.includes(old.corners as Corners)) next.corners = old.corners as Corners
  if (typeof old.motion === 'string' && CHOICES.motion.includes(old.motion as Motion)) next.motion = old.motion as Motion
  /*
   * The old switches become strengths: off is zero, on is the designed amount. A reader who had
   * turned scanlines off keeps them off; one who had them on gets them at the strength the preset
   * would have given them, which is what they were already looking at.
   */
  if (typeof old.scan === 'boolean') next.scanStrength = old.scan ? 100 : 0
  if (typeof old.grid === 'boolean') next.gridStrength = old.grid ? 100 : 0
  if (typeof old.noise === 'boolean') next.grainStrength = old.noise ? 100 : 0
  if (typeof old.aberration === 'boolean') next.aberrationStrength = old.aberration ? 50 : 0
  // The old panel had CRT flicker and Display Lab dropped it; it is back, so the choice carries over.
  if (typeof old.flicker === 'boolean') next.flickerStrength = old.flicker ? 35 : 0

  return Object.keys(next).length > 0 ? next : null
}

/* ─────────────────────────────────────────────────────────── settings to DOM state ────────────── */

/**
 * The mapping the pre-paint script also uses.
 *
 * Exported as DATA rather than as code because layout.tsx has to inline a script in <head> — before
 * any bundle exists — and a hand-written copy of these rules is a copy that drifts. The script is a
 * six-line interpreter of this object, so there is one definition of which setting becomes which
 * attribute, and a test asserts every field is covered.
 */
export const DOM_SPEC = {
  /** dataset key ← settings field, verbatim string values. */
  attrs: {
    dlIntensity: 'intensity',
    dlFrame: 'frame',
    dlCorners: 'corners',
    dlTexture: 'texture',
    dlTone: 'surfaceTone',
    dlFont: 'fontFamily',
    dlBg: 'background',
    dlBgFit: 'bgFit',
    dlBgPos: 'bgPosition',
    dlMotion: 'motion',
    dlAccentMode: 'accentMode',
  },
  /** dataset key ← boolean field, written as on/off so CSS can select either state. */
  bools: {
    dlVignette: 'vignette',
    dlBorderPulse: 'borderPulse',
    dlLivePulse: 'livePulse',
  },
  /*
   * Effects whose attribute is derived from a STRENGTH rather than a switch.
   *
   * `data-dl-grain="on"` still exists for the stylesheet to select on, but it is computed from
   * `grainStrength > 0` rather than stored separately - so a slider at zero and a switch turned off
   * cannot disagree, because there is only one of them.
   */
  onWhenPositive: {
    dlScan: 'scanStrength',
    dlGrid: 'gridStrength',
    dlGrain: 'grainStrength',
    dlAberration: 'aberrationStrength',
    dlFlicker: 'flickerStrength',
  },
  /** CSS variable ← [field, divisor]. Percentages become the multipliers the stylesheet expects. */
  nums: {
    '--dl-glow': ['glow', 100],
    '--dl-bloom': ['bloom', 100],
    '--dl-panel-light': ['panelLight', 100],
    '--dl-linework': ['linework', 100],
    '--dl-grid': ['gridStrength', 100],
    '--dl-scan': ['scanStrength', 100],
    '--dl-pulse': ['pulse', 100],
    '--dl-depth': ['depth', 100],
    '--dl-texture-strength': ['textureStrength', 100],
    '--dl-grain': ['grainStrength', 100],
    '--dl-aberration': ['aberrationStrength', 100],
    '--dl-flicker': ['flickerStrength', 100],
    '--dl-texture-scale': ['textureScale', 100],
    '--dl-bg-opacity': ['bgOpacity', 100],
    '--dl-bg-darken': ['bgDarken', 100],
  },
  /** CSS variable ← [field, unit]. Lengths keep their unit rather than becoming a ratio. */
  px: {
    '--dl-bg-blur': ['bgBlur', 'px'],
  },
  /*
    Registry key → custom property, for the palette.

    Derived from the registry rather than written out, so a token cannot exist in the panel and be
    missing from the pre-paint script — which would show one colour before hydration and another
    after, the exact flash this script exists to prevent.
  */
  tokens: Object.fromEntries(THEME_TOKEN_REGISTRY.map((t) => [t.key, t.css])) as Record<string, string>,
} as const

/**
 * WCAG relative luminance for a hex colour, or 0 when it cannot be read.
 *
 * A small local copy rather than an import: this module is deliberately close to dependency-free,
 * and the alternative pulls the display colour module into the pre-paint path for one formula.
 */
function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return 0
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  const channel = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  const r = channel(parseInt(h.slice(0, 2), 16))
  const g = channel(parseInt(h.slice(2, 4), 16))
  const b = channel(parseInt(h.slice(4, 6), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export interface DisplayDom {
  attrs: Record<string, string>
  vars: Record<string, string>
}

/**
 * Turn settings into the attributes and variables a stylesheet reads.
 *
 * Pure, and scope-agnostic: the same output is written to <html> for the real page and to a single
 * container for the live preview. Nothing here knows what a scanline looks like — it sets
 * `data-dl-scan="off"` and the stylesheet decides, which is what keeps this a preferences model
 * rather than a second copy of the design.
 */
export function displayDom(s: DisplaySettings): DisplayDom {
  const attrs: Record<string, string> = {}
  const vars: Record<string, string> = {}

  /*
    The palette goes out as custom properties, and it goes out FIRST.

    First because everything below may legitimately overwrite it -- a custom accent still repoints
    the acid family, and it should win over a palette value for the same property rather than lose
    to it by ordering accident.

    `tokenVars` is the only thing that decides which properties may be written: it drops any key not
    in the registry and any value that is not a plain hex colour. That is what makes this safe to
    inline into a style attribute -- there is no value it can emit that closes a declaration and
    opens another.
  */
  const palette = tokenVars(s.tokens ?? {})
  for (const [prop, value] of Object.entries(palette)) vars[prop] = value

  /*
    Is this a light page or a dark one?

    Decided from the RESOLVED page colour, not from a preset name, so it is right for a palette
    somebody typed by hand. A handful of values in the stylesheet — the rating bands — were picked
    for a dark ground and need darker variants on a light one; this attribute is what selects them.

    Relative luminance rather than a lightness channel, because that is what contrast is actually
    computed from, and 0.4 is comfortably clear of both the graphite grounds and the paper ones.
  */
  const ground = palette['--void'] ?? '#050607'
  attrs.dlGround = relativeLuminance(ground) > 0.4 ? 'light' : 'dark'

  for (const [key, field] of Object.entries(DOM_SPEC.attrs)) attrs[key] = String(s[field as keyof DisplaySettings])
  for (const [key, field] of Object.entries(DOM_SPEC.bools)) attrs[key] = s[field as keyof DisplaySettings] ? 'on' : 'off'
  for (const [key, field] of Object.entries(DOM_SPEC.onWhenPositive)) {
    attrs[key] = (s[field as keyof DisplaySettings] as number) > 0 ? 'on' : 'off'
  }
  for (const [name, [field, div]] of Object.entries(DOM_SPEC.nums)) {
    vars[name] = String((s[field as keyof DisplaySettings] as number) / (div as number))
  }
  for (const [name, [field, unit]] of Object.entries(DOM_SPEC.px)) {
    vars[name] = `${s[field as keyof DisplaySettings] as number}${unit}`
  }

  /*
   * The accent is two variables and nothing more.
   *
   * Hover and dim shades are derived in CSS with `color-mix`, so a custom colour gets the same
   * three-shade treatment as the built-in one without JavaScript computing two extra hex strings.
   * `--dl-ink` is stored rather than derived here for the pre-paint script's benefit; see
   * DisplaySettings.accentInk.
   */
  if (s.accentMode === 'custom') {
    vars['--dl-accent'] = s.accentHex
    vars['--dl-accent-ink'] = s.accentInk
  }

  return { attrs, vars }
}

/** Write settings onto an element: <html> for the page, a container for the preview. */
export function applyDisplay(el: HTMLElement, s: DisplaySettings): void {
  const { attrs, vars } = displayDom(s)
  for (const [key, value] of Object.entries(attrs)) el.dataset[key] = value
  for (const [name, value] of Object.entries(vars)) el.style.setProperty(name, value)
  /*
   * A default accent REMOVES the variables rather than restating the default colour. Leaving them
   * set to the design's own value works until the design's value changes, at which point every
   * browser that ever opened this panel is pinned to the old one.
   */
  if (s.accentMode !== 'custom') {
    el.style.removeProperty('--dl-accent')
    el.style.removeProperty('--dl-accent-ink')
  }
}
