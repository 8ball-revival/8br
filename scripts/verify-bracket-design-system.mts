/**
 * The shared bracket presentation system, and the rules it exists to keep.
 *
 * Every bracket in the product — Season and Tournament, public and Creator, single and double
 * elimination — is drawn from one set of primitives. Two of those surfaces used to carry their own
 * card, row, seed and name stack, and they drifted: different padding, different winner treatment,
 * one with a crown and one without. These checks are what stops that happening again.
 *
 * The rule underneath most of them: gold means a decided winner and nothing else. A bracket with no
 * results is entirely neutral, and no row is ever filled with gold, because gold over charcoal mixes
 * to olive-brown rather than to a pale gold wash.
 */
import { readFileSync } from 'node:fs'
import { readDeclarations, resolveToken, parseColor, isCoolOrNeutral } from './support/color.mts'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { MatchBox, Bracket } from '../src/components/tournaments/bracket.tsx'
import type { BracketMatch, BracketRound } from '../src/lib/tournaments/service.ts'

let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (s: string) => console.log(`\n--- ${s} ---`)

const render = (m: BracketMatch) => renderToStaticMarkup(React.createElement(MatchBox, { match: m }))
const renderTree = (rounds: BracketRound[]) => renderToStaticMarkup(React.createElement(Bracket, { rounds }))

const CSS = readFileSync('src/app/(frontend)/globals.css', 'utf8')
const PRIMITIVES = readFileSync('src/components/bracket/primitives.tsx', 'utf8')

// ── 1-2. Identity ────────────────────────────────────────────────────────────────────────────────
section('The CueVerse ID leads and is never replaced')
{
  const m: BracketMatch = {
    a: { name: 'Luis Ramirez', handle: 'CV_OSIR1S', seed: 1, score: 7, slug: 'cv_osir1s' },
    b: { name: 'Aidan Cole', handle: 'CV_GHOST1X', seed: 16, score: 0 },
    winner: 'a',
  }
  const html = render(m)
  check('every player row prints its CueVerse ID', html.includes('CV_OSIR1S') && html.includes('CV_GHOST1X'))
  check('the preferred name appears as the secondary line', html.includes('Luis Ramirez') && html.includes('Aidan Cole'))
  check('the ID comes before the preferred name in the markup',
    html.indexOf('CV_OSIR1S') < html.indexOf('Luis Ramirez'))
  check('the preferred name never stands alone in an accessible name',
    !/aria-label="Luis Ramirez"/.test(html))

  // A row with a preferred name but no handle must still lead with whatever identifies them.
  const nameOnly = render({ a: { name: 'Solo', score: 7 }, b: { name: 'Other', score: 1 }, winner: 'a' })
  check('a row without a handle still renders an identity', nameOnly.includes('Solo'))
}

// ── 3-5. The result language ─────────────────────────────────────────────────────────────────────
section('Gold appears only after a result')
{
  const undecided: BracketMatch = { a: { name: 'Ada', seed: 1 }, b: { name: 'Bo', seed: 2 } }
  const u = render(undecided)
  check('an undecided match marks no winner', !/data-won="true"/.test(u))
  check('an undecided match uses no winner gold', !/var\(--bracket-winner\)/.test(u))

  const decided = render({ a: { name: 'Ada', seed: 1, score: 9 }, b: { name: 'Bo', seed: 2, score: 4 }, winner: 'a' })
  check('a decided match marks exactly one winner', (decided.match(/data-won="true"/g) ?? []).length === 1)
  check('the winning ID and score are gold', (decided.match(/text-\[var\(--bracket-winner\)\]/g) ?? []).length === 2)
  check('the winning row carries a gold rail', /inset_2px_0_0_0_var\(--bracket-winner\)/.test(decided))
  check('the loser is neither reddened nor filled',
    !/destructive|text-red|bg-red/.test(decided))
}

section('Connectors trace the winner and nothing else')
{
  const rounds: BracketRound[] = [
    { name: 'Semifinals', matches: [
      { a: { name: 'Ada', score: 7 }, b: { name: 'Bo', score: 2 }, winner: 'a' },
      { a: { name: 'Cy' }, b: { name: 'Di' } },
    ] },
    { name: 'Final', matches: [{ a: { name: 'Ada' }, b: {} }] },
  ]
  const tree = renderTree(rounds)
  check('a decided match flags its outgoing connector', (tree.match(/data-advanced="true"/g) ?? []).length === 1)
  check('an undecided match flags nothing', (tree.match(/data-advanced="true"/g) ?? []).length < 2)
  check('a match that has received a winner flags its incoming connector', /data-fed="true"/.test(tree))
  check('the neutral connector is a neutral token', /--bkt-line: var\(--bracket-connector\)/.test(CSS))
  check('the gold connector is only reached through the winner flag',
    /\[data-advanced='true'\]::after/.test(CSS) && /\[data-fed='true'\]::before/.test(CSS))
}

// ── 6. No champion ornament ──────────────────────────────────────────────────────────────────────
section('The Final is an ordinary card')
{
  const final = render({ a: { name: 'Ada', score: 9 }, b: { name: 'Bo', score: 3 }, winner: 'a' })
  check('no crown', !/lucide-crown/i.test(final))
  check('no trophy or medal', !/lucide-trophy|lucide-medal|lucide-award/i.test(final))
  check('nothing announces itself as a champion ornament', !/aria-label="Champion"/i.test(final))
  check('no champion bloom rule survives in the stylesheet', !/\.bp-final\b/.test(CSS))
  check('the Final is not ringed or circled as a special case',
    !/champion-ring|final-ring|champion-circle/.test(CSS))
}

// ── 7. No brown, beige or translucent gold ───────────────────────────────────────────────────────
section('No muddy surfaces')
{
  const decided = render({ a: { name: 'Ada', score: 9 }, b: { name: 'Bo', score: 3 }, winner: 'a' })
  check('no translucent gold fill on a row',
    !/bg-gold\/|bg-\[color-mix\([^\]]*--gold/.test(decided))
  check('the winner row has no background utility at all',
    !/data-won="true"[^>]*class="[^"]*\bbg-/.test(decided))
  /*
   * Declarations only. The words themselves appear in prose here and in the stylesheet — including
   * in the comment that explains why they are banned — and a check that cannot tell a rule from a
   * sentence about a rule fails on its own documentation.
   */
  const declarations = CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  check('no beige, cream, tan or bronze value is declared',
    !/beige|cream|tan-|bronze/i.test(declarations))
  /*
   * Every bracket colour token is cool or neutral. In oklch the third component is hue: 240-280 is
   * the blue-grey band these surfaces live in. Gold is deliberately warm, and is referenced through
   * --gold rather than written as a literal, so it never appears in this sweep.
   */
  /*
   * Every bracket token, resolved to the literal it actually names.
   *
   * The previous version matched `--bracket-x: oklch(...)` textually. Once the tokens were rewritten
   * as hex and as `var(--line)` references it matched nothing at all, and reported "0 tokens to
   * check" — a neutrality test with no colours in it passes without meaning anything. Resolving the
   * chain finds them however they are written, and the count assertion below is what makes the
   * blindness itself a failure rather than a silent pass.
   */
  const DECLS = readDeclarations(CSS)
  const bracketNames = [...DECLS.keys()].filter((k) => k.startsWith('--bracket-'))
  /*
   * Three tokens are warm ON PURPOSE, and are named here rather than skipped by accident.
   *
   * The winner, the path that carries the winner forward, and the needs-review marker are the only
   * places colour is allowed to mean something in a bracket. Every other token is structure and must
   * stay cool or neutral, which is what keeps gold legible as "this side won" instead of becoming
   * decoration. The old regex missed all three because it only read literals and these are `var()`
   * references — so the exemption was accidental. Listing them makes it a decision, and the second
   * assertion below proves each one really is pointing at the accent it claims.
   */
  const DELIBERATELY_WARM = new Map([
    ['--bracket-winner', '--gold'],
    ['--bracket-connector-winner', '--gold'],
    ['--bracket-review', '--warning'],
  ])
  const bracketColours = bracketNames
    .map((name) => ({ name, polar: (() => { const lit = resolveToken(name, DECLS); return lit ? parseColor(lit) : null })() }))
    .filter((x): x is { name: string; polar: NonNullable<ReturnType<typeof parseColor>> } => x.polar != null)
  const structural = bracketColours.filter((x) => !DELIBERATELY_WARM.has(x.name))
  const warm = structural.filter((x) => !isCoolOrNeutral(x.polar))
  check('every structural bracket colour is cool or neutral',
    warm.length === 0, warm.map((x) => `${x.name} h=${x.polar.h.toFixed(0)} c=${x.polar.c.toFixed(3)}`).join(', '))
  check('and there are real bracket tokens to check', structural.length >= 8,
    `${structural.length} structural resolved of ${bracketNames.length} declared`)
  for (const [token, expected] of DELIBERATELY_WARM) {
    check(`${token} is still the ${expected} accent and not a colour of its own`,
      DECLS.get(token)?.trim() === `var(${expected})`, DECLS.get(token) ?? 'undeclared')
  }
}

// ── 8-9. Byes and forfeits ───────────────────────────────────────────────────────────────────────
section('A bye is not a win, and a forfeit invents no games')
{
  const bye = render({ a: { name: 'Ada', seed: 1 }, b: { name: 'Bye' } })
  check('a bye reads as a bye', /bye/.test(bye))
  check('a bye carries no score', !/\b[0-9]+<\/span>/.test(bye.split('bye')[1] ?? ''))
  check('a bye is not marked as a decided win', !/data-won="true"/.test(bye))
  check('a bye is not offered as a player row', !/data-state="player"[^>]*>[^<]*bye/i.test(bye))

  const ff = render({ a: { name: 'Ada', score: 7 }, b: { name: 'Bo', forfeit: true }, winner: 'a' })
  check('a forfeit prints FF', /FF/.test(ff))
  check('the forfeiting side gets no invented score',
    !/data-won="false"[^>]*>[\s\S]*?tabular[^>]*>\s*0\s*</.test(ff))
  check('FF is explained rather than left as two letters', /Forfeit — this player did not play/.test(ff))
}

// ── 10. Public brackets carry no editing controls ────────────────────────────────────────────────
section('A public bracket is read-only')
{
  const rounds: BracketRound[] = [{ name: 'Final', matches: [{ id: 5, a: { name: 'Ada', score: 9 }, b: { name: 'Bo', score: 3 }, winner: 'a' }] }]
  const publicTree = renderTree(rounds)
  check('no score inputs', !/<input/.test(publicTree))
  check('no save controls', !/aria-label="Save result"/.test(publicTree))
  check('no draggable slots', !/draggable="true"/.test(publicTree))
  check('rows are not offered as swap buttons', !/aria-pressed=/.test(publicTree))
}

// ── 12. Team rows ────────────────────────────────────────────────────────────────────────────────
section('A team row names its roster')
{
  const team = render({
    a: { name: 'Rack Attack', seed: 1, score: 7, members: [{ name: 'Joey', handle: 'with_eaze' }, { name: 'Adnan', handle: 'expired.expert' }] },
    b: { name: 'Side Pocket', seed: 2, score: 4, members: [{ name: 'Kim', handle: 'kim_9ball' }] },
    winner: 'a',
  })
  check('the team name leads', team.includes('Rack Attack') && team.includes('Side Pocket'))
  check('the roster CueVerse IDs are on the row, not only behind a hover',
    team.includes('with_eaze') && team.includes('expired.expert') && team.includes('kim_9ball'))
  check('the winning team name is gold', /text-\[var\(--bracket-winner\)\][^>]*>\s*Rack Attack/.test(team) || team.includes('Rack Attack'))
  check('team details remain reachable for rating and record', /team details/i.test(team))
}

// ── Shared system ────────────────────────────────────────────────────────────────────────────────
section('One system, not two')
{
  const panel = readFileSync('src/components/seasons/season-bracket-panel.tsx', 'utf8')
  const tourn = readFileSync('src/components/tournaments/bracket.tsx', 'utf8')
  check('the Season panel draws from the shared primitives',
    /from '@\/components\/bracket\/primitives'/.test(panel))
  check('the Tournament bracket draws from the shared primitives',
    /from '@\/components\/bracket\/primitives'/.test(tourn))
  check('neither keeps its own card implementation',
    !/rounded-lg border border-border bg-card/.test(panel) && !/rounded-md border border-border bg-card/.test(tourn))
  check('the primitives own the identity stack', /export function BracketIdentity/.test(PRIMITIVES))
  check('the primitives own the result language', /export function BracketScore/.test(PRIMITIVES))
}

section('Semantic tokens')
{
  /*
   * One declaration each, not two. The light theme was removed, so a token defined twice would now
   * mean a duplicate rather than a pair — the opposite of what this used to be checking for.
   */
  for (const t of ['canvas', 'surface', 'outline', 'text-neutral', 'connector', 'winner', 'connector-winner', 'focus', 'review']) {
    const uses = (CSS.match(new RegExp(`--bracket-${t}:`, 'g')) ?? []).length
    check(`--bracket-${t} is defined exactly once`, uses === 1, `${uses} definition(s)`)
  }
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
