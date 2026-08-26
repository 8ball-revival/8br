/**
 * The championship step, and the rule it exists to guarantee.
 *
 * ── What this is protecting ──────────────────────────────────────────────────────────────────────
 * A title is meant to place a player above everyone who never won one. Elo alone cannot promise that
 * — it measures strength, and a champion can end a career rated below a stronger player who never
 * reached a final. The step is what makes the rule true, and it is true only while the step is
 * bigger than the gap between the weakest champion and the strongest non-champion.
 *
 * That gap is a function of the data, so it moves. One Season with a champion who has a poor career,
 * or one very strong player who never wins, and a step that was sufficient stops being sufficient —
 * silently, because nothing else would look wrong. This asserts it every run and reports the margin,
 * so the number is raised deliberately rather than discovered by somebody reading the table.
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { CHAMPION_STEP, withChampionStep } from '../src/lib/stats/elo.ts'
import { getLadder } from '../src/lib/stats/ladder.ts'

assertLocalDatabase()

let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (s: string) => console.log(`\n--- ${s} ---`)

section('The step is a step, not a multiplier')
{
  check('one title and six titles receive the same step',
    withChampionStep(1500, 1) - 1500 === withChampionStep(1500, 6) - 1500)
  check('a player with no title receives nothing', withChampionStep(1500, 0) === 1500)
  check('the step is the documented size', withChampionStep(1500, 1) - 1500 === CHAMPION_STEP, String(CHAMPION_STEP))
}

section('Every champion outranks every non-champion')
for (const platform of ['YAHOO', 'CUEVERSE'] as const) {
  const rows = await getLadder('all-time', new Date(), platform)
  if (rows.length === 0) { console.log(`  (${platform}: no ranked players)`); continue }
  const champs = rows.filter((r) => r.seasonTitles.length > 0)
  const others = rows.filter((r) => r.seasonTitles.length === 0)
  if (champs.length === 0 || others.length === 0) { console.log(`  (${platform}: nothing to separate)`); continue }

  const lowestChamp = Math.min(...champs.map((r) => r.rating))
  const highestOther = Math.max(...others.map((r) => r.rating))
  check(`${platform}: no champion is rated below a non-champion`,
    lowestChamp > highestOther, `lowest champion ${lowestChamp} vs highest non-champion ${highestOther}`)

  const firstNonChamp = rows.findIndex((r) => r.seasonTitles.length === 0)
  check(`${platform}: champions hold the top ${champs.length} places without a gap`,
    firstNonChamp === champs.length, `first non-champion at #${firstNonChamp + 1}, ${champs.length} champions`)

  /*
   * Reported rather than asserted at a fixed value: the useful signal is how close the rule is to
   * failing, and a hard threshold here would just be a second number to keep in step with the first.
   */
  const margin = lowestChamp - highestOther
  console.log(`    margin: ${margin} points of headroom over the highest non-champion`)
  check(`${platform}: the margin is not down to its last few points`, margin >= 10, `${margin}`)
}

section('The rating it is added to is still pure Elo')
{
  const rows = await prisma.ratingLedger.findMany({ select: { ratingChange: true, isForfeit: true }, take: 5000 })
  check('no ledger row carries a championship bonus of its own',
    rows.every((r) => Math.abs(r.ratingChange) < CHAMPION_STEP),
    'a row moved by at least a whole step, which a match cannot do')
  const forfeits = rows.filter((r) => r.isForfeit)
  check('forfeits still move no rating', forfeits.every((r) => r.ratingChange === 0))
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
