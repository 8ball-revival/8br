/**
 * The acid surface, and the one way it is allowed to carry text.
 *
 * ── Why this is its own audit ────────────────────────────────────────────────────────────────────
 * Acid yellow is now a SURFACE, not an accent — the navigation, the filter bars and the feature
 * panel are all built from it, which is what gives the interface its share of yellow. That makes a
 * mistake that did not previously exist possible: white text on acid.
 *
 * White on #d8dc2f is a contrast ratio of about 1.7:1. It is not "a bit low", it is unreadable, and
 * it is the single easiest error to make here because every other surface in the application takes
 * white text and the utility for it is on almost every component. So the rule is absolute — black
 * ink on acid, everywhere — and it is checked mechanically rather than trusted to review.
 *
 * ── What is measured ─────────────────────────────────────────────────────────────────────────────
 * Real WCAG ratios computed from the resolved token values, not a list of approved pairs. If
 * somebody retunes the palette the numbers move with it and this fails on the actual consequence.
 */
import { readFileSync, readdirSync } from 'node:fs'

import { readDeclarations, resolveToken, contrastRatio } from './support/color.mts'
import { checkAccent, hslToHex, readableInk, SEMANTIC_TOKENS } from '../src/lib/display/color.ts'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

const CSS = readFileSync('src/app/(frontend)/globals.css', 'utf8')
const SETTINGS = readFileSync('src/lib/display/settings.ts', 'utf8')
const DECLS = readDeclarations(CSS)
const tok = (name: string) => resolveToken(name, DECLS) ?? ''

function ratio(fg: string, bg: string): number | null {
  return contrastRatio(tok(fg), tok(bg))
}

/** AA for normal text. Large text is allowed 3:1, but nothing here relies on that. */
const AA = 4.5
/** AA for large text and for non-text boundaries that still have to be seen. */
const AA_LARGE = 3

section('Text on the acid surface is black, and readable')
{
  const r = ratio('--acid-ink', '--acid')
  check('the acid ink clears AA on acid', r != null && r >= AA, r ? `${r.toFixed(1)}:1` : 'unmeasurable')

  const white = contrastRatio(tok('--clean-white'), tok('--acid'))
  check('...and white on acid would NOT, which is why the rule exists',
    white != null && white < AA, white ? `${white.toFixed(1)}:1` : 'unmeasurable')

  check('the navigation ink is the acid ink', tok('--nav-foreground') === tok('--acid-ink'),
    `${tok('--nav-foreground')} vs ${tok('--acid-ink')}`)
  const nav = ratio('--nav-foreground', '--nav-bg')
  check('the navigation clears AA', nav != null && nav >= AA, nav ? `${nav.toFixed(1)}:1` : 'unmeasurable')

  const prim = ratio('--primary-foreground', '--primary')
  check('a primary button clears AA', prim != null && prim >= AA, prim ? `${prim.toFixed(1)}:1` : 'unmeasurable')
}

section('Any accent a reader can reach stays readable')
{
  /*
   * The four locked accent buttons are gone. Colour Lab offers the whole HSL space instead, which
   * removes the old audit's subject — there is no list of palettes to enumerate — and replaces it
   * with a harder question: is EVERY colour a reader can now choose still readable?
   *
   * It has to be, because --acid is a SURFACE. The navigation, the filter bars, the buttons and the
   * feature panel are filled with it and carry text on top, so an accent is not a preference about
   * appearance alone — it decides whether those words can be read. The guarantee is therefore not "we
   * picked four safe colours" but "the ink is measured, and an unreachable pairing is reported with a
   * correction". This checks the machinery that makes that true, by running it.
   */
  const ink = tok('--acid-ink')
  const DISPLAY = readFileSync('src/app/(frontend)/display.css', 'utf8')
  const LAB = readFileSync('src/components/display/display-lab.tsx', 'utf8')
  /*
   * The contrast warning lives on the PICKER now, beside the colour being chosen, rather than in the
   * panel that hosts it. That is where it belongs: the moment a reader can see the problem is the
   * moment they are looking at the square that caused it.
   */
  const PICKER = readFileSync('src/components/display/color-picker.tsx', 'utf8')

  check('the default accent is the white pearl', /--acid:\s*#f5f4f1/i.test(CSS.slice(CSS.indexOf(':root'), CSS.indexOf(':root') + 4000)))
  check('...and the panel agrees, so no reader sees one accent before the script runs and another after',
    SETTINGS.includes("accentHex: '#f5f4f1'") && SETTINGS.includes("accentInk: '#050607'"))

  /*
   * A sweep of the space a reader can actually reach, not a sample of approved values.
   *
   * Every 15° of hue at three saturations and nine lightnesses: 648 colours. For each, the ink the
   * panel WOULD choose is computed by the shipped function and measured. Anything that fails must be
   * offered a correction that passes — an unreadable colour is allowed to exist, being told nothing
   * about it is not.
   */
  let sweepFailures = 0
  let uncorrectable = 0
  let flagged = 0
  for (let h = 0; h < 360; h += 15) {
    for (const sat of [35, 70, 100]) {
      for (let l = 10; l <= 90; l += 10) {
        const hex = hslToHex({ h, s: sat, l })
        const result = checkAccent(hex)
        const measured = contrastRatio(result.ink, hex)
        if (measured == null) { sweepFailures++; continue }
        // The ink the panel picks is the better of the two, always.
        const other = result.ink === '#050607' ? '#f5f7f8' : '#050607'
        const alternative = contrastRatio(other, hex)
        if (alternative != null && alternative > measured + 0.001) sweepFailures++
        // A failing colour must be flagged AND given a passing suggestion.
        if (measured < AA) {
          flagged++
          if (!result.suggestion) uncorrectable++
          else {
            const fixed = contrastRatio(readableInk(result.suggestion), result.suggestion)
            if (fixed == null || fixed < AA) uncorrectable++
          }
        }
      }
    }
  }
  check('the ink chosen for an accent is always the more readable of the two', sweepFailures === 0,
    `${sweepFailures} of 648 colours would be inked the wrong way`)
  check('...the sweep really does contain unreadable colours, so this is not vacuous', flagged > 0,
    `${flagged} of 648 fall below AA`)
  check('...and every one of them is offered a shade that passes', uncorrectable === 0,
    `${uncorrectable} flagged colours had no working suggestion`)

  check('the picker warns rather than silently accepting a failing accent',
    PICKER.includes('checkAccent') && /under the 4\.5:1/.test(PICKER))
  check('...and offers the correction as one action', PICKER.includes('Use the nearest readable shade'))
  check('...with the ink measured at every write, never chosen',
    (LAB.match(/readableInk\(/g) ?? []).length >= 2 && !/accentInk:\s*['"]#(?!050607)/.test(LAB))

  /*
   * The accent may repoint STRUCTURE and nothing else.
   *
   * Danger, success, warning, championship gold and the qualification states carry meaning — a title
   * won, a match lost, a place secured. A reader who prefers a green interface must not see green
   * qualification markers everywhere, because the marker would have stopped being a marker. So the
   * custom-accent rule is read out of the stylesheet and checked for them by name.
   */
  const accentRule = /\[data-dl-accent-mode='custom'\]\s*\{([\s\S]*?)\}/.exec(DISPLAY)?.[1] ?? ''
  check('a custom accent rule exists', accentRule.length > 0)
  for (const semantic of SEMANTIC_TOKENS) {
    check(`...and it does not repoint ${semantic}`, !new RegExp(`${semantic}\s*:`).test(accentRule))
  }
  const repointed = [...accentRule.matchAll(/^\s*(--[a-z-]+)\s*:/gm)].map((m) => m[1])
  check('...it repoints only the acid family',
    repointed.length > 0 && repointed.every((t) => t.startsWith('--acid')), repointed.join(', '))

  /*
   * The rating bands are NAMES, and the accent does not get to rename them. `--tier-gold` read
   * var(--acid) once, which made the Gold band white on this default and red on the red accent —
   * where it also collided with the red reserved for first place. Every band colour is a literal.
   */
  for (const band of ['gold', 'purple', 'blue', 'green', 'grey']) {
    const value = tok(`--tier-${band}`)
    check(`the ${band} band is a literal, not the accent`, /^#[0-9a-f]{3,8}$/i.test(value), value)
  }
  check('...and gold is still the colour it has always rendered as', tok('--tier-gold').toLowerCase() === '#d8dc2f')
  check('...the acid ink still clears AA on the default accent',
    (contrastRatio(ink, tok('--acid')) ?? 0) >= AA)
}

section('Text on the dark grounds is readable')
{
  for (const [fg, bg, label] of [
    ['--foreground', '--background', 'body text on the page ground'],
    ['--foreground', '--card', 'body text on a panel'],
    ['--muted-foreground', '--background', 'secondary text on the page ground'],
    ['--muted-foreground', '--card', 'secondary text on a panel'],
    ['--cyan', '--background', 'a link on the page ground'],
    ['--cyan', '--card', 'a link on a panel'],
    ['--gold', '--background', 'a championship value on the page ground'],
    ['--gold', '--card', 'a championship value on a panel'],
  ] as const) {
    const r = ratio(fg, bg)
    check(`${label} clears AA`, r != null && r >= AA, r ? `${r.toFixed(1)}:1` : 'unmeasurable')
  }

  /*
   * Red is held to the large/non-text threshold on purpose.
   *
   * It is the technical linework colour — clipped corners, rails, live dots, arrows — and those are
   * shapes rather than prose. Where red carries actual words it is a heading or a short label at
   * display size, which AA treats as large text. Demanding 4.5:1 of it would push it pink and cost
   * the interface the one colour that reads as a warning.
   */
  const red = ratio('--hot-red', '--background')
  check('the technical red clears the large-text threshold',
    red != null && red >= AA_LARGE, red ? `${red.toFixed(1)}:1` : 'unmeasurable')
}

section('Nothing puts light text on an acid background')
{
  function tsxFiles(root: string): string[] {
    const out: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${e.name}`
        if (e.isDirectory()) walk(full)
        else if (/\.tsx$/.test(e.name)) out.push(full)
      }
    }
    walk(root)
    return out
  }

  /*
   * Scanned per class STRING rather than per file.
   *
   * A file is allowed to contain an acid panel and, elsewhere, white text on graphite. The error is
   * the two appearing on the same element, so the unit of judgement is one quoted class list.
   */
  /*
   * `(?![\w-])` rather than `\b` at the end of each alternative.
   *
   * A word boundary needs a word character on one side, and these utilities end in `]`. Against
   * `text-[var(--acid-ink)] font-bold` there is no boundary between the `]` and the space, so every
   * arbitrary-value utility silently failed to match and the audit reported correctly-inked buttons
   * as violations. The lookahead asks the question that was actually meant: is the utility finished?
   */
  const ACID_BG = /(?:^|[\s'"`])(bg-\[var\(--acid[a-z-]*\)\]|bg-nav-bg|bg-primary|bg-brand)(?![\w\-/])/
  const LIGHT_TEXT = /(?:^|[\s'"`])(text-white|text-foreground|text-\[var\(--clean-white\)\]|text-\[var\(--foreground\)\]|text-card-foreground|text-muted-foreground)(?![\w-])/

  const offenders: string[] = []
  for (const file of tsxFiles('src')) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/(?:className|class)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g)) {
      const cls = m[1] ?? m[2] ?? m[3] ?? ''
      if (ACID_BG.test(cls) && LIGHT_TEXT.test(cls)) {
        offenders.push(`${file.replace('src/', '')}: ${cls.slice(0, 90)}`)
      }
    }
  }
  check('no element sets an acid background and light text together',
    offenders.length === 0, offenders.slice(0, 5).join(' | '))

  /*
   * The inverse mistake: an acid surface that carries text but names no ink inherits white from the
   * page and fails just as badly.
   *
   * Scoped to elements that actually STYLE TEXT - a size or a weight utility on the same element.
   * An acid element with no typography on it is a rule, a dot or a progress bar, and demanding an
   * ink colour of those produced nothing but noise. Where such an element does contain text the
   * text sits on a child that states its own colour, and the first check above governs that child.
   */
  const ACID_INK = /(?:^|[\s'"`])(text-\[var\(--acid-ink\)\]|text-black|text-nav-foreground|text-primary-foreground|text-brand-foreground|text-\[var\(--void\)\])(?![\w-])/
  const STYLES_TEXT = /\b(text-(xs|sm|base|lg|xl|\dxl)|font-(medium|semibold|bold|display))\b/
  const inkless: string[] = []
  for (const file of tsxFiles('src')) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/(?:className|class)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g)) {
      const cls = m[1] ?? m[2] ?? m[3] ?? ''
      if (ACID_BG.test(cls) && STYLES_TEXT.test(cls) && !ACID_INK.test(cls)) {
        inkless.push(`${file.replace('src/', '')}: ${cls.slice(0, 90)}`)
      }
    }
  }
  check('every text-bearing acid surface names its own black ink',
    inkless.length === 0, inkless.slice(0, 5).join(' | '))

  /*
   * And no acid surface is translucent.
   *
   * Acid at 40% over the void ground does not render as a paler yellow, it renders as olive. The
   * header and the footer both did exactly this, which is how a yellow interface turns brown.
   */
  const faded: string[] = []
  for (const file of tsxFiles('src')) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/\b(bg-nav-bg|bg-brand|bg-primary|bg-\[var\(--acid\)\])\/\[?\d/g)) {
      faded.push(`${file.replace('src/', '')}: ${m[0]}`)
    }
  }
  check('no acid surface is drawn at partial alpha', faded.length === 0, faded.slice(0, 5).join(' | '))
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
