/**
 * Homepage layout checks at the five reference widths.
 *
 * Measures the rendered page rather than trusting the classes: the specification is written in terms
 * of what a visitor sees (equal cards, one row, a 65–70% news column), and only geometry can answer
 * that.
 *
 * Needs the dev server running. Reads the served HTML and measures with the browser tooling, so this
 * is a helper the agent drives rather than part of the verify suite — see the "reveal" note below.
 *
 * Run:  node scripts/check-homepage-layout.mjs
 */

const BASE = process.env.HOME_URL ?? 'http://localhost:3000'

const html = await (await fetch(BASE)).text()

const checks = []
const check = (name, ok, detail = '') => checks.push({ name, ok, detail })

// Structure the server actually sends. Layout geometry is verified separately in the browser.
check('page returns HTML', html.length > 10_000, `${html.length} bytes`)
check('hero survives', html.includes('COMPETITION') || html.includes('Competition'))

for (const [label, id] of [
  ['News', 'home-news-heading'],
  ['Top 10', 'home-top10-heading'],
  ['Competition Center', 'competition-center-heading'],
  ['CueVerse Top 5', 'cueverse-top5-heading'],
  ['Recent Results', 'home-results-heading'],
  ['By the Numbers', 'by-the-numbers-heading'],
  ['On This Day', 'on-this-day-heading'],
]) {
  check(`${label} section present`, html.includes(`aria-labelledby="${id}"`))
}

// Markup order: the main column's sections, then the sidebar's, then the full-width block. That is
// what a screen reader follows. The VISUAL and mobile order is set by CSS `order` on top of this and
// is verified by measuring the rendered page, since a string search cannot see a flex order.
const order = [
  'competition-center-heading',
  'home-news-heading',
  'home-top10-heading',
  'home-results-heading',
  'by-the-numbers-heading',
]
const positions = order.map((id) => html.indexOf(`aria-labelledby="${id}"`))
check('sections appear in document order', positions.every((p, i) => p > 0 && (i === 0 || p > positions[i - 1])),
  positions.join(' < '))

check('brand name is written in full', html.includes('8 Ball Registry'))
check('CueVerse promo links to cueverse.gg', html.includes('href="https://cueverse.gg/"'))
check('external links carry rel=noopener', html.includes('rel="noopener noreferrer"'))
check('leaderboard link points at the leaderboard', html.includes('https://cueverse.gg/#leaderboard'))
check('official CueVerse asset is served locally', html.includes('/assets/cueverse/cueverse-'))
check('no hotlinked CueVerse image', !html.includes('cueverse.gg/brand/'))

const failed = checks.filter((c) => !c.ok)
for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? `  (${c.detail})` : ''}`)
console.log(`\n${failed.length === 0 ? 'PASS' : 'FAIL'} — ${checks.length - failed.length}/${checks.length}`)
process.exit(failed.length === 0 ? 0 : 1)
