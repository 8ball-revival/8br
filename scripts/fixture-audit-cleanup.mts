/**
 * Remove audit rows left behind by verification fixtures — and NOTHING else.
 *
 * Verify suites create Seasons, Cups and Players under fixture identities, and each one writes audit
 * rows as it goes. The suites delete their records but historically not their audit trail, so the
 * log accumulates rows describing competitions that no longer exist.
 *
 * The danger here is obvious and one-directional: an over-broad delete removes a real record of
 * something the owner actually did, and an audit log is exactly the thing you cannot reconstruct
 * afterwards. So this identifies rows by EXACT fixture actor username — the literal strings the
 * suites pass as their actor — and by nothing else. Not by timestamp range, not by action name, not
 * by "looks like test data", not by "appeared after a baseline". A row whose ownership cannot be
 * proven is reported and left alone.
 *
 * Default is a DRY RUN. Deleting requires --apply, and even then the delete runs inside a
 * transaction that verifies the untouched count afterwards and rolls back if it moved.
 *
 *   npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/fixture-audit-cleanup.mts
 *   npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/fixture-audit-cleanup.mts --apply
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { isFixtureAuditRow } from '../src/lib/verification/fixture-actors.ts'

assertLocalDatabase('fixture-audit-cleanup')

const APPLY = process.argv.includes('--apply')

async function main() {
  // ── What is actually in the log, by actor. Printed in full so the decision is visible, not
  //    summarised into a number somebody has to trust.
  const byActor = await prisma.auditLog.groupBy({
    by: ['actorUserId', 'actorUsername'],
    _count: { _all: true },
    orderBy: { actorUserId: 'asc' },
  })

  /*
   * Which of those ids belong to a real account.
   *
   * Read from Payload's own table rather than inferred from the id's magnitude: "big numbers are
   * synthetic" is a convention, and a convention is not evidence when the cost of being wrong is a
   * permanently missing audit record.
   */
  const ids = byActor.map((r) => r.actorUserId).filter((n): n is number => n != null)
  const accounts = ids.length
    ? await prisma.$queryRawUnsafe<{ id: number }[]>(
        'SELECT id FROM payload.users WHERE id = ANY($1::int[])', ids)
    : []
  const realUserIds = new Set(accounts.map((a) => a.id))

  const fixture = byActor.filter((r) => isFixtureAuditRow(r, realUserIds))
  const kept = byActor.filter((r) => !isFixtureAuditRow(r, realUserIds))

  console.log('AUDIT LOG BY ACTOR\n')
  console.log('  FIXTURE (to remove):')
  if (fixture.length === 0) console.log('    (none)')
  for (const r of fixture) console.log(`    ${String(r._count._all).padStart(6)}  ${r.actorUsername}`)
  console.log('\n  REAL (kept, untouched):')
  for (const r of kept) console.log(`    ${String(r._count._all).padStart(6)}  ${r.actorUsername ?? '(null)'}`)

  const toDelete = fixture.reduce((n, r) => n + r._count._all, 0)
  const toKeep = kept.reduce((n, r) => n + r._count._all, 0)
  const total = await prisma.auditLog.count()

  console.log(`\n  ${toDelete} fixture rows · ${toKeep} real rows · ${total} total`)
  if (toDelete + toKeep !== total) {
    console.log('  REFUSING: the two groups do not account for every row.')
    process.exit(1)
  }

  /*
   * Anything that merely LOOKS like a fixture but is not on the list.
   *
   * Reported, never deleted. A name resembling a test actor is not proof, and the cost of guessing
   * wrong on an audit log is a permanently missing record of something real.
   */
  const suspicious = kept.filter((r) => {
    const n = (r.actorUsername ?? '').toLowerCase()
    const looksLikeOne = n.includes('verify') || n.includes('test') || n.startsWith('zz') || n.includes('fixture')
    return looksLikeOne && !(r.actorUserId != null && realUserIds.has(r.actorUserId))
  })
  if (suspicious.length) {
    console.log('\n  AMBIGUOUS — look like fixtures but are not on the exact list, so NOT deleted:')
    for (const r of suspicious) {
      console.log(`    ${String(r._count._all).padStart(6)}  ${String(r.actorUsername).padEnd(22)} uid=${r.actorUserId}`)
    }
  }

  if (toDelete === 0) {
    console.log('\nNothing to remove. (This script is idempotent — a second run finds nothing.)')
    return
  }

  if (!APPLY) {
    console.log('\nDRY RUN. Re-run with --apply to delete the fixture rows above.')
    return
  }

  // ── The delete. Scoped to the exact usernames, verified inside the transaction.
  // Deleted by the exact (username, id) PAIRS that were proven, never by username alone — a name on
  // its own would sweep up a future real account that happened to share it.
  const pairs = fixture.map((r) => ({ actorUsername: r.actorUsername, actorUserId: r.actorUserId }))
  const where = { OR: pairs }
  const result = await prisma.$transaction(async (tx) => {
    const removed = await tx.auditLog.deleteMany({ where })
    const remaining = await tx.auditLog.count()
    const stillFixture = await tx.auditLog.count({ where })

    // The real rows must be exactly as many as before. If this fails the transaction rolls back and
    // the log is untouched — better a failed cleanup than a log quietly missing something.
    if (remaining !== toKeep) {
      throw new Error(`REFUSING: expected ${toKeep} rows to remain, found ${remaining}. Rolled back.`)
    }
    if (stillFixture !== 0) throw new Error(`REFUSING: ${stillFixture} fixture rows survived. Rolled back.`)
    return { removed: removed.count, remaining }
  })

  console.log(`\nRemoved ${result.removed} fixture audit rows. ${result.remaining} real rows remain, unchanged.`)
}

let code = 0
try {
  await main()
} catch (e) {
  code = 1
  console.log('\nFAILED: ' + (e instanceof Error ? e.message : String(e)))
} finally {
  await prisma.$disconnect()
}
process.exit(code)
