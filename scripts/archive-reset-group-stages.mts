/**
 * Remove the group stages the first import built in the wrong order.
 *
 * ── Why these rows have to go rather than be extended ────────────────────────────────────────────
 * `publishSeasonGroups` owns the round-robin schedule, the standings rows and the transition to
 * GROUP_STAGE_LIVE. The first import created groups and imported scores BEFORE calling it, so those
 * matches and standings were never produced by the canonical publication — and publish now refuses
 * to run because the standings it would create already exist.
 *
 * They also describe the wrong competition. Several Seasons received only the entrants whose Players
 * already existed, so their groups were drawn from a partial field: 17 entrants where the archive
 * records 49. Those groups are not an incomplete version of the truth, they are a different draw.
 *
 * Deleting is safe because every one of these rows is reproducible from the manifest. The archive is
 * the authority; the database is a rendering of it.
 *
 * ── What is proven before anything is deleted ────────────────────────────────────────────────────
 * A Season is only touched when it is an archive-linked shell this import processed, is still
 * incomplete, has no playoff match, no champion, no title and no ledger row, and shows no owner
 * activity after the import began. Anything else is isolated and reported while the rest proceed.
 *
 * Usage: tsx scripts/archive-reset-group-stages.mts [--dry-run|--apply]
 */
import { readFileSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'

assertLocalDatabase()

const APPLY = process.argv.includes('--apply')
const PROGRESS = 'reports/archive-import-progress.json'
/** The importer's own actor name; anything else touching the Season means a person did. */
const IMPORT_ACTORS = ['archive-import', 'archive-import-cleanup', 'archive-import-merge']

interface Row { seasonId: number; label: string; stage: string }
const progress = JSON.parse(readFileSync(PROGRESS, 'utf8')) as Record<string, Row>

const targets = Object.values(progress).filter((p) => p.stage !== 'blocked')
console.log(`${targets.length} candidate Season(s) from the progress file${APPLY ? '' : ' — DRY RUN'}`)

let reset = 0, skipped = 0, isolated = 0
const totals = { groups: 0, members: 0, matches: 0, standings: 0 }

for (const t of targets) {
  const s = await prisma.season.findUnique({
    where: { id: t.seasonId },
    select: {
      id: true, number: true, division: true, competitionYear: true,
      archiveTemplateKey: true, lifecycleState: true, championName: true, ladderAppliedAt: true,
    },
  })
  if (!s) { console.log(`  ? ${t.label} (${t.seasonId}) no longer exists`); skipped++; continue }

  const label = `${s.competitionYear} S${s.number}${s.division ?? ''}`
  const counts = {
    groups: await prisma.seasonGroup.count({ where: { seasonId: s.id } }),
    members: await prisma.seasonGroupPlayer.count({ where: { group: { seasonId: s.id } } }),
    matches: await prisma.seasonMatch.count({ where: { seasonId: s.id } }),
    standings: await prisma.seasonStanding.count({ where: { seasonId: s.id } }),
  }
  const playoff = await prisma.seasonPlayoffMatch.count({ where: { seasonId: s.id } })
  const ledger = await prisma.ratingLedger.count({ where: { seasonId: s.id } })

  // ── The guards. Any failure isolates this Season and leaves it exactly as it is. ──────────────
  const refusals: string[] = []
  if (!s.archiveTemplateKey) refusals.push('no archive template key')
  if (String(s.lifecycleState) === 'COMPLETED') refusals.push('Season is completed')
  if (playoff > 0) refusals.push(`${playoff} playoff match(es) exist`)
  if (ledger > 0) refusals.push(`${ledger} rating-ledger row(s) exist`)
  if (s.championName) refusals.push(`a champion is recorded (${s.championName})`)
  if (s.ladderAppliedAt) refusals.push('a ranking contribution was applied')

  /*
   * Owner activity after the import began.
   *
   * The importer's audit entries are its own; anything written by another actor against this Season
   * is a person's work and is never discarded automatically.
   */
  const foreign = await prisma.auditLog.findFirst({
    where: {
      entityId: String(s.id),
      entity: 'Season',
      actorUsername: { notIn: IMPORT_ACTORS },
      createdAt: { gte: new Date('2026-08-22T00:00:00Z') },
    },
    select: { actorUsername: true, action: true },
  })
  if (foreign) refusals.push(`edited by ${foreign.actorUsername} (${foreign.action}) after the import began`)

  if (refusals.length > 0) {
    console.log(`  ISOLATED ${label} (${s.id}): ${refusals.join('; ')}`)
    isolated++
    continue
  }

  const total = counts.groups + counts.members + counts.matches + counts.standings
  if (total === 0) { skipped++; continue }

  console.log(`  ${APPLY ? 'RESET' : 'would reset'} ${label} (${s.id}) — groups=${counts.groups} members=${counts.members} matches=${counts.matches} standings=${counts.standings}`)
  totals.groups += counts.groups; totals.members += counts.members
  totals.matches += counts.matches; totals.standings += counts.standings

  if (!APPLY) { reset++; continue }

  /*
   * One transaction per Season, so a refusal on one cannot roll back the repairs already made to
   * the others. Order matters: children before their groups.
   */
  try {
    await prisma.$transaction(async (tx) => {
      await tx.seasonStanding.deleteMany({ where: { seasonId: s.id } })
      await tx.seasonMatch.deleteMany({ where: { seasonId: s.id } })
      await tx.seasonGroupPlayer.deleteMany({ where: { group: { seasonId: s.id } } })
      await tx.seasonGroup.deleteMany({ where: { seasonId: s.id } })
    }, { timeout: 120_000 })
    reset++
  } catch (e) {
    console.log(`    FAILED ${label}: ${(e as Error).message.split('\n')[0]}`)
    isolated++
  }
}

console.log('\n' + JSON.stringify({ reset, isolated, skipped, rows: totals }, null, 2))

if (APPLY) {
  // Prove the shape the repaired importer expects to find.
  const dirty = await prisma.season.findMany({
    where: {
      archiveTemplateKey: { not: null },
      lifecycleState: { notIn: ['COMPLETED'] },
      OR: [{ groups: { some: {} } }, { matches: { some: {} } }, { standings: { some: {} } }],
    },
    select: { id: true, number: true, division: true, competitionYear: true },
  })
  console.log(`Seasons still holding group children: ${dirty.length}`,
    dirty.slice(0, 6).map((d) => `${d.competitionYear} S${d.number}${d.division ?? ''}`).join(', '))
}

await prisma.$disconnect()
