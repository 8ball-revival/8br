/**
 * Pure color math for the personal-theme system. No DOM, no server-only imports — safe to run on the
 * server (SSR theme injection + validation), in the client (live preview), and in tsx test scripts.
 *
 * Everything here operates on 6-digit hex strings ("#rrggbb"). No alpha — the theme system never
 * supports transparency (a hard requirement: opaque colors only).
 */

export type RGB = { r: number; g: number; b: number }

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
export const clamp255 = (n: number) => clamp(Math.round(n), 0, 255)

/** Strict opaque-hex guard: exactly "#" + 6 hex digits. Rejects #rgb, #rgba, #rrggbbaa, css names. */
export const isHex6 = (s: unknown): s is string => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s)

export function hexToRgb(hex: string): RGB {
  if (!isHex6(hex)) throw new Error(`invalid hex: ${String(hex)}`)
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) }
}

const hx = (n: number) => clamp255(n).toString(16).padStart(2, '0')
export const rgbToHex = ({ r, g, b }: RGB): string => `#${hx(r)}${hx(g)}${hx(b)}`

/** Normalize any accepted hex (with/without #, upper/lower) to canonical lowercase #rrggbb, or null. */
export function normalizeHex(input: string): string | null {
  const s = input.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null
  return `#${s.toLowerCase()}`
}

// ---- HSL (used for hue-preserving lightness moves) --------------------------
export type HSL = { h: number; s: number; l: number } // h 0-360, s/l 0-1

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  let h = 0, s = 0
  const d = max - min
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    switch (max) {
      case rn: h = ((gn - bn) / d) % 6; break
      case gn: h = (bn - rn) / d + 2; break
      default: h = (rn - gn) / d + 4
    }
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s, l }
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = ((h % 360) + 360) % 360 / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0, g = 0, b = 0
  if (hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = l - c / 2
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }
}

/** Set absolute HSL lightness (0-1), preserving hue + saturation. */
export const withLightness = (hex: string, l: number): string => rgbToHex(hslToRgb({ ...rgbToHsl(hexToRgb(hex)), l: clamp(l, 0, 1) }))
export const lightnessOf = (hex: string): number => rgbToHsl(hexToRgb(hex)).l

/** Linear mix in sRGB space; t=0 → a, t=1 → b. */
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a), y = hexToRgb(b)
  const k = clamp(t, 0, 1)
  return rgbToHex({ r: x.r + (y.r - x.r) * k, g: x.g + (y.g - x.g) * k, b: x.b + (y.b - x.b) * k })
}
export const lighten = (hex: string, t: number) => mix(hex, '#ffffff', t)
export const darken = (hex: string, t: number) => mix(hex, '#000000', t)

// ---- WCAG contrast ----------------------------------------------------------
function channelLum(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  return 0.2126 * channelLum(r) + 0.7152 * channelLum(g) + 0.0722 * channelLum(b)
}
/** WCAG contrast ratio between two colors (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a), lb = relativeLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Pick the readable foreground (near-white or near-black) for a background, by max contrast. */
export function readableText(bg: string, light = '#fafafa', dark = '#0a0a0a'): string {
  return contrastRatio(bg, light) >= contrastRatio(bg, dark) ? light : dark
}

/**
 * Nudge `color`'s lightness (preserving hue/sat) until it meets `target` contrast against `bg`.
 * Moves in the direction that raises contrast (toward black on a light bg, toward white on a dark bg).
 * Returns the best achievable color + whether the target was met.
 */
export function ensureContrast(color: string, bg: string, target: number): { color: string; met: boolean } {
  if (contrastRatio(color, bg) >= target) return { color, met: true }
  const bgLight = relativeLuminance(bg) > 0.5
  let best = color, bestC = contrastRatio(color, bg)
  const l0 = lightnessOf(color)
  for (let i = 1; i <= 50; i++) {
    const l = clamp(bgLight ? l0 - i * 0.02 : l0 + i * 0.02, 0, 1)
    const cand = withLightness(color, l)
    const c = contrastRatio(cand, bg)
    if (c > bestC) { best = cand; bestC = c }
    if (c >= target) return { color: cand, met: true }
    if (l === 0 || l === 1) break
  }
  return { color: best, met: bestC >= target }
}
