/**
 * The colour contract, enforced.
 *
 * ── What this is protecting ──────────────────────────────────────────────────────────────────────
 * Gold used to be the brand. `--brand`, `--primary`, `--ring`, `--win` and `--player-name` all
 * resolved to the same gold, which made gold the navigation colour, the focus ring, the hover state,
 * the button, the link AND the champion — and a colour that marks everything marks nothing.
 *
 * It also made the site brown. Gold at 8-12% over dark charcoal does not read as pale gold; it mixes
 * to olive. Because gold was the brand, that wash landed on every hover, every selected row and
 * every attention surface, and no token was ever named brown so nobody could find it.
 *
 * These checks are what stop both from coming back: brand and achievement stay separate, and warm
 * literals stay out of the source.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (s: string) => console.log(`\n--- ${s} ---`)

const CSS = readFileSync('src/app/(frontend)/globals.css', 'utf8')

/** Every source file that can carry a colour. */
function sources(dir = 'src'): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...sources(p))
    else if (/\.(tsx?|css)$/.test(name)) out.push(p)
  }
  return out
}
const FILES = sources()

// ── The primitive layer ──────────────────────────────────────────────────────────────────────────
section('Colour is decided in one place')
{
  check('a primitive palette exists', /--c-void:/.test(CSS) && /--c-brand:/.test(CSS) && /--c-gold:/.test(CSS))
  check('the page canvas is void black', /--c-void:\s*#030304/i.test(CSS))
  check('the elevated surface is cool charcoal', /--c-elevated:\s*#0F1115/i.test(CSS))
  check('the brand is neon red', /--c-brand:\s*#FF1744/i.test(CSS))
  check('achievement gold is its own value', /--c-gold:\s*#F2C14E/i.test(CSS))
}

section('Brand and achievement are different colours')
{
  const role = (n: string) => new RegExp(`--${n}:\\s*var\\(--c-([a-z-]+)\\)`).exec(CSS)?.[1] ?? null
  const brandRoles = ['brand', 'primary', 'ring']
  for (const r of brandRoles) {
    const v = role(r)
    check(`--${r} points at the brand, not at gold`, v != null && v.startsWith('brand'), String(v))
  }
  check('--gold points at gold', role('gold')?.startsWith('gold') === true, String(role('gold')))
  /*
   * The one that actually caused the problem: a player's name is not an achievement, and colouring
   * every name gold is what made the whole site look like a trophy cabinet.
   */
  check('a player name is text, not gold', role('player-name') === 'text' || role('player-name') === 'l-text', String(role('player-name')))
}

// ── Forbidden warmth ─────────────────────────────────────────────────────────────────────────────
section('No brown, bronze, beige, olive or mustard')
{
  /*
   * Literals only, and only warm ones. Hue 20-110 with real chroma at a middling lightness is the
   * brown/bronze/olive band; gold lives there too, which is why the palette's own gold values are
   * allowed by name and nothing else is.
   */
  const ALLOWED = new Set(['#F2C14E', '#FFD76A', '#B98F2E', '#FF1744', '#FF4567', '#C1102F'])
  const offenders: string[] = []
  for (const f of FILES) {
    /*
     * Comments are stripped first, and a line marked THEME-EXEMPT is skipped.
     *
     * The first version of this check failed on its own documentation: the comment explaining why
     * bronze was removed quotes the bronze. And an email template genuinely cannot use a CSS
     * variable, so those few inlines are exempted BY NAME at the line that carries them rather than
     * by an exception buried here — a reviewer sees the exemption where the colour is.
     */
    const raw = readFileSync(f, 'utf8')
    const text = raw
      .split(String.fromCharCode(10))
      .filter((l) => !l.includes('THEME-EXEMPT'))
      .join(String.fromCharCode(10))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/<!--[\s\S]*?-->/g, '')
    for (const m of text.matchAll(/#([0-9a-fA-F]{6})\b/g)) {
      const hex = `#${m[1].toUpperCase()}`
      if (ALLOWED.has(hex)) continue
      const r = parseInt(m[1].slice(0, 2), 16), g = parseInt(m[1].slice(2, 4), 16), b = parseInt(m[1].slice(4, 6), 16)
      // Warm = red and green meaningfully above blue, and not near-black or near-white.
      const max = Math.max(r, g, b), min = Math.min(r, g, b)
      const warm = r > b + 24 && g > b + 12 && max > 60 && min < 240
      if (warm) offenders.push(`${f}: ${hex}`)
    }
  }
  check('no warm colour literal in the source', offenders.length === 0, offenders.slice(0, 6).join('; '))

  const named = FILES.filter((f) => /\b(bg|text|border)-(amber|yellow|orange|stone|warmGray)-/.test(readFileSync(f, 'utf8')))
  check('no warm Tailwind palette utilities', named.length === 0, named.slice(0, 4).join(', '))
}

section('Gold is not used as an interaction colour')
{
  const bad: string[] = []
  for (const f of FILES) {
    const t = readFileSync(f, 'utf8')
    /*
     * A focus ring and a hover state are interaction, and interaction is the brand's job. The prefix
     * is what classifies them, which is why this can be checked mechanically without guessing at
     * whether a given gold means "champion".
     */
    for (const m of t.matchAll(/(focus-visible:|focus:|hover:)(ring|border|text|bg|outline)-\[var\(--gold\)\]/g)) {
      bad.push(`${f}: ${m[0]}`)
    }
  }
  check('no focus or hover state is gold', bad.length === 0, bad.slice(0, 5).join('; '))
}

section('The bracket contract survives the theme')
{
  const prim = readFileSync('src/components/bracket/primitives.tsx', 'utf8')
  check('a winner is still gold', /--bracket-winner/.test(prim))
  check('the winning row is a rail, not a fill', /inset_2px_0_0_0_var\(--bracket-winner\)/.test(prim))
  check('no crown returned', !/lucide-crown/i.test(prim))
  check('the Final has no bloom', !/\.bp-final\b/.test(CSS))
  check('the winner token is gold, not brand', /--bracket-winner:\s*var\(--gold\)/.test(CSS))
  /* Focus inside a bracket is interaction, so it follows the brand rather than the winner colour. */
  check('bracket focus follows the brand', /--bracket-focus:\s*var\(--ring\)/.test(CSS))
}

section('Both themes still resolve')
{
  check('a light block exists', /\.light\s*\{/.test(CSS))
  const light = CSS.slice(CSS.indexOf('.light {'))
  check('light has its own neutrals', /--c-l-canvas|--background:\s*var\(--c-l-/.test(light))
  check('light gold is a gold, not a beige', /--gold:\s*var\(--c-gold-dim\)/.test(light))
  check('light brand is a red', /--brand:\s*var\(--c-brand-dim\)/.test(light))
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
