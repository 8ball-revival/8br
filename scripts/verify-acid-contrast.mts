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

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

const CSS = readFileSync('src/app/(frontend)/globals.css', 'utf8')
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
