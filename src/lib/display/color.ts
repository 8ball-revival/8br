/**
 * Colour Lab's arithmetic — the part that decides whether a chosen accent can actually be read on.
 *
 * ── Why this is not left to the visitor ──────────────────────────────────────────────────────────
 * The accent is a SURFACE colour: the navigation bar, buttons, the feature panel and active tabs are
 * filled with it and carry text on top. So an accent is not just a preference about appearance — it
 * decides whether the words on those surfaces are legible. Somebody dragging a lightness slider into
 * mid-grey has not asked for an unreadable navigation bar; they have asked for that colour, and the
 * ink on top is ours to get right.
 *
 * So: the ink is always computed, never chosen, and a pairing that cannot reach the WCAG AA 4.5:1
 * threshold for normal text is both reported and offered a correction. The reader can still keep it.
 * They are told, they are shown the nearest colour that works, and the decision stays theirs.
 */

/* ─────────────────────────────────────────────────────────────────────── conversions ──────────── */

export interface Hsl { h: number; s: number; l: number }

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const hex2 = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')

/** `#rrggbb` → 0–255 triplet. Returns null for anything that is not exactly six hex digits. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`
}

export function hslToHex({ h, s, l }: Hsl): string {
  const sat = clamp(s, 0, 100) / 100
  const lig = clamp(l, 0, 100) / 100
  const c = (1 - Math.abs(2 * lig - 1)) * sat
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x]
      : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x]
  const m = lig - c / 2
  return rgbToHex((r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255)
}

export function hexToHsl(hex: string): Hsl | null {
  const rgb = parseHex(hex)
  if (!rgb) return null
  const [r, g, b] = rgb.map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const l = (max + min) / 2
  if (d === 0) return { h: 0, s: 0, l: Math.round(l * 100) }
  const s = d / (1 - Math.abs(2 * l - 1))
  const h =
    max === r ? 60 * (((g - b) / d) % 6)
      : max === g ? 60 * ((b - r) / d + 2)
        : 60 * ((r - g) / d + 4)
  return { h: Math.round(((h % 360) + 360) % 360), s: Math.round(s * 100), l: Math.round(l * 100) }
}

/* ─────────────────────────────────────────────────────────────────────────── contrast ─────────── */

/** WCAG relative luminance. sRGB channels are linearised first; averaging the raw bytes is wrong. */
export function luminance(hex: string): number {
  const rgb = parseHex(hex)
  if (!rgb) return 0
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** The AA threshold for normal body text. Large text is 3:1, but accents carry small labels too. */
export const AA_NORMAL = 4.5

/**
 * The ink for a given accent: near-black or near-white, whichever is easier to read.
 *
 * The two candidates are the site's own `--void` and `--clean-white` rather than pure #000/#fff, so
 * an accent surface keeps the same ink as the rest of the interface instead of introducing a fifth
 * neutral. Where both work, the higher ratio wins.
 */
export const INK_DARK = '#050607'
export const INK_LIGHT = '#f5f7f8'

export function readableInk(accentHex: string): string {
  return contrastRatio(accentHex, INK_DARK) >= contrastRatio(accentHex, INK_LIGHT) ? INK_DARK : INK_LIGHT
}

export interface ContrastCheck {
  ink: string
  ratio: number
  passes: boolean
  /** The nearest colour of the same hue and saturation that does reach AA, if this one does not. */
  suggestion: string | null
}

/**
 * Check an accent, and find the nearest usable version of it when it fails.
 *
 * The correction moves LIGHTNESS only. Hue is the thing the visitor actually chose — "I want it
 * purple" — and a correction that shifts hue to gain contrast returns a different colour from the
 * one they asked for. Saturation is left alone for the same reason. Lightness is the axis they are
 * least attached to and the one contrast actually depends on, so the suggestion is recognisably the
 * colour they picked, only lighter or darker.
 *
 * Both directions are searched, because mid-tones can be rescued either way, and the closer of the
 * two wins so the suggestion is the smallest change that works.
 */
export function checkAccent(accentHex: string): ContrastCheck {
  const ink = readableInk(accentHex)
  const ratio = contrastRatio(accentHex, ink)
  if (ratio >= AA_NORMAL) return { ink, ratio, passes: true, suggestion: null }

  const hsl = hexToHsl(accentHex)
  if (!hsl) return { ink, ratio, passes: false, suggestion: null }

  let best: { hex: string; distance: number } | null = null
  for (const direction of [-1, 1]) {
    for (let step = 1; step <= 100; step++) {
      const l = hsl.l + direction * step
      if (l < 0 || l > 100) break
      const candidate = hslToHex({ ...hsl, l })
      if (contrastRatio(candidate, readableInk(candidate)) >= AA_NORMAL) {
        if (!best || step < best.distance) best = { hex: candidate, distance: step }
        break
      }
    }
  }
  return { ink, ratio, passes: false, suggestion: best?.hex ?? null }
}

/**
 * Colours a custom accent is NOT allowed to become.
 *
 * ── Why a list exists at all ─────────────────────────────────────────────────────────────────────
 * The accent repoints structural colour: chrome, selection borders, technical linework, interactive
 * highlights. It must never repoint colour that carries MEANING. Championship gold means a title was
 * won. Red means danger or a loss. Green means success or qualification. Amber means attention. If a
 * reader who prefers a green interface sees green qualification markers everywhere, the marker has
 * stopped being a marker — the site would be recolouring its own data.
 *
 * These tokens are therefore declared as literals in globals.css and are absent from every accent
 * rule, and `verify-display-lab` asserts it rather than trusting this comment.
 */
export const SEMANTIC_TOKENS = [
  '--destructive', '--success', '--warning', '--champ-gold', '--gold', '--gold-soft', '--gold-dim',
  '--win', '--loss', '--streak-hot', '--streak-cold',
] as const
