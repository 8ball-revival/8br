/**
 * Swapping two bracket positions — the property, not the gesture.
 *
 * ── What actually has to be true ─────────────────────────────────────────────────────────────────
 * A drag and a pair of clicks are two ways to ask for the same thing, and the workspace applies the
 * result before the server has agreed to it. So there are three places the same rule has to hold,
 * and the rule is not "the card moved": it is that the SEED and the POSITION stay with the slot
 * while only the occupant travels.
 *
 * Bracket seed 1 means "top of the draw". Carrying a player's old seed with them would leave two
 * slots claiming the same number and a bracket that reads as though the draw had been reordered by
 * a placement. That is a statement about data, so it is proven against data rather than inferred
 * from a screenshot.
 *
 * The gesture itself is checked in the browser; this is the part a screenshot cannot show.
 *
 * Pure functions only — no database, no fixtures, nothing to clean up.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-bracket-swap.mts
 */
import { applySwap, canPlaceInto, describeSwap, sameSlot } from '../src/lib/seasons/bracket-swap.ts'
import type { EntrySlot } from '../src/lib/seasons/playoff-topology.ts'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

const slot = (matchId: number, side: 'home' | 'away', seed: number | null, entrantId: number | null, name: string | null): EntrySlot => ({
  matchId, side, section: null, round: 1, slot: matchId - 100, label: null,
  entrantId, entrantName: name, seed,
})

/** Round one of a bracket of four: seeds 1 and 4 in one tie, 2 and 3 in the other. */
const board = (): EntrySlot[] => [
  slot(101, 'home', 1, 11, 'Ada'),
  slot(101, 'away', 4, 44, 'Dee'),
  slot(102, 'home', 2, 22, 'Bea'),
  slot(102, 'away', 3, 33, 'Cal'),
]

// The two round-one ties are entry positions; the final's two sides are fed by them.
const entryKeys = new Set(['101:home', '101:away', '102:home', '102:away'])

try {
  section('A swap moves the occupants and nothing else')
  const before = board()
  const after = applySwap(before, { matchId: 101, side: 'home' }, { matchId: 102, side: 'away' })

  check('the two players exchanged places',
    after[0].entrantId === 33 && after[3].entrantId === 11,
    `${after[0].entrantId} / ${after[3].entrantId}`)
  check('...and their names travelled with them',
    after[0].entrantName === 'Cal' && after[3].entrantName === 'Ada')

  check('the seeds stayed with the SLOTS',
    after[0].seed === 1 && after[3].seed === 3,
    `${after[0].seed} / ${after[3].seed}`)
  check('...so no two positions claim the same seed',
    new Set(after.map((s) => s.seed)).size === after.length,
    after.map((s) => s.seed).join(','))
  check('every slot keeps its match and side',
    after.every((s, i) => s.matchId === before[i].matchId && s.side === before[i].side))
  check('every slot keeps its round and position',
    after.every((s, i) => s.round === before[i].round && s.slot === before[i].slot))

  check('nobody was duplicated',
    new Set(after.map((s) => s.entrantId)).size === after.length,
    after.map((s) => s.entrantId).join(','))
  check('nobody was lost',
    JSON.stringify(after.map((s) => s.entrantId).sort((a, b) => (a ?? 0) - (b ?? 0)))
    === JSON.stringify(before.map((s) => s.entrantId).sort((a, b) => (a ?? 0) - (b ?? 0))))

  section('The input is left alone, so a refusal can restore it')
  check('the original array is unchanged',
    JSON.stringify(before) === JSON.stringify(board()))
  check('...and a new array came back', after !== before)
  check('restoring it is exactly the original board',
    JSON.stringify(before) === JSON.stringify(board()))

  section('Swapping with an empty position carries the emptiness back')
  const withBye = [...board().slice(0, 3), slot(102, 'away', 3, null, null)]
  const moved = applySwap(withBye, { matchId: 101, side: 'home' }, { matchId: 102, side: 'away' })
  check('the player moved into the empty position', moved[3].entrantId === 11)
  check('...and the position they left is now empty', moved[0].entrantId === null)
  check('...with its name cleared too', moved[0].entrantName === null)
  check('...and both seeds unmoved', moved[0].seed === 1 && moved[3].seed === 3)

  section('A swap with itself is a no-op')
  const same = applySwap(board(), { matchId: 101, side: 'home' }, { matchId: 101, side: 'home' })
  check('the board is unchanged', JSON.stringify(same) === JSON.stringify(board()))
  check('sameSlot recognises it', sameSlot({ matchId: 1, side: 'home' }, { matchId: 1, side: 'home' }))
  check('...and tells two sides of one tie apart',
    !sameSlot({ matchId: 1, side: 'home' }, { matchId: 1, side: 'away' }))

  section('An unknown position changes nothing')
  const ghost = applySwap(board(), { matchId: 101, side: 'home' }, { matchId: 999, side: 'home' })
  check('the board is unchanged', JSON.stringify(ghost) === JSON.stringify(board()))

  section('Only entry positions accept a drop')
  check('a round-one position accepts', canPlaceInto(entryKeys, { matchId: 101, side: 'home' }))
  check('the other side of the same tie accepts', canPlaceInto(entryKeys, { matchId: 101, side: 'away' }))
  check('a winner-fed position refuses', !canPlaceInto(entryKeys, { matchId: 200, side: 'home' }))
  check('a loser-fed position refuses', !canPlaceInto(entryKeys, { matchId: 300, side: 'away' }))
  check('a position that does not exist refuses', !canPlaceInto(entryKeys, { matchId: 999, side: 'home' }))

  section('The announcement names both sides of the move')
  const said = describeSwap(board(), { matchId: 101, side: 'home' }, { matchId: 102, side: 'away' })
  check('it names the first player', said.includes('Ada'), said)
  check('...and the second', said.includes('Cal'), said)
  const withEmpty = describeSwap(
    [...board().slice(0, 3), slot(102, 'away', 3, null, null)],
    { matchId: 101, side: 'home' }, { matchId: 102, side: 'away' })
  check('an empty position is described rather than left blank',
    /empty position/i.test(withEmpty), withEmpty)

  section('Repeating a swap returns the board to where it started')
  const there = applySwap(board(), { matchId: 101, side: 'home' }, { matchId: 102, side: 'away' })
  const back = applySwap(there, { matchId: 101, side: 'home' }, { matchId: 102, side: 'away' })
  check('two swaps of the same pair undo each other',
    JSON.stringify(back) === JSON.stringify(board()))
} finally {
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
}

if (fail > 0) process.exitCode = 1
