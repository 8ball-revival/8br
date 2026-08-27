/**
 * Check ONE reconstructed Season against the archive it was built from, in detail.
 *
 * The checks themselves live in scripts/support/season-audit.mts, shared with the all-Seasons suite
 * so there is only ever one definition of what "correct" means. This script chooses the Season and
 * prints the result.
 *
 * Note that this is no longer the gate: verify-archive-all-seasons.mts checks all forty-four, and
 * this remains for looking closely at one of them.
 *
 * Usage: tsx scripts/verify-archive-season.mts [seasonId]
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { auditSeason } from './support/season-audit.mts'

assertLocalDatabase()

/*
 * With no argument, check the most completely reconstructed Season there is.
 *
 * The batch runner discovers every verify-*.mts and calls it with no arguments, so demanding one
 * made this suite fail the batch by design. Defaulting keeps it meaningful in both places.
 */
const argId = Number(process.argv[2])
const seasonId = Number.isFinite(argId) ? argId : (await prisma.season.findFirstOrThrow({
  /*
   * A Season THIS reconstruction built, not one completed by an earlier import under other rules.
   * The first default landed on a 2005 Season holding 98 entrants against 32 recorded handles,
   * which says something about that old import and nothing about this one.
   */
  where: { archiveTemplateKey: { not: null }, division: 'A', lifecycleState: 'COMPLETED' },
  orderBy: { id: 'desc' },
})).id

const audit = await auditSeason(seasonId, { log: true })
console.log(`${audit.label} (${audit.seasonId}) — ${audit.lifecycleState}`)
for (const c of audit.checks) {
  console.log(`  ${c.ok ? '✓' : '✗'} ${c.label}${c.ok || !c.detail ? '' : ` — ${c.detail}`}`)
}
console.log(`\nRESULT: ${audit.passed} passed, ${audit.failed} failed`)
await prisma.$disconnect()
if (audit.failed > 0) process.exitCode = 1
