/**
 * Contrast checking for the theme editor.
 *
 * ── Why this is its own file ─────────────────────────────────────────────────────────────────────
 * It has to run in the BROWSER — the theme inspector recalculates as a colour is dragged, and a
 * round trip per pixel of a colour picker is not a thing anybody would ship. `globals.ts` is
 * `server-only` and imports Prisma, so the function cannot live there and be used by the inspector.
 * It is pure arithmetic over two hex strings, which makes it the easiest possible thing to move.
 *
 * ── Why the ratio is reported rather than enforced ───────────────────────────────────────────────
 * An administrator may have a reason — a decorative accent that never carries text, a brand colour
 * they are required to use. A builder that silently refused a colour would be harder to work with
 * than one that says what the ratio is and what it means. So this returns a number and a verdict,
 * and the editor shows both.
 */

/** WCAG relative luminance for a hex colour, or null if it cannot be read as one. */
function luminance(hex: string): number | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  const channels = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * The WCAG contrast ratio between two hex colours, 1 to 21.
 *
 * Null when either side is not a hex colour — a token left empty, or a CSS variable reference. The
 * caller resolves those to the built-in value first; reporting a made-up ratio for an unknown colour
 * would be worse than reporting nothing.
 */
export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a)
  const lb = luminance(b)
  if (la === null || lb === null) return null
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

export type ContrastLevel = 'AAA' | 'AA' | 'AA Large' | 'fail'

/**
 * What a ratio means, for the size of text it will actually be used at.
 *
 * `large` is WCAG's 18pt/14pt-bold threshold. A heading colour that fails at body size but passes at
 * heading size is genuinely fine for a heading, and flagging it would train an administrator to
 * ignore the flags.
 */
export function contrastLevel(ratio: number | null, large = false): ContrastLevel | null {
  if (ratio === null) return null
  if (ratio >= 7) return 'AAA'
  if (ratio >= 4.5) return 'AA'
  if (large && ratio >= 3) return 'AA Large'
  return 'fail'
}

export interface ContrastPair {
  /** What is being read, e.g. "Text". */
  label: string
  /** What it is being read on, e.g. "Page background". */
  on: string
  /** Whether this pairing is used at heading size, which relaxes the threshold to 3:1. */
  large: boolean
  ratio: number | null
  level: ContrastLevel | null
}

/**
 * The pairings a theme actually has to survive.
 *
 * Not every colour against every other — that produces forty rows nobody reads, most of them
 * meaningless (the border colour is never text on the accent colour). These are the combinations the
 * site really renders: body copy and muted copy on each of the three surfaces, and each accent on
 * the page background at heading size, which is where accents are used.
 *
 * `resolve` takes a token key and returns the colour in force — the published override if there is
 * one, otherwise the built-in fallback — so a theme that overrides two colours is still checked
 * against the eight it did not.
 */
export function themeContrastPairs(resolve: (key: string) => string): ContrastPair[] {
  const pair = (label: string, fg: string, on: string, bg: string, large = false): ContrastPair => {
    const ratio = contrastRatio(resolve(fg), resolve(bg))
    return { label, on, large, ratio, level: contrastLevel(ratio, large) }
  }
  /*
    The border tokens are deliberately not here.

    The site's hairlines sit at about 1.4:1 against the background on purpose — that is what makes
    them read as a seam rather than a rule. Listing them beside the text pairings would show two
    permanent failures that are not failures, and a panel with two rows nobody is meant to act on is
    a panel nobody reads. WCAG's 3:1 non-text requirement applies to boundaries that carry meaning,
    which these do not; the controls that do (focus rings, inputs) take their colour from the accent,
    which IS checked below.
  */
  return [
    pair('Text', 'foreground', 'Page background', 'background'),
    pair('Text', 'foreground', 'Card surface', 'card'),
    pair('Text', 'foreground', 'Panel surface', 'graphite'),
    pair('Muted text', 'muted', 'Page background', 'background'),
    pair('Muted text', 'muted', 'Card surface', 'card'),
    pair('Muted text', 'muted', 'Panel surface', 'graphite'),
    pair('Accent', 'accent', 'Page background', 'background', true),
    pair('Gold', 'gold', 'Page background', 'background', true),
    pair('Highlight', 'acid', 'Page background', 'background', true),
  ]
}
