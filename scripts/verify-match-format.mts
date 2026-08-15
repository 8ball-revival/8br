/**
 * Verifies FLEXIBLE result entry (scores are the source of truth; race/game counts are informational):
 *   - any non-negative whole-number score is accepted (5–4 in a "Race to 7", 8–7 in a "Race to 5", 7–2
 *     in a "10-game" group); the HIGHER score wins; scores are never padded/normalised.
 *   - elimination ties rejected; draws accepted only where the format permits (Group Stage).
 *   - basic validation still rejects negatives, decimals, blanks/NaN/Infinity, 0–0, and unsafe integers.
 * Plus the INFORMATIONAL race-length labels (playoffRaceLength) still compute for display.
 */
import { validateResult, previewResult } from '../src/lib/competition/scoring.ts'
import { computeBracketShape, playoffRaceLength } from '../src/lib/competition/match-format.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n) } }
const A = 101, B = 202 // arbitrary registration ids

// ---------------------------------------------------------------- Any score accepted; higher wins
console.log('\n--- Flexible entry: any non-negative whole-number score, higher score wins ---')
{
  const r = validateResult(A, B, 5, 4, { allowDraw: false }) // "Race to 7" reported 5–4
  check('Race-to-7 match entered 5–4 is accepted, home (higher) wins', r.ok && r.winnerRegistrationId === A && r.loserRegistrationId === B)
}
{
  const r = validateResult(A, B, 7, 8, { allowDraw: false }) // "Race to 5" reported 8–7 (away higher)
  check('Race-to-5 match entered 8–7 is accepted, away (higher) wins', r.ok && r.winnerRegistrationId === B)
}
{
  const r = validateResult(A, B, 7, 2, { allowDraw: true }) // "10-game" group reported 7–2 (total 9)
  check('10-game group entered 7–2 (total 9) is accepted, home wins', r.ok && r.isDraw === false && r.winnerRegistrationId === A)
}
{
  const r = validateResult(A, B, 12, 3, { allowDraw: false }) // scores above the "race target"
  check('scores above the race target (12–3) accepted, home wins', r.ok && r.winnerRegistrationId === A)
}
check('winner is derived from scores, never padded (2–1 → home)', validateResult(A, B, 2, 1, { allowDraw: false }).winnerRegistrationId === A)

// ---------------------------------------------------------------- Ties
console.log('\n--- Ties: rejected for elimination, drawn where the format permits ---')
check('elimination tie (7–7) rejected', validateResult(A, B, 7, 7, { allowDraw: false }).ok === false)
check('elimination tie (1–1) rejected', validateResult(A, B, 1, 1, { allowDraw: false }).ok === false)
{
  const r = validateResult(A, B, 5, 5, { allowDraw: true }) // Group Stage draw
  check('group/draw-permitting tie (5–5) accepted as a draw (no winner)', r.ok && r.isDraw === true && r.winnerRegistrationId === null)
}
check('0–0 is never a completed match, even where draws are allowed', validateResult(A, B, 0, 0, { allowDraw: true }).ok === false)
check('0–0 rejected for elimination too', validateResult(A, B, 0, 0, { allowDraw: false }).ok === false)

// ---------------------------------------------------------------- Basic validation
console.log('\n--- Basic validation still rejects bad input ---')
check('negative score rejected', validateResult(A, B, -1, 5, { allowDraw: false }).ok === false)
check('decimal score rejected', validateResult(A, B, 5.5, 4, { allowDraw: false }).ok === false)
check('NaN (blank) rejected', validateResult(A, B, NaN, 3, { allowDraw: false }).ok === false)
check('Infinity rejected', validateResult(A, B, Infinity, 3, { allowDraw: false }).ok === false)
check('score above MAX_SAFE_INTEGER rejected', validateResult(A, B, Number.MAX_SAFE_INTEGER + 2, 3, { allowDraw: false }).ok === false)
check('a large but safe score is accepted (no arbitrary low cap)', validateResult(A, B, 21, 19, { allowDraw: false }).ok === true)

// ---------------------------------------------------------------- previewResult (client mirror)
console.log('\n--- previewResult mirrors the server for live UI feedback ---')
check('preview 5–4 → home', previewResult(5, 4, false).status === 'home')
check('preview 4–9 → away', previewResult(4, 9, false).status === 'away')
check('preview 6–6 draws when allowed', previewResult(6, 6, true).status === 'draw')
check('preview 6–6 invalid for elimination', previewResult(6, 6, false).status === 'invalid')
check('preview 0–0 invalid', previewResult(0, 0, true).status === 'invalid')
check('preview -1–2 invalid', previewResult(-1, 2, false).status === 'invalid')

// ---------------------------------------------------------------- Informational race-length labels
console.log('\n--- Informational race-length labels still compute (display only) ---')
const se16 = computeBracketShape([{ round: 1 }, { round: 2 }, { round: 3 }, { round: 4 }])
check('single-elim early round labelled Race to 7', playoffRaceLength({ round: 1 }, se16) === 7)
check('single-elim semifinal labelled Race to 9', playoffRaceLength({ round: 3 }, se16) === 9)
check('single-elim final labelled Race to 9', playoffRaceLength({ round: 4 }, se16) === 9)
const se4 = computeBracketShape([{ round: 1 }, { round: 2 }])
check('bracket starting at semifinals labelled all Race to 9', playoffRaceLength({ round: 1 }, se4) === 9 && playoffRaceLength({ round: 2 }, se4) === 9)
check('two-player lone final labelled Race to 9', playoffRaceLength({ round: 1 }, computeBracketShape([{ round: 1 }])) === 9)
const de = computeBracketShape([
  { round: 1, section: 'WB' }, { round: 3, section: 'WB' },
  { round: 101, section: 'LB' }, { round: 104, section: 'LB' },
  { round: 200, section: 'GF' }, { round: 201, section: 'GF' },
])
check('double-elim early WB labelled Race to 7', playoffRaceLength({ round: 1, section: 'WB' }, de) === 7)
check('double-elim WB final labelled Race to 9', playoffRaceLength({ round: 3, section: 'WB' }, de) === 9)
check('double-elim LB final labelled Race to 9', playoffRaceLength({ round: 104, section: 'LB' }, de) === 9)
check('double-elim grand final + reset labelled Race to 9', playoffRaceLength({ round: 200, section: 'GF' }, de) === 9 && playoffRaceLength({ round: 201, section: 'GF' }, de) === 9)

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
