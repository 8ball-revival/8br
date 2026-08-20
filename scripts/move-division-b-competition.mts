/**
 * Move the Division B reconstruction shells to their own Competition.
 *
 * The owner created "8BRCAM-B" (slug 8br-div-b) so Division B is a Competition in its own right
 * rather than a field on a Season that shares its number with Division A.
 *
 * ── Only the generated shells move ───────────────────────────────────────────────────────────────
 * Scoped to Seasons carrying an `archiveTemplateKey`. The owner's own Seasons are left alone even if
 * they are marked Division B, because moving somebody's live work between Competitions is not what
 * "move the archive shells" asked for.
 *
 * ── The numbering constraint still holds ─────────────────────────────────────────────────────────
 * Season numbers are unique per Competition, year and division. Moving Division B into its own
 * Competition cannot collide: the target holds nothing, and A and B never shared a Competition after
 * this runs. The slug is rewritten to match, since it encodes the Competition.
 *
 * Default is a DRY RUN. Writing requires --apply.
 *
 *   npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/move-division-b-competition.mts
 *   npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/move-division-b-competition.mts --apply
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { recordAudit } from '../src/lib/competition/audit.ts'

assertLocalDatabase('move-division-b-competition')

const APPLY = process.argv.includes('--apply')
const TARGET_SLUG = '8br-div-b'
const actor = { userId: 2, username: 'admin' }

async function main() {
  const target = await prisma.competitionSeries.findUnique({
    where: { slug: TARGET_SLUG }, select: { id: true, name: true, slug: true, active: true },
  })
  if (!target) throw new Error(`Competition "${TARGET_SLUG}" does not exist. Create it first.`)
  if (!target.active) throw new Error(`Competition "${target.name}" is inactive.`)

  const shells = await prisma.season.findMany({
    where: { archiveTemplateKey: { not: null }, division: 'B' },
    select: {
      id: true, number: true, competitionYear: true, slug: true,
      competitionSeriesId: true, archiveTemplateKey: true,
    },
    orderBy: [{ competitionYear: 'asc' }, { number: 'asc' }],
  })

  const toMove = shells.filter((s) => s.competitionSeriesId !== target.id)
  console.log(`${shells.length} Division B shell(s); ${toMove.length} to move into ${target.name}.\n`)

  // Counts that must not change: this moves Seasons between Competitions and touches nothing else.
  const before = {
    seasons: await prisma.season.count(),
    entrants: await prisma.seasonEntrant.count(),
    groups: await prisma.seasonGroup.count(),
    matches: await prisma.seasonMatch.count(),
    players: await prisma.player.count(),
    ledger: await prisma.ratingLedger.count(),
  }

  if (toMove.length === 0) {
    console.log('Nothing to move — every Division B shell is already there.')
    return
  }

  for (const s of toMove.slice(0, 5)) {
    console.log(`  ${s.archiveTemplateKey}  Season ${s.number} · ${s.competitionYear}`)
  }
  if (toMove.length > 5) console.log(`  … and ${toMove.length - 5} more`)

  if (!APPLY) {
    console.log('\nDRY RUN. Re-run with --apply to write.')
    return
  }

  await prisma.$transaction(async (tx) => {
    for (const s of toMove) {
      await tx.season.update({
        where: { id: s.id },
        data: {
          competitionSeriesId: target.id,
          // The slug carries the Competition, so it has to follow. The division suffix stays: it is
          // what keeps a Season's URL stable if it is ever moved back.
          slug: `${target.slug}-season-${s.number}-${s.competitionYear}-div-b`,
        },
      })
      await recordAudit(actor, {
        action: 'season.competition.move',
        entity: 'Season',
        entityId: s.id,
        oldValue: { competitionSeriesId: s.competitionSeriesId, slug: s.slug },
        newValue: { competitionSeriesId: target.id, competition: target.name },
      }, tx)
    }
  }, { timeout: 120_000 })

  const after = {
    seasons: await prisma.season.count(),
    entrants: await prisma.seasonEntrant.count(),
    groups: await prisma.seasonGroup.count(),
    matches: await prisma.seasonMatch.count(),
    players: await prisma.player.count(),
    ledger: await prisma.ratingLedger.count(),
  }
  const drift = Object.keys(before)
    .filter((k) => before[k as keyof typeof before] !== after[k as keyof typeof after])
    .map((k) => `${k}: ${before[k as keyof typeof before]} → ${after[k as keyof typeof after]}`)

  const moved = await prisma.season.count({
    where: { archiveTemplateKey: { not: null }, division: 'B', competitionSeriesId: target.id },
  })
  const stillA = await prisma.season.count({
    where: { archiveTemplateKey: { not: null }, division: 'A' },
  })

  console.log(`\nMoved ${toMove.length}.`)
  console.log(`  Division B shells now in ${target.name}: ${moved}`)
  console.log(`  Division A shells left where they were:  ${stillA}`)
  console.log(drift.length === 0
    ? '  Nothing was created or destroyed.'
    : `  UNEXPECTED: ${drift.join(', ')}`)
  if (drift.length > 0) throw new Error('the move changed row counts it should not have')
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
