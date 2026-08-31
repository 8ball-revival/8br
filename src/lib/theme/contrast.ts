import { contrastRatio, parseHex, AA_NORMAL } from '@/lib/display/color'
import { THEME_TOKEN_REGISTRY, TOKEN_BY_KEY, type ThemeToken } from './registry'

/**
 * Every foreground/background pairing this site can actually put on a screen.
 *
 * ── Why a declared list rather than a crawl ─────────────────────────────────────────────────────
 * A browser sweep finds what is on the page it happens to be looking at, in the state it happens to
 * be in. It does not find the disabled control three clicks away, the hovered row nobody hovered, or
 * the empty state that needs no data to exist. Those are exactly where text goes invisible, because
 * they are exactly what nobody checks.
 *
 * So the pairings are written down. The browser sweep still runs — it catches pairings nobody
 * declared — but the gate that BLOCKS a publish is this list, because it is the one that covers
 * states a crawl cannot reach.
 *
 * ── essential vs decorative ─────────────────────────────────────────────────────────────────────
 * Essential means a reader cannot use the site if it fails: a navigation item, a table value, a
 * button label, a heading. Those block. Decorative means the design is worse but nothing is lost: a
 * hairline, a watermark, a disabled control that is meant to recede. Those warn.
 *
 * Disabled controls are a deliberate special case. WCAG exempts them, and forcing them to 4.5:1
 * makes them look enabled — which is a worse failure than the one being prevented. They are held to
 * a floor that keeps them IDENTIFIABLE rather than readable.
 */
export type Weight = 'essential' | 'decorative' | 'disabled'
export type TextSize = 'normal' | 'large' | 'nontext'

export interface Pairing {
  id: string
  /** What a person would call this. */
  where: string
  /** Registry keys. The foreground and the ground it is painted on. */
  fg: string
  bg: string
  weight: Weight
  size: TextSize
  /** The control an Owner should reach for when this fails. */
  blame: [string, string]
}

const P = (
  id: string, where: string, fg: string, bg: string,
  weight: Weight = 'essential', size: TextSize = 'normal',
): Pairing => ({ id, where, fg, bg, weight, size, blame: [fg, bg] })

export const PAIRINGS: Pairing[] = [
  // ── The page itself ───────────────────────────────────────────────────────────────────────────
  P('body-on-page', 'Body copy on the page', 'cleanWhite', 'void'),
  P('secondary-on-page', 'Supporting copy on the page', 'mutedText', 'void'),
  P('muted-on-page', 'Dates and metadata on the page', 'steel', 'void'),
  P('body-on-panel', 'Body copy on a panel', 'cleanWhite', 'graphite'),
  P('secondary-on-panel', 'Supporting copy on a panel', 'mutedText', 'graphite'),
  P('muted-on-panel', 'Dates and metadata on a panel', 'steel', 'graphite'),
  P('body-on-card', 'Values in a table row', 'cleanWhite', 'graphiteRaised'),
  P('muted-on-card', 'Quiet values in a table row', 'steel', 'graphiteRaised'),
  P('body-on-plaque', 'An achievement title', 'cleanWhite', 'plaque'),
  P('muted-on-plaque', 'The line under an achievement figure', 'steel', 'plaque'),
  P('muted-on-inset', 'Labels in the statistics bar', 'steel', 'inset'),
  P('label-on-page', 'Uppercase labels and eyebrows', 'steelBright', 'void'),
  P('label-on-panel', 'Uppercase labels on a panel', 'steelBright', 'graphite'),
  P('body-on-hover', 'A row under the pointer', 'cleanWhite', 'hover'),

  // ── Navigation ────────────────────────────────────────────────────────────────────────────────
  P('nav-current', 'The current page in the header', 'navActive', 'navBg', 'essential', 'normal'),
  P('nav-other', 'Other pages in the header', 'navInactive', 'navBg'),
  P('nav-wordmark', 'The wordmark in the header', 'navForeground', 'navBg', 'essential', 'large'),

  // ── Controls ──────────────────────────────────────────────────────────────────────────────────
  P('button-label', 'The label on a filled button', 'primaryInk', 'primary'),
  P('button-label-hover', 'A filled button under the pointer', 'primaryInk', 'primaryHover'),
  P('secondary-label', 'The label on a quiet control', 'secondaryInk', 'secondary'),
  /*
    Borders are decorative here, and that is a reading of 1.4.11 rather than a convenience.

    The criterion asks for 3:1 on a boundary REQUIRED to identify a control. Every input on this site
    also carries a label and a placeholder, every panel also differs from the page in fill, and every
    table rule separates rows that are already distinguishable by their content. Forcing 3:1 on all
    of them means borders roughly as bright as body text, which is a different design — and the one
    thing this system must not do is fix contrast by wrecking what it is protecting.

    They still warn, so a border that has genuinely disappeared is reported.
  */
  P('input-border', 'The edge of a search field', 'input', 'graphite', 'decorative', 'nontext'),
  P('focus-on-page', 'The focus ring on the page', 'ring', 'void', 'essential', 'nontext'),
  P('focus-on-panel', 'The focus ring on a panel', 'ring', 'graphite', 'essential', 'nontext'),
  /*
    The ring around a filled button is measured against the PAGE, not the button.

    Every filled action on this site draws its ring with `ring-offset-2 ring-offset-[var(--void)]`,
    so the ring sits in a gap of page colour outside the button rather than on top of it. Measuring
    it against the button was measuring a pair that never touch, and it blocked four presets for a
    contrast problem that does not exist on screen.
  */
  P('focus-on-action', 'The focus ring around a filled button', 'ring', 'void', 'essential', 'nontext'),

  // ── The accent, in both of its jobs ───────────────────────────────────────────────────────────
  P('accent-mark-page', 'Rank one, live dots and record labels', 'signal', 'void'),
  P('accent-mark-panel', 'The accent as a mark on a panel', 'signal', 'graphite'),
  P('accent-rule', 'Thin accent rules', 'signal', 'void', 'decorative', 'nontext'),

  // ── Meaning ───────────────────────────────────────────────────────────────────────────────────
  P('gold-on-page', 'A championship on the page', 'gold', 'void'),
  P('gold-on-plaque', 'An achievement figure', 'gold', 'plaque'),
  P('gold-on-card', 'A winning result in a table', 'gold', 'graphiteRaised'),
  P('success-on-panel', 'A confirmation', 'success', 'graphite'),
  P('warning-on-panel', 'A caution', 'warning', 'graphite'),
  P('info-on-panel', 'A link on a panel', 'info', 'graphite'),
  P('player-on-card', 'A player identity in a table', 'playerName', 'graphiteRaised'),
  P('player-on-panel', 'A player identity on a panel', 'playerName', 'graphite'),

  // ── The filter bar, which is a light surface by design ────────────────────────────────────────
  P('filterbar-text', 'Text on the filter bar', 'acidInk', 'acid'),

  // ── Competition ───────────────────────────────────────────────────────────────────────────────
  P('bracket-name', 'An identity in a bracket', 'cleanWhite', 'bracketSurface'),
  P('bracket-advancing', 'The advancing side of a bracket', 'bracketWinner', 'bracketSurface'),
  P('bracket-tbd', 'An undecided bracket slot', 'bracketMuted', 'bracketSurface', 'disabled'),
  P('bracket-connector', 'Bracket connectors', 'bracketConnector', 'void', 'decorative', 'nontext'),

  // ── Structure ─────────────────────────────────────────────────────────────────────────────────
  P('border-on-page', 'A panel edge', 'lineStrong', 'void', 'decorative', 'nontext'),
  P('rule-on-panel', 'A table rule', 'line', 'graphite', 'decorative', 'nontext'),
  P('divider', 'Hairlines and grid marks', 'steelDim', 'void', 'decorative', 'nontext'),
  P('shadow-on-page', 'Depth under a panel', 'shadow', 'void', 'decorative', 'nontext'),

  // ── Homepage ──────────────────────────────────────────────────────────────────────────────────
  P('hero-heading', 'The hero heading over the photograph', 'heroInk', 'scrim', 'essential', 'large'),
  /*
    Hero copy is measured against the SCRIM, so it uses the on-media text token rather than the page
    text token. A light theme sets primary text to near-black — correct on paper, invisible over a
    darkened photograph — and this pairing is what catches the difference.
  */
  P('hero-body', 'Hero body copy over the photograph', 'heroInk', 'scrim'),
  P('rail-name', 'A name in the top-five rail', 'cleanWhite', 'void'),
  P('rail-rank-one', 'Rank one in the rail', 'signal', 'void', 'essential', 'large'),
  P('rail-divider', 'The angled cuts in the rail', 'railRule', 'void', 'decorative', 'nontext'),

  /*
    The roles that alias another one still get their own pairing.

    `--text-primary` is `var(--clean-white)` today and an Owner may break that — at which point
    "body copy on the page" is still passing while "an achievement title" is not. Checking the alias
    separately is what notices.
  */
  P('plaque-heading', 'An achievement or article heading', 'plaqueInk', 'plaque'),
  P('plaque-supporting', 'Supporting text on a plaque', 'plaqueMuted', 'plaque'),
  P('table-value', 'A value in a table row', 'cardInk', 'card'),
  P('accent-fill-ink', 'The label on the accent surface', 'signalInk', 'signalFill'),
  P('nav-rule', 'The rule under the header', 'navBorder', 'navBg', 'decorative', 'nontext'),
  P('media-copy', 'Any copy laid over a photograph', 'textOnMedia', 'scrim'),
  P('media-accent', 'A label or mark over a photograph', 'accentOnMedia', 'scrim'),
  P('stats-label', 'A label in the statistics bar', 'steel', 'statsBar'),
  P('stats-value', 'A total in the statistics bar', 'cleanWhite', 'statsBar'),
  P('footer-text', 'Text in the footer', 'mutedText', 'footerBg'),
  P('footer-heading', 'The site name in the footer', 'cleanWhite', 'footerBg'),
]

/** WCAG thresholds, by what the thing is. */
const NEEDED: Record<TextSize, number> = { normal: AA_NORMAL, large: 3, nontext: 3 }
/** A disabled control must stay distinguishable from its ground, not readable. */
const DISABLED_FLOOR = 2

export interface PairingResult extends Pairing {
  fgHex: string
  bgHex: string
  ratio: number
  needed: number
  passes: boolean
  /** Blocking failures stop a publish. Warnings do not. */
  verdict: 'pass' | 'warn' | 'block'
  aa: boolean
  aaa: boolean
}

/**
 * Resolve a token to a literal colour, FOLLOWING THE CASCADE.
 *
 * This is the part that was wrong first time round, and the bug it caused is instructive: the
 * stylesheet says `--bracket-winner: var(--gold)`, so overriding gold moves the advancing side of a
 * bracket with it. An engine that resolved `bracketWinner` straight to its built-in reported the
 * OLD gold against a new background and blocked a preset that was in fact perfectly readable.
 *
 * So a token with no override of its own inherits from whichever token declares it in `cascadesTo`.
 * That mirrors what the browser does, which is the only thing worth checking against — a contrast
 * engine that disagrees with the renderer is worse than none, because it is confidently wrong.
 *
 * Built once per call site rather than memoised: the map is 48 entries and the alternative is a
 * cache that can go stale against a registry edit.
 */
const inheritsFrom = (() => {
  const parent = new Map<string, string>()
  for (const token of THEME_TOKEN_REGISTRY) {
    for (const css of token.cascadesTo ?? []) {
      const child = THEME_TOKEN_REGISTRY.find((t) => t.css === css)
      if (child && child.key !== token.key) parent.set(child.key, token.key)
    }
  }
  return parent
})()

export function resolveToken(key: string, overrides: Record<string, string>, seen = new Set<string>()): string {
  const direct = overrides[key]?.trim()
  if (direct) return direct
  // A cycle in the registry would otherwise be an infinite loop rather than a visible mistake.
  if (seen.has(key)) return TOKEN_BY_KEY.get(key)?.fallback ?? '#000000'
  seen.add(key)
  const parent = inheritsFrom.get(key)
  if (parent) return resolveToken(parent, overrides, seen)
  return TOKEN_BY_KEY.get(key)?.fallback ?? '#000000'
}

/**
 * Every pairing, measured.
 *
 * A colour that cannot be parsed is reported as a failure rather than skipped: an unparseable value
 * in a published theme is a variable that resolves to nothing, and "nothing" inherits — which is how
 * text ends up the same colour as what is behind it.
 */
export function evaluate(overrides: Record<string, string>): PairingResult[] {
  return PAIRINGS.map((p) => {
    const fgHex = resolveToken(p.fg, overrides)
    const bgHex = resolveToken(p.bg, overrides)
    const parsed = parseHex(fgHex) && parseHex(bgHex)
    const ratio = parsed ? contrastRatio(fgHex, bgHex) : 0
    const needed = p.weight === 'disabled' ? DISABLED_FLOOR : NEEDED[p.size]
    const passes = ratio >= needed

    /*
      Near-identical is called out separately from merely low — but only where it means something.

      A ratio of 1.05 between TEXT and its ground is not "a bit under", it is text the same colour as
      its background, and it blocks whatever the pairing's weight. White on white and black on black
      both land here.

      For non-text decoration it means the opposite. A shadow on a near-black page measures about
      1.04:1 BY DESIGN — that is what a shadow is on a dark ground, and demanding otherwise would ask
      for a halo. So the rule is scoped to things somebody reads.
    */
    const invisible = ratio < 1.25 && p.size !== 'nontext'
    const verdict: PairingResult['verdict'] = passes
      ? 'pass'
      : (p.weight === 'essential' || invisible) ? 'block' : 'warn'

    return {
      ...p,
      fgHex, bgHex, ratio: Math.round(ratio * 100) / 100, needed, passes, verdict,
      aa: ratio >= (p.size === 'normal' ? 4.5 : 3),
      aaa: ratio >= (p.size === 'normal' ? 7 : 4.5),
    }
  })
}

export interface ThemeVerdict {
  results: PairingResult[]
  blocking: PairingResult[]
  warnings: PairingResult[]
  /** True when the theme may be published. */
  publishable: boolean
}

export function verdictFor(overrides: Record<string, string>): ThemeVerdict {
  const results = evaluate(overrides)
  const blocking = results.filter((r) => r.verdict === 'block')
  const warnings = results.filter((r) => r.verdict === 'warn')
  return { results, blocking, warnings, publishable: blocking.length === 0 }
}

/**
 * A colour that would fix a failing pairing, without redesigning it.
 *
 * Walks the foreground towards white and towards black in small steps and returns whichever reaches
 * the threshold first — so a nearly-readable grey gets lighter rather than becoming white, and the
 * suggestion still looks like the colour the Owner chose. Returns null when neither direction can
 * reach it, which means the BACKGROUND is the thing that has to move.
 */
export function suggestFor(result: PairingResult): string | null {
  const bg = parseHex(result.bgHex)
  const fg = parseHex(result.fgHex)
  if (!bg || !fg) return null

  const toward = (target: [number, number, number]) => {
    for (let step = 1; step <= 20; step++) {
      const t = step / 20
      const mixed: [number, number, number] = [
        Math.round(fg[0] + (target[0] - fg[0]) * t),
        Math.round(fg[1] + (target[1] - fg[1]) * t),
        Math.round(fg[2] + (target[2] - fg[2]) * t),
      ]
      const hex = `#${mixed.map((v) => v.toString(16).padStart(2, '0')).join('')}`
      if (contrastRatio(hex, result.bgHex) >= result.needed) return { hex, distance: t }
    }
    return null
  }

  const lighter = toward([255, 255, 255])
  const darker = toward([0, 0, 0])
  if (!lighter && !darker) return null
  if (!lighter) return darker!.hex
  if (!darker) return lighter.hex
  return lighter.distance <= darker.distance ? lighter.hex : darker.hex
}

/** Which registry tokens a failing pairing implicates, for linking a failure to its control. */
export function tokensFor(result: PairingResult): ThemeToken[] {
  return result.blame
    .map((k) => TOKEN_BY_KEY.get(k))
    .filter((t): t is ThemeToken => t != null)
}

/** Tokens that no pairing mentions — useful when adding a token, to notice it is unchecked. */
export function unpairedTokens(): string[] {
  const seen = new Set(PAIRINGS.flatMap((p) => [p.fg, p.bg]))
  return THEME_TOKEN_REGISTRY.filter((t) => !seen.has(t.key)).map((t) => t.key)
}
