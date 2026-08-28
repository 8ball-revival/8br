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
 */

/* ────────────────────────────────────────────────────────────────────── the settings ──────────── */

export type Intensity = 'clean' | 'subtle' | 'standard' | 'overdrive' | 'custom'
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

  /* ── Colour ───────────────────────────────────────────────────────────────────────────────────
   * `accentInk` is stored alongside the accent rather than computed on load: it lets the pre-paint
   * script apply a custom accent without carrying a copy of the contrast maths, which is the only
   * way to have one implementation of "what text colour is readable on this".
   */
  accentMode: 'default' | 'custom'
  accentHex: string
  accentInk: string
  swatches: string[]

  /* ── Structure ───────────────────────────────────────────────────────────────────────────────── */
  frame: Frame
  corners: Corners

  /* ── Surface ─────────────────────────────────────────────────────────────────────────────────── */
  texture: Texture
  textureStrength: number // 0–100 %
  textureScale: number    // 50–200 %
  surfaceTone: SurfaceTone

  /* ── Background ──────────────────────────────────────────────────────────────────────────────── */
  background: Background
  bgFit: BackgroundFit
  bgPosition: BackgroundPosition
  bgOpacity: number // 0–100
  bgBlur: number    // 0–40 px
  bgDarken: number  // 0–90 %

  /* ── Effects ─────────────────────────────────────────────────────────────────────────────────── */
  depth: number     // 0–200 %, drop shadow under panels
  motion: Motion
  scanlines: boolean
  grid: boolean
  grain: boolean
  aberration: boolean
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
  intensity: 'standard',
  glow: 100,
  bloom: 100,
  panelLight: 100,
  linework: 100,
  gridStrength: 100,
  scanStrength: 100,
  pulse: 100,

  accentMode: 'default',
  // Crystal White Pearl, the current accent. Black ink, as every accent surface requires.
  accentHex: '#f5f4f1',
  accentInk: '#050607',
  swatches: [],

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

  background: 'none',
  bgFit: 'cover',
  bgPosition: 'center',
  bgOpacity: 45,
  bgBlur: 0,
  bgDarken: 40,

  depth: 100,
  motion: 'normal',
  scanlines: true,
  grid: true,
  grain: true,
  aberration: false,
  vignette: false,
  borderPulse: false,
  livePulse: true,
}

/* ────────────────────────────────────────────────────────────── the intensity presets ─────────── */

/** The seven values a preset controls. Everything else stays exactly where the visitor left it. */
export type IntensityValues = Pick<
  DisplaySettings,
  'glow' | 'bloom' | 'panelLight' | 'linework' | 'gridStrength' | 'scanStrength' | 'pulse'
>

export const INTENSITY_FIELDS: (keyof IntensityValues)[] = [
  'glow', 'bloom', 'panelLight', 'linework', 'gridStrength', 'scanStrength', 'pulse',
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
  /* Flat, quiet, and still the same layout and palette — for reading, and for a tired machine. */
  clean:     { glow: 0,   bloom: 0,   panelLight: 0,   linework: 25,  gridStrength: 0,   scanStrength: 0,   pulse: 0 },
  subtle:    { glow: 45,  bloom: 40,  panelLight: 50,  linework: 60,  gridStrength: 55,  scanStrength: 50,  pulse: 35 },
  standard:  { glow: 100, bloom: 100, panelLight: 100, linework: 100, gridStrength: 100, scanStrength: 100, pulse: 100 },
  /* Allowed to be too much. Somebody who chooses it has said what they want. */
  overdrive: { glow: 180, bloom: 195, panelLight: 165, linework: 155, gridStrength: 150, scanStrength: 140, pulse: 185 },
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
  intensity: ['clean', 'subtle', 'standard', 'overdrive', 'custom'],
  accentMode: ['default', 'custom'],
  frame: ['minimal', 'rails', 'beveled', 'neon', 'broadcast', 'glass'],
  corners: ['chamfer', 'square', 'round'],
  texture: ['flat', 'carbon', 'brushed', 'frosted', 'hex', 'circuit', 'grid', 'holo'],
  surfaceTone: ['dark', 'light', 'auto'],
  background: ['none', 'void-grid', 'carbon-weave', 'data-stream', 'red-circuit', 'holographic', 'custom'],
  bgFit: ['cover', 'contain', 'tile'],
  bgPosition: ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'],
  motion: ['off', 'calm', 'normal', 'fast'],
} as const satisfies Partial<Record<keyof DisplaySettings, readonly string[]>>

/** Numeric fields and the range each is clamped to. */
const RANGES = {
  glow: [0, 200], bloom: [0, 200], panelLight: [0, 200], linework: [0, 200],
  gridStrength: [0, 200], scanStrength: [0, 200], pulse: [0, 200], depth: [0, 200],
  textureStrength: [0, 100], textureScale: [50, 200],
  bgOpacity: [0, 100], bgBlur: [0, 40], bgDarken: [0, 90],
} as const satisfies Partial<Record<keyof DisplaySettings, readonly [number, number]>>

const BOOLEANS = ['scanlines', 'grid', 'grain', 'aberration', 'vignette', 'borderPulse', 'livePulse'] as const

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
  out.swatches = Array.isArray(out.swatches)
    ? out.swatches.filter((c): c is string => typeof c === 'string' && HEX.test(c)).slice(0, 12)
    : []

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
  const intensity = old.intensity === 'off' ? 'clean' : old.intensity
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
  if (typeof old.scan === 'boolean') next.scanlines = old.scan
  if (typeof old.grid === 'boolean') next.grid = old.grid
  if (typeof old.noise === 'boolean') next.grain = old.noise
  if (typeof old.aberration === 'boolean') next.aberration = old.aberration

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
    dlBg: 'background',
    dlBgFit: 'bgFit',
    dlBgPos: 'bgPosition',
    dlMotion: 'motion',
    dlAccentMode: 'accentMode',
  },
  /** dataset key ← boolean field, written as on/off so CSS can select either state. */
  bools: {
    dlScan: 'scanlines',
    dlGrid: 'grid',
    dlGrain: 'grain',
    dlAberration: 'aberration',
    dlVignette: 'vignette',
    dlBorderPulse: 'borderPulse',
    dlLivePulse: 'livePulse',
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
    '--dl-texture-scale': ['textureScale', 100],
    '--dl-bg-opacity': ['bgOpacity', 100],
    '--dl-bg-darken': ['bgDarken', 100],
  },
  /** CSS variable ← [field, unit]. Lengths keep their unit rather than becoming a ratio. */
  px: {
    '--dl-bg-blur': ['bgBlur', 'px'],
  },
} as const

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

  for (const [key, field] of Object.entries(DOM_SPEC.attrs)) attrs[key] = String(s[field as keyof DisplaySettings])
  for (const [key, field] of Object.entries(DOM_SPEC.bools)) attrs[key] = s[field as keyof DisplaySettings] ? 'on' : 'off'
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
