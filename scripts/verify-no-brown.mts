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

  section('The semantic surfaces exist, and they are neutral')
  for (const token of ['--selected-surface', '--drop-surface', '--attention-surface']) {
    check(`${token} is defined`, CSS.includes(`${token}:`))
    /*
     * Neutral means almost no chroma. A surface token with real chroma is a tint by another name,
     * which is exactly the mistake this pass undid — so the number is checked, not just the name.
     */
    const m = new RegExp(`${token}:\\s*oklch\\([\\d.]+\\s+([\\d.]+)`).exec(CSS)
    check(`...and carries no meaningful chroma (${m?.[1] ?? '?'})`, m != null && Number(m[1]) <= 0.01)
  }
  check('both themes define them', (CSS.match(/--selected-surface:/g) ?? []).length === 2)

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
