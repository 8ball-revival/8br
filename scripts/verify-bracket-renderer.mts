/**
 * The double-elimination bracket: its data, and the rules the renderer is held to.
 *
 * ── What went wrong ──────────────────────────────────────────────────────────────────────────────
 * Two separate faults. The Season's losers bracket had the wrong SHAPE — the generated 32-slot
 * bracket pairs winners-round-one losers against each other, while the competition paired each of
 * them against a winners-round-two loser — so Adambuddy was handed a walkover by a tie nobody could
 * reach instead of being eliminated by _Tarantula_69. And the display cut the bracket off inside a
 * fixed-height box with its own vertical scrollbar, on a page with room to spare.
 *
 * ── What is asserted ─────────────────────────────────────────────────────────────────────────────
 * That the rebuilt bracket matches the fixed Challonge record match for match; that the renderer is
 * given everything it needs so it never has to work anything out; and that nothing in the CSS can
 * clip the bracket or scroll it vertically inside itself again.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env.replica scripts/verify-bracket-renderer.mts
 */
import { readFileSync } from 'node:fs'
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { seasonPlayoffRounds } from '../src/lib/seasons/playoffs.ts'
import { connectorClass } from '../src/components/brackets/double-elim-bracket.tsx'

assertLocalDatabase('verify bracket renderer')

const SEASON = 16426
let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

const CSS = readFileSync('src/app/(frontend)/display.css', 'utf8')
const TSX = readFileSync('src/components/brackets/double-elim-bracket.tsx', 'utf8')
const CREATOR = readFileSync('src/components/creator/playoff-scoring.tsx', 'utf8')

section('The bracket the competition actually played')
{
  const rows = await prisma.seasonPlayoffMatch.findMany({ where: { seasonId: SEASON } })
  const wb = rows.filter((r) => r.section === 'WB')
  const lb = rows.filter((r) => r.section === 'LB')
  const gf = rows.filter((r) => r.section === 'GF')
  check('19 winners ties plus 12 round-one byes = 31 rows', wb.length === 31, `${wb.length}`)
  check('18 losers ties — the shape the source has, not the generated one', lb.length === 18, `${lb.length}`)
  check('...over seven rounds of 4,4,4,2,2,1,1', [101, 102, 103, 104, 105, 106, 107]
    .map((r) => lb.filter((m) => m.round === r).length).join(',') === '4,4,4,2,2,1,1',
    [101, 102, 103, 104, 105, 106, 107].map((r) => lb.filter((m) => m.round === r).length).join(','))
  check('one grand final and no reset', gf.length === 1)
  check('38 ties were played in total', rows.filter((r) => r.homeEntrantId != null && r.awayEntrantId != null).length === 38)
  check('every round-one bye is kept as its own position', wb.filter((r) => r.round === 1).length === 16)
  check('nothing anywhere is left undecided', rows.every((r) => r.winnerEntrantId != null))
  check('no losers tie is unreachable — the fault that stalled this Season',
    lb.every((r) => r.homeEntrantId != null && r.awayEntrantId != null))

  // The pairing the whole rebuild turns on.
  const ents = await prisma.seasonEntrant.findMany({ where: { seasonId: SEASON }, select: { id: true, cueverseId: true } })
  const id = (cid: string) => ents.find((e) => e.cueverseId === cid)?.id
  const adam = id('adambuddy'), tar = id('FreakyLilspider'), jc = id('IrateMusicfool'), bj = id('Black_Jesus')
  const pair = (a?: number, b?: number) => lb.find((m) =>
    (m.homeEntrantId === a && m.awayEntrantId === b) || (m.homeEntrantId === b && m.awayEntrantId === a))
  const m14 = pair(adam, tar)
  check('Adambuddy meets _Tarantula_69 in the losers bracket, as the source has it', m14 != null)
  check('...and _Tarantula_69 wins it 7-0', m14?.winnerEntrantId === tar
    && Math.max(m14?.homeGames ?? 0, m14?.awayGames ?? 0) === 7 && Math.min(m14?.homeGames ?? 0, m14?.awayGames ?? 0) === 0)
  const m13 = pair(jc, bj)
  check('Black_Jesus plays the losers tie the source records, rather than vanishing', m13 != null)
  check('...losing it to JC 7-1, so he is eliminated on two losses and nothing was invented',
    m13?.winnerEntrantId === jc && Math.max(m13?.homeGames ?? 0, m13?.awayGames ?? 0) === 7)

  check('no forfeit was invented in the final stage — the source records none',
    rows.every((r) => r.forfeitEntrantId == null))
}

section('The renderer is handed everything, so it works nothing out')
{
  const rounds = await seasonPlayoffRounds(SEASON)
  check('every column says which half it belongs to', rounds.every((r) => r.section != null))
  check('...covering winners, losers and the grand final',
    new Set(rounds.map((r) => r.section)).size === 3)
  const all = rounds.flatMap((r) => r.matches)
  check('every match carries a short code to be referred to by', all.every((m) => !!m.code))
  check('...and the codes are unique', new Set(all.map((m) => m.code)).size === all.length)

  const sources = all.flatMap((m) => [m.sourceA, m.sourceB]).filter(Boolean)
  check('positions know where their occupant came from', sources.length > 0, `${sources.length}`)
  check('...phrased as Winner/Loser of a specific match',
    sources.every((s) => /^(Winner|Loser) of (W|L|GF)/.test(s!.label)))
  check('...and every one points at a code that exists',
    sources.every((s) => all.some((m) => m.code === s!.code)))
  check('a losers position is fed by a LOSER, which is the link a line cannot draw legibly',
    sources.some((s) => s!.label.startsWith('Loser of')))

  check('the renderer is never given a decision to make: no winner is computed in it',
    !/computeWinner|decideWinner|advance\(/.test(TSX))
  check('...and it does not read the database', !/prisma|fetch\(/.test(TSX))
}

section('Connectors are drawn only where the pairing is certain')
{
  check('a round feeding one the same size connects straight across', connectorClass(4, 4, 0) === 'dxb-cell--straight')
  check('a round feeding one half its size joins in pairs',
    connectorClass(4, 2, 0) === 'dxb-cell--join-down' && connectorClass(4, 2, 1) === 'dxb-cell--join-up')
  check('the last column draws nothing', connectorClass(2, undefined, 0) === undefined)
  check('an unexpected ratio draws nothing rather than asserting a pairing',
    connectorClass(5, 3, 0) === undefined)
}

section('Nothing can clip the bracket or scroll it vertically inside itself')
{
  const viewport = CSS.slice(CSS.indexOf('.dxb-viewport {'), CSS.indexOf('.dxb-viewport:active'))
  check('the bracket scrolls horizontally only', /overflow-x:\s*auto/.test(viewport))
  check('...and never vertically, so the PAGE scrollbar reaches the rest of it',
    /overflow-y:\s*visible/.test(viewport))
  check('no height cap survives anywhere in the bracket styles',
    !/\.dxb-[^{]*\{[^}]*max-height/.test(CSS.replace(/\.dxb-fullscreen[^}]*\}/g, '')),
    'a max-height is what cut the bracket off before')
  check('zoom is real layout, not a transform that leaves the box behind',
    /--dxb-scale/.test(CSS) && !/\.dxb-canvas[^}]*transform:\s*scale/.test(CSS))
  check('...so card width, gaps and text all scale together',
    /width:\s*calc\(300px \* var\(--dxb-scale\)\)/.test(CSS)
    && /font-size:\s*calc\(0\.92rem \* var\(--dxb-scale\)\)/.test(CSS))
  check('the Creator board lost its height cap too',
    /overflow-x-auto overflow-y-visible/.test(CREATOR) && !/max-h-\[78vh\]/.test(CREATOR))
}

section('Readable at rest, and mirrored the way it was asked for')
{
  check('no card is dimmed by default', /\.dxb-card \{[^}]*opacity: 1/.test(CSS))
  check('emphasis adds a ring rather than fading everything else',
    /\.dxb-card--lit \{[^}]*box-shadow/.test(CSS) && !/\.dxb-card:not\(:hover\)[^}]*opacity/.test(CSS))
  check('byes, pending positions and results stay visually distinct',
    /\.dxb-slot--bye/.test(CSS) && /\.dxb-slot--tbd/.test(CSS) && /\.dxb-slot--won/.test(CSS))
  check('a forfeit reads FF where a score would be', /\.dxb-score--ff/.test(CSS) && /FF/.test(TSX))
  check('the losers half is mirrored', /\.dxb-section--mirrored/.test(CSS))
  check('...and on a narrow screen it stacks under the winners half, with the final last',
    /\.dxb-canvas--mirrored > \.dxb-section--final \{ order: 3; \}/.test(CSS))
  check('all five controls exist',
    ['Zoom in', 'Zoom out', 'Reset zoom', 'Fit bracket', 'Full screen'].every((l) => TSX.includes(l)))
  check('zoom is remembered for the session only', /sessionStorage/.test(TSX) && !/localStorage/.test(TSX))
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
