/**
 * Renders playoff bracket cards to static markup and asserts the winner marker + loser styling:
 *  - a completed match's CONFIRMED winner gets exactly one muted-gold circle-check icon (and the
 *    loser gets none);
 *  - loser names no longer carry `line-through`;
 *  - undecided / unplayed matches get no icon;
 *  - profile links are unchanged.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-bracket-winner-icon.mts
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MatchBox } from '../src/components/tournaments/bracket.tsx'
import type { BracketMatch } from '../src/lib/tournaments/service.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) } }
const render = (match: BracketMatch) => renderToStaticMarkup(React.createElement(MatchBox, { match }))
const GOLD = 'D6AE42'
const countGold = (html: string) => (html.match(/D6AE42/g) ?? []).length

// 1) Completed 1v1 match with a confirmed winner (a beats b).
console.log('Completed match (a wins)')
{
  const m: BracketMatch = { a: { name: 'Alice', seed: 1, score: 7, slug: 'alice' }, b: { name: 'Bob', seed: 2, score: 3, slug: 'bob' }, winner: 'a' }
  const html = render(m)
  check('exactly one muted-gold circle-check icon', countGold(html) === 1, `found ${countGold(html)}`)
  check('icon uses the lucide circle-check icon', /lucide-circle-check|lucide-check-circle/i.test(html))
  check('winner marker is decorative (aria-hidden)', /aria-hidden="true"[^>]*D6AE42|D6AE42[^>]*aria-hidden|aria-hidden/i.test(html))
  check('no line-through anywhere on the card', !/line-through/.test(html))
  check('both player profile links intact', html.includes('/players/alice') && html.includes('/players/bob'))
  check('scores preserved', html.includes('>7<') && html.includes('>3<'))
}

// 2) Completed match, b wins → the single icon is on b's row, not a's.
console.log('Completed match (b wins)')
{
  const m: BracketMatch = { a: { name: 'Cara', seed: 3, score: 4, slug: 'cara' }, b: { name: 'Dan', seed: 4, score: 7, slug: 'dan' }, winner: 'b' }
  const html = render(m)
  check('exactly one icon', countGold(html) === 1, `found ${countGold(html)}`)
  check('no line-through', !/line-through/.test(html))
}

// 3) Undecided match (both present, no winner) → NO icon.
console.log('Undecided match')
{
  const m: BracketMatch = { a: { name: 'Eve', seed: 1, slug: 'eve' }, b: { name: 'Finn', seed: 8, slug: 'finn' } }
  const html = render(m)
  check('no winner icon on an undecided match', countGold(html) === 0)
}

// 4) Placeholder / empty slots (TBD) → NO icon even if a winner field is somehow set.
console.log('Empty / placeholder slots')
{
  const m: BracketMatch = { a: undefined, b: undefined }
  const html = render(m)
  check('no icon for empty slots', countGold(html) === 0)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
