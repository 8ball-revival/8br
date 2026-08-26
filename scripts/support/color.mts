/**
 * Reading a CSS colour literal, whatever notation it happens to be written in.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────────
 * Several design audits assert things about the PROPERTY of a colour: a surface token must be
 * neutral, a bracket token must be cool. They were written when every token was `oklch(L C H)` and
 * so they read those three numbers straight out of the text with a regex.
 *
 * When the palette moved to exact hex brand values those regexes stopped matching, and the checks
 * silently had nothing left to look at — the bracket audit reported "0 tokens to check" and passed
 * its neutrality test vacuously. That is the dangerous failure: a test that cannot see anything
 * cannot fail.
 *
 * Parsing both notations into the same polar form fixes it properly. The audits keep asserting
 * exactly what they always asserted, and they no longer care how a colour is spelled — so the next
 * notation change cannot quietly blind them either.
 */

export interface Polar {
  /** Perceptual lightness, 0–1. */
  l: number
  /** Chroma. 0 is a true grey; above ~0.02 a colour is visibly tinted. */
  c: number
  /** Hue angle in degrees, 0–360. Meaningless when chroma is ~0. */
  h: number
}

/** sRGB channel (0–1) to linear light. */
function toLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

/**
 * Hex to OKLCh, via the OKLab matrices.
 *
 * This is the standard sRGB → LMS → OKLab conversion; the constants are Björn Ottosson's. It is
 * here rather than pulled from a dependency because these scripts run with no bundler and the
 * conversion is fifteen lines.
 */
export function hexToPolar(hex: string): Polar | null {
  const m = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim())
  if (!m) return null
  const raw = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  const r = toLinear(parseInt(raw.slice(0, 2), 16) / 255)
  const g = toLinear(parseInt(raw.slice(2, 4), 16) / 255)
  const b = toLinear(parseInt(raw.slice(4, 6), 16) / 255)

  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_

  const c = Math.sqrt(A * A + B * B)
  let h = (Math.atan2(B, A) * 180) / Math.PI
  if (h < 0) h += 360
  return { l: L, c, h }
}

/** `oklch(L C H)` / `oklch(L C H / A)` to the same polar form. */
export function oklchToPolar(value: string): Polar | null {
  const m = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(value)
  return m ? { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) } : null
}

/**
 * Any literal this codebase writes: hex or oklch.
 *
 * Returns null for anything indirect — `var(--x)`, `color-mix(...)`, `transparent`, a keyword. That
 * is deliberate and callers must treat it as "not a literal to judge" rather than as a pass: a
 * token defined as `var(--acid)` is checked where --acid itself is defined.
 */
export function parseColor(value: string): Polar | null {
  const v = value.trim()
  if (v.startsWith('#')) return hexToPolar(v)
  if (v.toLowerCase().startsWith('oklch(')) return oklchToPolar(v)
  return null
}

/** A true neutral: grey, near-black, near-white. The threshold matches the old audits' 0.01. */
export function isNeutral(p: Polar, maxChroma = 0.01): boolean {
  return p.c <= maxChroma
}

/**
 * Cool or neutral. Warm means visibly chromatic AND outside the blue-grey band.
 *
 * The hue window is stated in oklch degrees, where the blue-through-violet greys these surfaces use
 * sit between roughly 200 and 300.
 */
export function isCoolOrNeutral(p: Polar, maxChroma = 0.02): boolean {
  if (p.c <= maxChroma) return true
  return p.h >= 200 && p.h <= 300
}

/**
 * Relative luminance (WCAG), from a hex literal.
 *
 * Separate from the OKLab lightness above: contrast ratios are defined against this specific
 * formula, and substituting a perceptual lightness would give confident, wrong numbers.
 */
export function luminance(hex: string): number | null {
  const m = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim())
  if (!m) return null
  const raw = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  const [r, g, b] = [0, 2, 4].map((i) => toLinear(parseInt(raw.slice(i, i + 2), 16) / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two hex colours, 1–21. */
export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a)
  const lb = luminance(b)
  if (la == null || lb == null) return null
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Resolve a token to the literal it eventually names, following `var(--x)` chains.
 *
 * The palette is deliberately layered — `--nav-bg: var(--acid)` — so an audit that only reads the
 * token it was asked about would see a variable reference and give up. `declarations` is a plain
 * name → value map scraped from the stylesheet.
 */
export function resolveToken(
  name: string,
  declarations: Map<string, string>,
  seen = new Set<string>(),
): string | null {
  if (seen.has(name)) return null // a cycle; report nothing rather than loop
  seen.add(name)
  const raw = declarations.get(name)
  if (!raw) return null
  const ref = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(raw.trim())
  return ref ? resolveToken(ref[1], declarations, seen) : raw.trim()
}

/** Scrape `--name: value;` pairs out of a stylesheet. */
export function readDeclarations(css: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    // First definition wins: :root is authored before any override block.
    if (!out.has(m[1])) out.set(m[1], m[2].trim())
  }
  return out
}
