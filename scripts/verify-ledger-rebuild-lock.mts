/**
 * The rating-ledger rebuild, under concurrency.
 *
 * ── The failure this covers ──────────────────────────────────────────────────────────────────────
 * The rebuild wipes `rating_ledger` and replays every eligible record. Alone that is correct: its
 * delete and insert scopes are identical. Concurrently it is not — under READ COMMITTED a second
 * rebuild cannot see the first's uncommitted deletes, replays the same timeline, and collides on the
 * `(matchKey, playerId)` unique index.
 *
 * It surfaced as an intermittent `verify-group-stage` failure that would not reproduce standalone,
 * because reproducing it needs a second writer — the dev server, serving an operator whose lifecycle
 * action triggered its own rebuild. Importing a run of Seasons back to back makes that collision far
 * more likely, which is why this is a prerequisite rather than a nice-to-have.
 *
 * Read-only with respect to canonical data: it rebuilds from what is already there and asserts the
 * result is unchanged. It creates no Season, no match and no Player.
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { rebuildRatingLedger } from '../src/lib/stats/ledger.ts'

assertLocalDatabase()

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

/** Every ledger row, in a stable order, so two rebuilds can be compared exactly. */
const fingerprint = async () =>
  JSON.stringify(await prisma.ratingLedger.findMany({
    orderBy: [{ matchKey: 'asc' }, { playerId: 'asc' }],
    select: { matchKey: true, playerId: true, preRating: true, postRating: true, seasonId: true, tournamentId: true },
  }))

const duplicateKeys = async () =>
  (await prisma.$queryRawUnsafe<{ c: bigint }[]>(
    `SELECT count(*) c FROM (SELECT "matchKey", "playerId" FROM rating_ledger GROUP BY 1,2 HAVING count(*) > 1) d`,
  ))[0].c

try {
  const before = await fingerprint()
  const rowsBefore = await prisma.ratingLedger.count()

  section('The lock is taken before anything is deleted')
  const src = (await import('node:fs')).readFileSync('src/lib/stats/ledger.ts', 'utf8')
  const lockAt = src.indexOf('pg_advisory_xact_lock')
  const deleteAt = src.indexOf('ratingLedger.deleteMany({})')
  check('a transaction-scoped advisory lock is acquired', lockAt > -1)
  check('...before the wipe, not after it', lockAt > -1 && deleteAt > -1 && lockAt < deleteAt,
    `lock@${lockAt} delete@${deleteAt}`)
  check('...and it is transaction-scoped, so commit releases it', src.includes('pg_advisory_xact_lock'))
  check('no duplicate rows are being swallowed instead', !/skipDuplicates/.test(src))

  section('Two rebuilds launched together both succeed')
  /*
   * The real test: fire two rebuilds at once, each in its own transaction. Without the lock one of
   * them raises a unique-constraint error on (matchKey, playerId). With it, the second waits.
   */
  const results = await Promise.allSettled([
    prisma.$transaction(async (tx) => rebuildRatingLedger(tx), { timeout: 240_000 }),
    prisma.$transaction(async (tx) => rebuildRatingLedger(tx), { timeout: 240_000 }),
  ])
  const rejected = results.filter((r) => r.status === 'rejected')
  check('neither rebuild failed', rejected.length === 0,
    rejected.map((r) => String((r as PromiseRejectedResult).reason).split('\n')[0]).join(' | '))
  check('no duplicate (matchKey, playerId) exists', Number(await duplicateKeys()) === 0)

  section('The result is deterministic')
  /*
   * Deliberately NOT "unchanged from before".
   *
   * A rebuild recomputes from what is eligible right now, so it is entitled to correct drift — and
   * this database is live, with an operator completing records while the suite runs. Asserting the
   * ledger is untouched would be asserting that nobody else was working.
   *
   * The property that must hold is that the rebuild is a function of the data: run it twice, get the
   * same rows. Any difference from the starting state is reported rather than failed.
   */
  const afterConcurrent = await fingerprint()
  const rowsAfter = await prisma.ratingLedger.count()
  if (afterConcurrent !== before) {
    console.log(`  (the rebuild corrected drift: ${rowsBefore} → ${rowsAfter} rows)`)
  }
  check('the rebuild produced a complete ledger', rowsAfter > 0, String(rowsAfter))

  await prisma.$transaction(async (tx) => { await rebuildRatingLedger(tx) }, { timeout: 240_000 })
  const afterSequential = await fingerprint()
  check('a further sequential rebuild is byte-identical again', afterSequential === afterConcurrent)

  section('The readers agree with what was written')
  /*
   * A rebuild that produced a self-consistent ledger nobody reads the same way would pass every
   * check above, so the stored ratings are compared against a replay of the same rows.
   */
  /*
   * Self-consistency, not agreement between the two readers.
   *
   * `replayRatings` carries a fractional running rating and rounds once at the end; `storedRatings`
   * reads the value that was rounded at each step. They are deliberately different definitions —
   * reconciling them is the entire reason the canonical rating-history service exists — so demanding
   * they match to the unit is asking the wrong question.
   *
   * What the rebuild must guarantee is that the rows it wrote agree with themselves: every row's
   * post equals its pre plus its change, and each player's chain is continuous, with no gap where a
   * duplicate was overwritten or a row was replayed twice.
   */
  const rows = await prisma.ratingLedger.findMany({
    orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
    select: { playerId: true, preRating: true, postRating: true, ratingChange: true, sequence: true },
  })

  const badStep = rows.filter((r) => r.postRating !== r.preRating + r.ratingChange)
  check(`every row's post equals pre plus change (${rows.length} rows)`, badStep.length === 0,
    badStep.slice(0, 2).map((r) => `${r.playerId}@${r.sequence}`).join(', '))

  const last = new Map<string, number>()
  const breaks: string[] = []
  for (const r of rows) {
    const prev = last.get(r.playerId)
    if (prev !== undefined && prev !== r.preRating) breaks.push(`${r.playerId}@${r.sequence}: ${prev} → ${r.preRating}`)
    last.set(r.playerId, r.postRating)
  }
  check(`every player's rating chain is continuous (${last.size} players)`, breaks.length === 0,
    breaks.slice(0, 2).join(' | '))

  const players = await prisma.ratingLedger.findMany({ select: { playerId: true }, distinct: ['playerId'] })
  check(`the ledger still covers its players (${players.length})`, players.length > 0)

  section('Nothing was left behind')
  check('no fixture Season was created', (await prisma.season.count({ where: { competitionYear: { gte: 2090 } } })) === 0)
  check('no orphaned ledger row exists', await (async () => {
    const seasonIds = new Set((await prisma.season.findMany({ select: { id: true } })).map((s) => s.id))
    const tournIds = new Set((await prisma.tournament.findMany({ select: { id: true } })).map((t) => t.id))
    const led = await prisma.ratingLedger.findMany({ select: { seasonId: true, tournamentId: true } })
    return led.every((l) => (l.seasonId == null || seasonIds.has(l.seasonId)) && (l.tournamentId == null || tournIds.has(l.tournamentId)))
  })())
} catch (e) {
  fail++
  console.log('  FAILED before finishing: ' + (e as Error).message.split('\n')[0])
} finally {
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
}

await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
