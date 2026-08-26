/**
 * No brown anywhere in the interface.
 *
 * ── Why a colour name is not the thing to grep for ───────────────────────────────────────────────
 * Nobody wrote `brown`. The brown arrived by arithmetic: the site's gold is a warm yellow, and a
 * warm yellow laid over a charcoal panel at 6–15% alpha does not render as a pale gold wash — it
 * mixes to olive-brown. Every muddy surface in this application came from a translucent gold or
 * amber FILL, so that is what this audit forbids.
 *
 * Gold on a border, an icon, a focus ring or a piece of text stays gold at any alpha, because there
 * is nothing behind it to mix with. Those are untouched, and they are how gold still does its work.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────────────────────────
 * Surfaces are neutral — void black, near-black, charcoal, grey. Gold is an accent. Red keeps its
 * meaning: danger, forfeits, destructive confirmation, and nothing decorative.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { readDeclarations, resolveToken, parseColor, isNeutral, hexToPolar } from './support/color.mts'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

function tsx(root: string): string[] {
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
const FILES = tsx('src')
const read = (f: string) => readFileSync(f, 'utf8')
/*
 * Class names live in code, not in prose.
 *
 * Several files explain in a comment why gold-over-charcoal is avoided — the word "brown" appears in
 * them precisely because the colour does not. Stripping comments keeps the audit about what renders.
 */
const codeOf = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const hits = (re: RegExp) => FILES.filter((f) => re.test(read(f))).map((f) => f.replace('src/', ''))

const CSS = read('src/app/(frontend)/globals.css')

try {
  section('No translucent warm fill survives')
  const goldVarFill = hits(/bg-\[var\(--gold[a-z-]*\)\]\/\[?[\d.]+\]?/)
  check('no gold CSS-variable fill at alpha', goldVarFill.length === 0, goldVarFill.join(', '))
  const goldUtilFill = hits(/bg-(gold|brand)[a-z-]*\/\[?[\d.]+\]?/)
  check('no gold or brand utility fill at alpha', goldUtilFill.length === 0, goldUtilFill.join(', '))

  /*
   * The same mud, in a different syntax.
   *
   * `bg-[color-mix(in_oklab,var(--gold)_12%,transparent)]` is a translucent gold fill written the
   * long way round, and the alpha-slash check walks straight past it. It was hiding on the bracket
   * row hover state.
   */
  const mixFill = hits(/bg-\[color-mix\([^\]]*var\(--(gold|brand)[a-z-]*\)[^\]]*\)\]/)
  check('no gold fill written as a color-mix', mixFill.length === 0, mixFill.join(', '))

  section('No brown-adjacent palette is used at all')
  for (const [name, re] of [
    ['amber', /\b(bg|text|border|ring|from|to|via)-amber-\d+/],
    ['yellow', /\b(bg|text|border|ring|from|to|via)-yellow-\d+/],
    ['orange', /\b(bg|text|border|ring|from|to|via)-orange-\d+/],
    ['stone', /\b(bg|text|border|ring)-stone-\d+/],
  ] as const) {
    const found = hits(re)
    check(`no ${name} utility anywhere`, found.length === 0, found.slice(0, 4).join(', '))
  }
  const named = FILES.filter((f) => /\b(brown|bronze|sepia|tan-\d|copper)\b/i.test(codeOf(f)))
    .map((f) => f.replace('src/', ''))
  check('no brown, bronze, sepia, tan or copper by name', named.length === 0, named.join(', '))

  /*
   * Hex literals, judged by what colour they actually are.
   *
   * The Top 10 panel carried `bg-[#b08d57]/15` for third place - a bronze at 15% over a dark panel,
   * which is precisely the arithmetic every other check in this file exists to forbid. It survived
   * because the earlier rules all looked for the WORD gold or a --gold token, and this was neither:
   * it was a raw hex value that happened to be brown.
   *
   * So the colour is parsed and its hue is measured. Anything warm (roughly orange through yellow)
   * that is neither bright nor near-black is a brown, whatever it is called and however it is
   * spelled. Bright warm values are the acid and the championship gold and are allowed; very dark
   * ones are effectively black.
   */
  /*
   * The same fill, written as a gradient.
   *
   * `bg-[radial-gradient(...,color-mix(in oklch,var(--gold) 11%,transparent),...)]` is a translucent
   * gold laid over a dark card, which is exactly what every other rule here forbids - but none of
   * them saw it, because they look for `bg-gold/40` or `bg-[var(--gold)]/10` and this is neither.
   * The Season champion strip carried the largest instance of it in the interface for months.
   *
   * A gradient in a BORDER, a shadow or an icon fill is untouched: those sit above the surface or
   * are the thing itself, and cannot mix with what is behind them.
   */
  section('No warm colour is mixed into a background')
  {
    const mixed: string[] = []
    for (const file of FILES) {
      for (const m of codeOf(file).matchAll(/\bbg-\[[^\]]*color-mix\([^\]]*--(gold|acid|warning)[^\]]*\]/g)) {
        mixed.push(`${file.replace('src/', '')}: ${m[0].slice(0, 80)}`)
      }
    }
    check('no background mixes a warm token into a gradient or a tint',
      mixed.length === 0, mixed.slice(0, 4).join(' | '))
  }

  section('No hex literal is a brown')
  {
    const suspects: string[] = []
    for (const file of FILES) {
      for (const m of codeOf(file).matchAll(/#[0-9a-f]{6}\b/gi)) {
        const polar = hexToPolar(m[0])
        if (!polar) continue
        const warm = polar.h >= 40 && polar.h <= 105
        const midTone = polar.l > 0.25 && polar.l < 0.78
        const chromatic = polar.c > 0.03
        if (warm && midTone && chromatic) {
          suspects.push(`${file.replace('src/', '')}: ${m[0]} (L=${polar.l.toFixed(2)} h=${polar.h.toFixed(0)})`)
        }
      }
    }
    check('no mid-tone warm hex value is used anywhere', suspects.length === 0, suspects.slice(0, 6).join(' | '))
  }

  section('The semantic surfaces exist, and they are neutral')
  /*
   * Read through the notation, not around it.
   *
   * This used to regex `oklch(L C H)` straight out of the text. When the palette moved to exact hex
   * brand values that pattern stopped matching and the chroma assertion had nothing to measure —
   * the check reported `(?)` and failed, which was lucky: written slightly differently it would
   * have passed on an empty match and protected nothing. Parsing the literal, and following
   * `var()` chains to reach it, keeps the same rule and makes it independent of how a colour is
   * spelled.
   */
  const DECLS = readDeclarations(CSS)
  for (const token of ['--selected-surface', '--drop-surface', '--attention-surface']) {
    check(`${token} is defined`, CSS.includes(`${token}:`))
    const literal = resolveToken(token, DECLS)
    const polar = literal ? parseColor(literal) : null
    check(`...and carries no meaningful chroma (${polar ? polar.c.toFixed(3) : literal ?? '?'})`,
      polar != null && isNeutral(polar))
  }
  /* One theme now. The light variant was removed, so each surface token is declared exactly once. */
  check('each is declared exactly once', (CSS.match(/--selected-surface:/g) ?? []).length === 1)

  section('Gold still works where it cannot muddy anything')
  const goldBorders = hits(/border-\[var\(--gold\)\]/)
  check(`gold is still used on borders (${goldBorders.length} files)`, goldBorders.length > 0)
  const goldText = hits(/text-\[var\(--gold\)\]/)
  check(`...and on text (${goldText.length} files)`, goldText.length > 0)
  const goldRing = hits(/ring-\[var\(--gold\)\]/)
  check(`...and on focus rings (${goldRing.length} files)`, goldRing.length > 0)

  section('Red keeps its meaning')
  /*
   * The failure mode of a colour cleanup is replacing every warm tint with red, which turns danger
   * into decoration. Destructive surfaces should be the only ones using it.
   */
  const destructive = hits(/destructive/)
  check(`the danger colour is still in use (${destructive.length} files)`, destructive.length > 0)
  const dangerWords = FILES.filter((f) => /destructive/.test(read(f)))
    .filter((f) => /delete|remove|forfeit|FF|danger|warning|error|refus/i.test(read(f)))
  check('...on files that talk about deletion, forfeits or errors',
    dangerWords.length >= Math.floor(destructive.length * 0.6),
    `${dangerWords.length}/${destructive.length}`)
} finally {
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
}

if (fail > 0) process.exitCode = 1
