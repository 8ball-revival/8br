/**
 * Make every COMPLETED Season publicly visible.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────────────────────
 * 46 of the 48 finished Seasons had `publiclyVisible = false`, which is not "unlisted" — it is not
 * public at all. A signed-out visitor got "No CueVerse Seasons Yet" on /seasons, and the page's own
 * "Browse the Yahoo archive" link landed on a 404, because the archive view forwards to the newest
 * Yahoo Season and that Season was private. Every completed Season, champion and all, was
 * unreachable.
 *
 * ── What it touches, and what it must not ───────────────────────────────────────────────────────
 * `publiclyVisible`, on Seasons whose lifecycleState is COMPLETED. Nothing else.
 *
 * In particular it does NOT write `countsTowardRankings`, which the Creator settings panel saves
 * alongside visibility. That switch is the one that rebuilds `rating_ledger` when it changes, so
 * leaving it alone is what keeps ratings, the ladder and every ranking exactly where they were.
 * Registration-open Seasons are out of scope by the where-clause, not by convention.
 *
 * Idempotent: the update is scoped to rows that are both COMPLETED and currently not visible, so a
 * second run reports zero and changes nothing.
 *
 * Usage: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/publish-completed-seasons.mts [--apply]
 *        Without --apply it prints what it would do and writes nothing.
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { recordAudit } from '../src/lib/competition/audit.ts'

assertLocalDatabase()

const APPLY = process.argv.includes('--apply')
const ACTOR = { userId: 2, username: 'publish-completed-seasons' }

const before = await prisma.season.groupBy({
  by: ['lifecycleState', 'publiclyVisible'] as any,
  _count: true,
} as any)
console.log('BEFORE')
for (const r of before as any[]) console.log(`  ${r.lifecycleState}  publiclyVisible=${r.publiclyVisible}  ${r._count}`)

const targets = await prisma.season.findMany({
  where: { lifecycleState: 'COMPLETED' as any, publiclyVisible: false },
  select: { id: true, number: true, platform: true, division: true, championName: true },
  orderBy: { id: 'asc' },
})
console.log(`\n${targets.length} completed Season(s) to publish`)
for (const t of targets) {
  console.log(`  #${t.id}  S${t.number} ${t.platform} ${t.division ?? ''}  champion: ${t.championName ?? '—'}`)
}

if (!APPLY) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply.')
  await prisma.$disconnect()
  process.exit(0)
}

const result = await prisma.season.updateMany({
  where: { lifecycleState: 'COMPLETED' as any, publiclyVisible: false },
  data: { publiclyVisible: true },
})
console.log(`\nupdated ${result.count} row(s)`)

for (const t of targets) {
  await recordAudit(ACTOR, {
    action: 'season.settings.display',
    entity: 'Season',
    entityId: t.id,
    oldValue: { publiclyVisible: false },
    newValue: { publiclyVisible: true },
    reason: 'Completed Seasons made publicly visible',
  }).catch(() => {})
}

const after = await prisma.season.groupBy({
  by: ['lifecycleState', 'publiclyVisible'] as any,
  _count: true,
} as any)
console.log('\nAFTER')
for (const r of after as any[]) console.log(`  ${r.lifecycleState}  publiclyVisible=${r.publiclyVisible}  ${r._count}`)

const leftover = await prisma.season.count({ where: { lifecycleState: 'COMPLETED' as any, publiclyVisible: false } })
console.log(`\ncompleted Seasons still private: ${leftover}`)
await prisma.$disconnect()
process.exit(leftover === 0 ? 0 : 1)
