/**
 * A Season is identified by Competition + Year + Number + Division — all four.
 *
 * ── The defect this fixes ────────────────────────────────────────────────────────────────────────
 * The database index has always been (Competition, year, number, COALESCE(division, '')), so a
 * divisional pair may share a number. That is the entire purpose of divisions. But the pre-flight
 * check asked only (Competition, year, number) and refused Season 1 Division B whenever Season 1
 * Division A existed — a check stricter than the constraint it was protecting, which made divisional
 * Seasons impossible to create through the service at all. Worse, `createDraft` applied the division
 * AFTER the insert, so the row was momentarily a duplicate of its sibling and the index was right to
 * reject it.
 *
 * ── Two layers, doing different jobs ─────────────────────────────────────────────────────────────
 * The pre-flight check exists for the message: it names what already exists and offers to open it.
 * The unique index exists for the truth: two simultaneous submissions cannot both win, whatever the
 * check saw a moment earlier. This proves both, including a genuine concurrent race.
 *
 * Fixtures only, all removed afterwards.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-season-duplicate-rule.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { createDraft } from '../src/lib/creator/setup.ts'
import { isSeasonNumberTaken, conflictFor } from '../src/lib/seasons/numbering.ts'

assertLocalDatabase()

const ACTOR = { userId: 2, username: 'verify-duplicate-rule' }
const YEAR = 2097
let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

const series = await prisma.competitionSeries.findFirstOrThrow({ select: { id: true } })

async function cleanup() {
  const rows = await prisma.season.findMany({ where: { competitionYear: YEAR }, select: { id: true } })
  for (const r of rows) {
    await prisma.seasonEntrant.deleteMany({ where: { seasonId: r.id } })
    await prisma.season.delete({ where: { id: r.id } }).catch(() => {})
  }
}
await cleanup()

const mk = (n: number, division: string | null, key?: string) =>
  createDraft(ACTOR, {
    type: 'season', competitionYear: YEAR, competitionSeriesId: series.id,
    purpose: 'live', structure: 'groups_playoffs', number: n, division,
    // Open access: a join password is a separate concern from the identity rule under test.
    accessMode: 'OPEN',
    idempotencyKey: key ?? null,
  })

try {
  section('The same identity cannot be created twice')
  const first = await mk(1, null)
  check('the first Season is created', first.ok && first.id != null, first.error)
  const second = await mk(1, null)
  check('the second is refused', !second.ok, JSON.stringify(second))
  check('...naming what already exists', /already exists/i.test(second.error ?? ''), second.error)
  check('...and pointing at it so the form can offer to open it',
    second.existingSeasonId === first.id, `${second.existingSeasonId} vs ${first.id}`)
  check('only one record exists',
    (await prisma.season.count({ where: { competitionYear: YEAR, number: 1 } })) === 1)

  section('A divisional pair may share a number — that is what divisions are for')
  const a = await mk(2, 'Division A')
  const b = await mk(2, 'Division B')
  check('Division A is created', a.ok, a.error)
  check('Division B with the SAME number is also created', b.ok, b.error)
  check('they are two different records', a.id !== b.id)
  check('and both are there',
    (await prisma.season.count({ where: { competitionYear: YEAR, number: 2 } })) === 2)
  const dup = await mk(2, 'Division A')
  check('but a third in Division A is refused', !dup.ok, JSON.stringify(dup))
  check('...and points at the Division A record', dup.existingSeasonId === a.id)

  section('No division and an empty division are the same identity')
  check('the check folds them together',
    (await isSeasonNumberTaken(series.id, YEAR, 1, undefined, '')) === true
    && (await isSeasonNumberTaken(series.id, YEAR, 1, undefined, null)) === true)
  check('...and a real division is a different identity',
    (await isSeasonNumberTaken(series.id, YEAR, 1, undefined, 'Division A')) === false)
  const conflict = await conflictFor(series.id, YEAR, 2, 'Division A')
  check('the conflict message names the division', /Division A/.test(conflict.error), conflict.error)
  check('...and suggests a free number', Number.isInteger(conflict.suggestion))

  section('A retried submission creates one record, not two')
  const key = `verify-dupe-${YEAR}`
  const r1 = await mk(7, null, key)
  const r2 = await mk(7, null, key)
  check('the first attempt creates it', r1.ok && r1.id != null, r1.error)
  check('the retry returns the SAME record', r2.ok && r2.id === r1.id, JSON.stringify(r2))
  check('...and says it was deduplicated', r2.deduplicated === true)
  check('one record exists', (await prisma.season.count({ where: { competitionYear: YEAR, number: 7 } })) === 1)

  section('Two simultaneous submissions cannot both win')
  /*
   * The real race, not a simulated one: both calls are started before either is awaited, so they
   * genuinely contend for the index. No idempotency key, because that is the in-process shortcut —
   * this is about what the DATABASE guarantees when the check has already passed for both.
   */
  const [x, y] = await Promise.all([mk(9, null), mk(9, null)])
  const winners = [x, y].filter((r) => r.ok)
  const losers = [x, y].filter((r) => !r.ok)
  check('exactly one submission succeeded', winners.length === 1, `${winners.length} succeeded`)
  check('the other was refused rather than crashing', losers.length === 1 && !!losers[0].error, JSON.stringify(losers[0]))
  check('exactly one record exists',
    (await prisma.season.count({ where: { competitionYear: YEAR, number: 9 } })) === 1)
  check('the loser points at the winner',
    winners.length === 1 && losers.length === 1 && losers[0].existingSeasonId === winners[0].id,
    `${losers[0]?.existingSeasonId} vs ${winners[0]?.id}`)

  section('A created Season is immediately usable')
  const made = await prisma.season.findUniqueOrThrow({
    where: { id: first.id! },
    select: { lifecycleState: true, publiclyVisible: true, division: true, playoffDoubleElim: true, slug: true },
  })
  check('it is taking entrants', made.lifecycleState === 'REGISTRATION_OPEN', made.lifecycleState)
  check('it is publicly visible straight away', made.publiclyVisible === true)
  check('it has no groups', (await prisma.seasonGroup.count({ where: { seasonId: first.id! } })) === 0)
  check('it has no bracket', (await prisma.seasonPlayoffMatch.count({ where: { seasonId: first.id! } })) === 0)
  check('a divisional Season carries its division',
    (await prisma.season.findUniqueOrThrow({ where: { id: a.id! }, select: { division: true } })).division === 'Division A')
  check('...and a distinct slug from its sibling',
    (await prisma.season.findUniqueOrThrow({ where: { id: a.id! }, select: { slug: true } })).slug
    !== (await prisma.season.findUniqueOrThrow({ where: { id: b.id! }, select: { slug: true } })).slug)

  section('The double-elimination structure is recorded')
  const de = await createDraft(ACTOR, {
    type: 'season', competitionYear: YEAR, competitionSeriesId: series.id,
    purpose: 'live', structure: 'groups_playoffs_de', number: 11, division: null, accessMode: 'OPEN',
  })
  check('it is created', de.ok, de.error)
  check('...as a double-elimination Season',
    (await prisma.season.findUniqueOrThrow({ where: { id: de.id! }, select: { playoffDoubleElim: true } })).playoffDoubleElim === true)
} finally {
  await cleanup()
  check('every fixture Season is removed',
    (await prisma.season.count({ where: { competitionYear: YEAR } })) === 0)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
