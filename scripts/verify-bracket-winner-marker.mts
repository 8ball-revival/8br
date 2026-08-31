/**
 * Renders playoff bracket cards to static markup and asserts how the winner is marked.
 *
 * The marker used to be a gold circle-check icon beside the name. It is now the NAME and SCORE
 * themselves in gold, plus a warm wash on the winning row — the icon crowded a row that has to stay
 * compact, and the colour already said the same thing. The invariants are unchanged:
 *  - a completed match marks exactly one side, and it is the CONFIRMED winner (never inferred from
 *    the scores);
 *  - the loser is dimmed, never struck through;
 *  - undecided and empty matches mark nobody;
 *  - profile links and scores survive.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-bracket-winner-marker.mts
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MatchBox } from '../src/components/tournaments/bracket.tsx'
import type { BracketMatch } from '../src/lib/tournaments/service.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) } }
const render = (match: BracketMatch) => renderToStaticMarkup(React.createElement(MatchBox, { match }))

/** Rows carrying the winner treatment. Themed from the token, never a hardcoded hex. */
/*
 * A winner is now identified by `data-won`, and marked by a gold rail rather than a background
 * class. The loser carries nothing at all — losing a frame of pool is not a state that needs
 * painting, so there is no longer a losing-row marker to count; its absence is the assertion.
 */
const countWinnerRows = (html: string) => (html.match(/data-won="true"/g) ?? []).length
const countLoserRows = (html: string) => (html.match(/data-won="false"/g) ?? []).length
/** Gold text — the winning name and its score, via the shared bracket winner token. */
const countGoldText = (html: string) => (html.match(/text-\[var\(--bracket-winner\)\]/g) ?? []).length
/*
 * The winner is marked by gold, not filled with it.
 *
 * The old marker was gold at 8% over charcoal, which mixes to olive-brown rather than to a pale gold
 * wash — the whole reason the theme pass happened. The row now sits on a neutral raised surface and
 * carries its gold on the name and the score, which is where gold stays gold.
 */
const hasWinnerSurface = (html: string) => /shadow-\[inset_2px_0_0_0_var\(--bracket-winner\)\]/.test(html)
const hasNoGoldWash = (html: string) => !/bg-gold\/|bg-\[color-mix\([^\]]*--gold/.test(html)

// 1) Completed 1v1 match with a confirmed winner (a beats b).
console.log('Completed match (a wins)')
{
  const m: BracketMatch = { a: { name: 'Alice', seed: 1, score: 7, slug: 'alice' }, b: { name: 'Bob', seed: 2, score: 3, slug: 'bob' }, winner: 'a' }
  const html = render(m)
  check('exactly one winning row', countWinnerRows(html) === 1, `found ${countWinnerRows(html)}`)
  check('the loser is not painted at all', countLoserRows(html) === 0, `found ${countLoserRows(html)}`)
  check('the winner is marked in gold (name + score)', countGoldText(html) === 2, `found ${countGoldText(html)}`)
  check('the winning row carries a gold rail rather than a fill', hasWinnerSurface(html))
  check('...with no gold wash behind it', hasNoGoldWash(html))
  check('the frame itself stays neutral',
    html.includes('border-[var(--bracket-outline)] bg-[var(--bracket-surface)]'))
  check('the tick icon is gone', !/lucide-circle-check|lucide-check-circle/i.test(html))
  check('no line-through anywhere on the card', !/line-through/.test(html))
  check('both player profile links intact', html.includes('/players/alice') && html.includes('/players/bob'))
  check('scores preserved', html.includes('>7<') && html.includes('>3<'))
}

// 2) Completed match, b wins → the marking follows the CONFIRMED winner, not the score order.
console.log('Completed match (b wins)')
{
  const m: BracketMatch = { a: { name: 'Cara', seed: 3, score: 4, slug: 'cara' }, b: { name: 'Dan', seed: 4, score: 7, slug: 'dan' }, winner: 'b' }
  const html = render(m)
  check('still exactly one winning row', countWinnerRows(html) === 1, `found ${countWinnerRows(html)}`)
  check('the marked row is the one holding Dan',
    /data-won="true"[\s\S]{0,600}?Dan/.test(html) && !/data-won="true"[\s\S]{0,600}?Cara/.test(html))
  check('no line-through', !/line-through/.test(html))
}

// 3) A recorded winner with the LOWER score is still the winner. The marker follows the
//    authoritative result, never a comparison of the numbers.
console.log('Winner recorded against the scoreline')
{
  const m: BracketMatch = { a: { name: 'Gil', score: 2, slug: 'gil' }, b: { name: 'Hana', score: 9, slug: 'hana' }, winner: 'a' }
  const html = render(m)
  check('exactly one winning row', countWinnerRows(html) === 1)
  check('the recorded winner is the one marked',
    /data-won="true"[\s\S]{0,600}?Gil/.test(html))
}

// 4) Undecided match (both present, no winner) → nobody marked.
console.log('Undecided match')
{
  const m: BracketMatch = { a: { name: 'Eve', seed: 1, slug: 'eve' }, b: { name: 'Finn', seed: 8, slug: 'finn' } }
  const html = render(m)
  check('no winning row on an undecided match', countWinnerRows(html) === 0)
  check('no gold text on an undecided match', countGoldText(html) === 0)
}

// 5) Placeholder / empty slots → nobody marked, and the slot reads as a placeholder.
console.log('Empty / placeholder slots')
{
  const m: BracketMatch = { a: undefined, b: undefined }
  const html = render(m)
  check('no winning row for empty slots', countWinnerRows(html) === 0)
  check('empty slots read as TBD', html.includes('TBD'))
}

// 6) The Final carries no ornament at all.
//    The champion used to be crowned. A finished bracket already ends in an unbroken gold path, so
//    the crown was a second way of saying something the results had said — and a decorative one, on
//    a board whose whole job is to be read quickly.
console.log('The Final is an ordinary card')
{
  const decidedFinal: BracketMatch = { a: { name: 'Ada', score: 9, slug: 'ada' }, b: { name: 'Bo', score: 4, slug: 'bo' }, winner: 'a' }
  const final = renderToStaticMarkup(React.createElement(MatchBox, { match: decidedFinal }))
  check('the Final crowns nobody', !/lucide-crown/.test(final))
  check('and carries no circle, halo or medal', !/rounded-full/.test(final) || !/champion/i.test(final))
  check('no element announces itself as a champion ornament', !/aria-label="Champion"/.test(final))

  const earlier = renderToStaticMarkup(React.createElement(MatchBox, { match: decidedFinal }))
  check('an earlier round renders identically to the Final', earlier === final)

  // The winner is told by gold on the row, not by a fill behind it.
  check('the winning row carries a gold rail', /inset_2px_0_0_0_var\(--bracket-winner\)/.test(final))
  check('and is not filled with translucent gold',
    !/bg-\[var\(--selected-surface\)\]/.test(final) && !/bracket-winner-row/.test(final))
}

// 7) A bye reads as a bye rather than as a competitor.
console.log('Bye slot')
{
  const m: BracketMatch = { a: { name: 'Ivy', seed: 1, slug: 'ivy' }, b: { name: 'Bye' } }
  const html = render(m)
  check('the bye is labelled, quietly', html.includes('>bye<'))
  check('the bye is not linked to a profile', !/\/players\/Bye/i.test(html))
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
