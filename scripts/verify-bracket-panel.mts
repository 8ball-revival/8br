/**
 * The Season playoff bracket panel: markup, geometry, and the behaviours that make a large bracket
 * usable — round lanes with match counts, seed badges everywhere, the champion's route, the
 * highlight hooks, keyboard reach, and scrolling that stays inside the panel.
 *
 * Rendered to static markup, so this asserts what the browser is actually given.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-bracket-panel.mts
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import {
  SeasonBracketPanel, fitScaleFor, naturalBracketWidth, minimumBracketWidth, MIN_SCALE, BRACKET_METRICS,
} from '../src/components/seasons/season-bracket-panel.tsx'
import type { BracketRound } from '../src/lib/tournaments/service.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) }
}

/** A complete single-elimination bracket for `size` players, seeded 1..size. */
function bracketOf(size: number): BracketRound[] {
  const NAMES = (i: number) => `player_${String(i).padStart(2, '0')}`
  const roundName = (remaining: number) =>
    remaining === 2 ? 'Final' : remaining === 4 ? 'Semifinals' : remaining === 8 ? 'Quarterfinals' : `Round of ${remaining}`

  const rounds: BracketRound[] = []
  // Seeds advance in order, so the champion is always seed 1 and their route spans every round.
  let alive = Array.from({ length: size }, (_, i) => i + 1)
  while (alive.length > 1) {
    const matches = []
    const next: number[] = []
    for (let i = 0; i < alive.length; i += 2) {
      const hi = alive[i], lo = alive[i + 1]
      next.push(hi)
      matches.push({
        a: { name: NAMES(hi), handle: NAMES(hi), slug: NAMES(hi), seed: hi, score: 7 },
        b: { name: NAMES(lo), handle: NAMES(lo), slug: NAMES(lo), seed: lo, score: 3 },
        winner: 'a' as const,
      })
    }
    rounds.push({ name: roundName(alive.length), matches })
    alive = next
  }
  return rounds
}

const CHAMPION = {
  cueverseId: 'player_01',
  preferredName: 'Ada',
  runnerUp: 'player_02',
  finalScore: '7–3',
}

const render = (rounds: BracketRound[], note: string | null, champion: typeof CHAMPION | null) =>
  renderToStaticMarkup(React.createElement(SeasonBracketPanel, { rounds, note, champion }))

console.log('--- A 16-player bracket ---')
{
  const html = render(bracketOf(16), 'Scores were not archived for this season.', CHAMPION)

  check('the whole bracket is one panel', (html.match(/aria-label="Playoff bracket"/g) ?? []).length === 1)
  check('it carries a compact heading', html.includes('Playoff Bracket'))
  check('there is one lane per round', (html.match(/bp-lane /g) ?? []).length === 4)

  for (const [label, count] of [['Round of 16', 8], ['Quarterfinals', 4], ['Semifinals', 2], ['Final', 1]] as const) {
    const unit = count === 1 ? 'match' : 'matches'
    check(`the ${label} lane is labelled with its match count`,
      new RegExp(`${label}[\\s\\S]{0,120}?${count}[\\s\\S]{0,20}?${unit}`).test(html))
  }

  // Every interactive player row must announce a seed. Read the labels out and check them, rather
  // than trying to express "no row without a seed" as one negative-lookahead regex.
  const labels = [...html.matchAll(/<div data-player="[^"]*"[^>]*aria-label="([^"]*)"/g)].map((m) => m[1])
  check('every player row is seeded',
    labels.length === 30 && labels.every((l) => /, seed \d+/.test(l)),
    `${labels.filter((l) => !/, seed \d+/.test(l)).length} of ${labels.length} without a seed`)
  const seeds = [...html.matchAll(/, seed (\d+)/g)].map((m) => Number(m[1]))
  check('all sixteen seeds appear', new Set(seeds).size === 16, `${new Set(seeds).size} distinct`)
  check('seed 1 appears in every round they reached',
    (html.match(/, seed 1,/g) ?? []).length === 4, String((html.match(/, seed 1,/g) ?? []).length))

  check('the note is a footer strip inside the panel, not a detached box',
    html.includes('Scores were not archived') && html.lastIndexOf('Scores were not archived') > html.lastIndexOf('bp-lane'))
  check('the Final gets its own treatment', html.includes('bp-final') && html.includes('Season Champion'))
  check('the Final shows both players and their scores on its own rows, so nothing is repeated',
    html.includes('player_01') && html.includes('player_02') && !/def\. <span/.test(html))
  check('the champion route is marked on every round it passes through',
    (html.match(/bp-path-champ/g) ?? []).length === 4, String((html.match(/bp-path-champ/g) ?? []).length))
}

console.log('')
console.log('--- Keyboard and assistive reach ---')
{
  const html = render(bracketOf(16), null, CHAMPION)
  const rows = [...html.matchAll(/<div data-player="([^"]+)"[^>]*>/g)].map((m) => m[0])
  check('every player row is reachable by keyboard', rows.length > 0 && rows.every((r) => r.includes('tabindex="0"')))
  check('every player row announces itself', rows.every((r) => /aria-label="/.test(r)))
  check('the highlight state is announced, not just painted', rows.every((r) => /aria-pressed="/.test(r)))
  check('rows carry the identity hook the highlighting delegates on',
    rows.every((r) => /data-player="[^"]+"/.test(r)))
  check('a bye is not presented as an interactive player', !/data-player="Bye"/.test(html))
}

console.log('')
console.log('--- A 32-player bracket switches to the tighter geometry ---')
{
  const wide = render(bracketOf(16), null, null)
  const big = render(bracketOf(32), null, null)

  check('the larger field renders every round', (big.match(/bp-lane /g) ?? []).length === 5)
  check('a 16-player bracket uses the roomier card', wide.includes('--bp-card-w:208px'))
  check('a 32-player bracket narrows the card', big.includes('--bp-card-w:190px'))
  check('rows shorten too', big.includes('--bp-row-h:36px') && wide.includes('--bp-row-h:38px'))
  check('spacing tightens with them',
    big.includes('--bp-match-gap:8px') && big.includes('--bp-lane-gap:20px'))
  // Compact cards: the earlier 278/254 pair, reduced by about a quarter.
  check('a large field sits near 190px',
    Number(/--bp-card-w:(\d+)px/.exec(big)![1]) >= 185 && Number(/--bp-card-w:(\d+)px/.exec(big)![1]) <= 200)
  check('a 16-player field sits near 208px',
    Number(/--bp-card-w:(\d+)px/.exec(wide)![1]) >= 200 && Number(/--bp-card-w:(\d+)px/.exec(wide)![1]) <= 215)
  check('both are about a quarter narrower than the original 278/254',
    Math.abs(Number(/--bp-card-w:(\d+)px/.exec(wide)![1]) / 278 - 0.75) < 0.03 &&
    Math.abs(Number(/--bp-card-w:(\d+)px/.exec(big)![1]) / 254 - 0.75) < 0.03)
  check('all 32 seeds are rendered',
    new Set([...big.matchAll(/, seed (\d+)/g)].map((m) => Number(m[1]))).size === 32)
}

console.log('')
console.log('--- Scrolling stays inside the panel ---')
{
  const html = render(bracketOf(32), null, null)
  check('the panel owns exactly one horizontal scroller',
    (html.match(/overflow-x-auto/g) ?? []).length === 1)
  check('the panel itself clips rather than pushing the page wider',
    /aria-label="Playoff bracket"[^>]*class="[^"]*overflow-hidden/.test(html))

  const css = readFileSync('src/app/(frontend)/globals.css', 'utf8')
  check('round headings stay put while a wide bracket moves',
    /\.bp-lane-head\s*\{[\s\S]{0,200}?background/.test(css) && html.includes('sticky top-0'))
}

console.log('')
console.log('--- Fit Bracket, and the theme ---')
{
  const panel = readFileSync('src/components/seasons/season-bracket-panel.tsx', 'utf8')
  const controls = readFileSync('src/components/seasons/season-controls.tsx', 'utf8')
  const css = readFileSync('src/app/(frontend)/globals.css', 'utf8')

  // The bracket sizes itself, so the Playoffs view offers no sizing controls at all.
  check('no Fit Bracket control remains', !controls.includes('FitBracket'))
  check('Zoom is offered on the Groups view only', controls.includes("view === 'groups' && <Zoom />"))
  check('the bracket takes no instructions from the toolbar', !panel.includes('8br:bracket-'))
  check('Fit measures the real panel width and computes the bracket width from its geometry',
    panel.includes('scroller.clientWidth') && panel.includes('naturalBracketWidth'))
  check('Fit never scales a bracket up past its natural size', panel.includes('Math.min(1,'))
  check('the bracket reports when it has scaled itself', panel.includes('Scaled to'))
  check('a fitted bracket refits whenever the panel changes size', panel.includes('new ResizeObserver(autoFit)'))

  check('ordinary connectors are the muted gray-gold', /--bp-line: color-mix\(in oklch, var\(--gold\)[^;]*var\(--muted-foreground\)/.test(css))
  check('the champion route is brighter', /--bp-line-champ: color-mix\(in oklch, var\(--gold\) 70%/.test(css))
  check('dimming stops well short of unreadable',
    /\.bp-muted \{ opacity: 0\.4[0-9]; \}/.test(css))
  check('no crimson anywhere in the bracket',
    !/crimson|--brand\b|#dc2626|red-[456]00/.test(panel))
  check('the Final glows softly rather than being ringed',
    /\.bp-final \{\s*box-shadow: 0 0 26px -10px/.test(css) && !/\.bp-final \{[^}]*0 0 0 1px/.test(css))
  check('only the champion’s own row is marked, not the tie',
    /\.bp-champion-row \{\s*box-shadow: inset 2px 0 0 var\(--gold\)/.test(css))
}

console.log('')
console.log('--- Cards resize with the window before anything is scaled ---')
{
  const html = render(bracketOf(16), null, CHAMPION)
  const css = readFileSync('src/app/(frontend)/globals.css', 'utf8')
  const wide = BRACKET_METRICS.metricsFor(16)
  const tight = BRACKET_METRICS.metricsFor(32)

  check('a card fills its lane rather than holding a fixed width',
    /class="bp-card w-full/.test(html) && !/style="width:var\(--bp-card-w\)"/.test(html))
  check('lanes share out the panel width', /\.bp-lane \{[^}]*flex: 1 1 auto;/s.test(css))
  check('a lane may shrink to the readable minimum',
    /\.bp-lane \{[^}]*min-width: calc\(var\(--bp-card-min\) \+ var\(--bp-lane-gap\)\)/s.test(css))
  check('and grow no wider than the comfortable size',
    /\.bp-lane \{[^}]*max-width: calc\(var\(--bp-card-w\) \+ var\(--bp-lane-gap\)\)/s.test(css))
  check('the Final gets no extra width', !/\.bp-lane:last-child \{[^}]*max-width/s.test(css))
  check('both card sizes are published to CSS',
    html.includes('--bp-card-w:208px') && html.includes('--bp-card-min:143px'))
  check('a large field flexes over a narrower range',
    render(bracketOf(32), null, null).includes('--bp-card-min:132px'))

  // The type does not shrink while the cards are still flexing — that is the whole point.
  check('a card can shrink by roughly a third before anything else gives',
    wide.cardMin / wide.cardW < 0.72 && wide.cardMin / wide.cardW > 0.6,
    `${Math.round((wide.cardMin / wide.cardW) * 100)}%`)
  check('the minimum card is still wide enough for a name and a score', wide.cardMin >= 138)
  check('the tighter geometry keeps a usable minimum too', tight.cardMin >= 128)

  // Flex first, then scale, then scroll.
  const floor16 = minimumBracketWidth(4, wide)
  const natural16 = naturalBracketWidth(4, wide)
  check('the flexing range is real', floor16 < natural16, `${floor16} .. ${natural16}`)
  check('no scaling while the cards can still flex', fitScaleFor(natural16, floor16) === 1)
  check('no scaling right down to the minimum width', fitScaleFor(floor16 + 2, floor16) === 1)
  check('scaling begins only below that', fitScaleFor(floor16 - 100, floor16) < 1)
  check('and still stops at the legibility floor', fitScaleFor(120, floor16) === MIN_SCALE)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
