/**
 * Record that 8BRCAM Seasons 1 and 2 (2005) were Division A.
 *
 * A canonical-data correction, not a migration: the two Seasons always belonged to that division
 * and the archive simply never captured it. Nothing about how they were played changes, which is
 * why they are not reopened — a reopen withdraws a Season from the Rankings and re-applies it, and
 * putting a finished competition through that to fix a label would risk far more than it fixes.
 *
 * ── How the records are chosen ───────────────────────────────────────────────────────────────────
 * By Competition slug, competition year and season number — never by an id typed from memory. The
 * script refuses to run unless each of those triples matches exactly one row, because an id that
 * has drifted is the one mistake this cannot detect after the fact.
 *
 * ── Where the value comes from ───────────────────────────────────────────────────────────────────
 * Copied from Season 3, which already carries the canonical value, rather than typed as 'A' here.
 * The column is a free-form code, so guessing its case or spelling would risk creating a second
 * division that merely looks like the first.
 *
 * Default is a DRY RUN. Writing requires --apply.
 *
 *   npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/correct-8brcam-divisions.mts
 *   npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/correct-8brcam-divisions.mts --apply
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { setSeasonDivisions } from '../src/lib/seasons/service.ts'

assertLocalDatabase('correct-8brcam-divisions')

const APPLY = process.argv.includes('--apply')

const COMPETITION = '8brcam'
const YEAR = 2005
/** The Seasons to correct, and the one to copy the canonical value from. */
const TARGETS = [1, 2]
const SOURCE = 3

const actor = { userId: 2, username: 'admin' }

async function resolve(number: number) {
  const rows = await prisma.season.findMany({
    where: { competitionSeries: { slug: COMPETITION }, competitionYear: YEAR, number },
    select: {
      id: true, number: true, division: true, lifecycleState: true, ladderAppliedAt: true,
      reopenedAt: true, championHandle: true, championName: true,
      competitionSeries: { select: { name: true } },
      _count: { select: { entrants: true, groups: true, matches: true, playoffMatches: true, ratingLedger: true } },
    },
  })
  if (rows.length !== 1) {
    throw new Error(`REFUSING: (${COMPETITION}, ${YEAR}, #${number}) matched ${rows.length} Seasons, expected exactly 1.`)
  }
  return rows[0]
}

async function main() {
  const source = await resolve(SOURCE)
  const canonical = source.division
  console.log(`Canonical value, read from ${source.competitionSeries.name} Season ${source.number} (id ${source.id}):`)
  console.log(`  division = ${JSON.stringify(canonical)}  (${typeof canonical})`)
  if (canonical == null || String(canonical).trim() === '') {
    throw new Error('REFUSING: the source Season carries no division to copy.')
  }

  const targets = []
  console.log('\nResolved targets:')
  for (const n of TARGETS) {
    const s = await resolve(n)
    targets.push(s)
    console.log(`  Season ${s.number} → id ${s.id} · division ${JSON.stringify(s.division)} · ${s.lifecycleState}` +
      ` · finalised ${!!s.ladderAppliedAt} · reopened ${!!s.reopenedAt}`)
    console.log(`     champion ${JSON.stringify(s.championHandle ?? s.championName)} · ${JSON.stringify(s._count)}`)
  }

  if (targets.some((t) => t.id === source.id)) throw new Error('REFUSING: the source Season is also a target.')

  if (!APPLY) {
    console.log(`\nDRY RUN. Re-run with --apply to set division ${JSON.stringify(canonical)} on Seasons ${targets.map((t) => t.id).join(' and ')}.`)
    return
  }

  // One transaction for both, so the archive is never half-corrected.
  const result = await setSeasonDivisions(actor, targets.map((t) => ({ seasonId: t.id, division: canonical })))
  if (!result.ok) throw new Error(result.error ?? 'The correction failed.')

  console.log('\nApplied:')
  for (const u of result.updated ?? []) {
    console.log(`  Season id ${u.seasonId}: ${JSON.stringify(u.from)} → ${JSON.stringify(u.to)}`)
  }

  // ── Prove nothing else moved.
  console.log('\nAfter:')
  const after = await prisma.season.findMany({
    where: { competitionSeries: { slug: COMPETITION }, competitionYear: YEAR },
    select: {
      id: true, number: true, division: true, lifecycleState: true, ladderAppliedAt: true, reopenedAt: true,
      championHandle: true, championName: true,
      _count: { select: { entrants: true, groups: true, matches: true, playoffMatches: true, ratingLedger: true } },
    },
    orderBy: { number: 'asc' },
  })
  for (const s of after) {
    console.log(`  Season ${s.number} (id ${s.id}) division=${JSON.stringify(s.division)} ${s.lifecycleState}` +
      ` finalised=${!!s.ladderAppliedAt} reopened=${!!s.reopenedAt} champion=${JSON.stringify(s.championHandle ?? s.championName)}` +
      ` counts=${JSON.stringify(s._count)}`)
  }

  const audit = await prisma.auditLog.findMany({
    where: { action: 'season.division.set' },
    orderBy: { createdAt: 'asc' },
    select: { actorUsername: true, action: true, entity: true, entityId: true, oldValue: true, newValue: true, createdAt: true },
  })
  console.log('\nAudit entries written:')
  for (const a of audit) {
    console.log(`  ${a.createdAt.toISOString()} ${a.actorUsername} ${a.action} ${a.entity}#${a.entityId} ` +
      `${JSON.stringify(a.oldValue)} → ${JSON.stringify(a.newValue)}`)
  }
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
