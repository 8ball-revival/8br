/**
 * Classify every existing Season and Tournament, once.
 *
 * ── What this decides, and what it refuses to guess ──────────────────────────────────────────────
 * Two things, from a list rather than from a rule:
 *
 *   Platform. Every Season and Tournament that existed at the recorded cutover is Yahoo history.
 *   Anything created afterwards is CueVerse, which is the column default and needs no help. The ids
 *   come from `reports/platform-cutover.json`, captured before any of this ran, because the owner is
 *   editing Seasons while it runs — a rule like "created before this timestamp" would sweep up work
 *   done in the meantime and quietly file it under the wrong platform.
 *
 *   Competition. Division B stops being a Competition of its own and rejoins 8BRCAM, keeping
 *   `division = 'B'`. It was never a different series; it was the lower half of the same one, and
 *   modelling it as a separate Competition made a Division B Season look like a different event.
 *
 * ── Division B and the ladder ────────────────────────────────────────────────────────────────────
 * Division B contributes nothing to any ranking, so `countsTowardRankings` goes false — the field
 * that already exists for exactly this, rather than a second one meaning the same thing. It stays
 * completely visible: every entrant, group, match, playoff and champion is untouched.
 *
 * Idempotent. Re-running changes nothing, and says so.
 *
 * Usage: tsx scripts/classify-platforms.mts [--apply]
 */
import { readFileSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'

assertLocalDatabase()

const APPLY = process.argv.includes('--apply')
const CUTOVER = JSON.parse(readFileSync('reports/platform-cutover.json', 'utf8')) as {
  cutover: string
  seasonIds: number[]
  tournamentIds: number[]
}

const CANONICAL_SLUG = '8brcam'
const DIVISION_B_SLUG = '8br-div-b'

const canonical = await prisma.competitionSeries.findUnique({ where: { slug: CANONICAL_SLUG }, select: { id: true, name: true } })
if (!canonical) throw new Error(`no canonical Competition at slug "${CANONICAL_SLUG}"`)
const divB = await prisma.competitionSeries.findUnique({ where: { slug: DIVISION_B_SLUG }, select: { id: true, name: true } })

console.log(`cutover ${CUTOVER.cutover}`)
console.log(`  ${CUTOVER.seasonIds.length} Season(s) and ${CUTOVER.tournamentIds.length} Tournament(s) existed then`)
console.log(`  canonical Competition: ${canonical.name} (${canonical.id})`)
console.log(`  Division B Competition: ${divB ? `${divB.name} (${divB.id})` : '— already folded in'}`)

// ── What would change ──────────────────────────────────────────────────────────────────────────
const toYahooSeasons = await prisma.season.count({ where: { id: { in: CUTOVER.seasonIds }, platform: 'CUEVERSE' } })
const toYahooTournaments = await prisma.tournament.count({ where: { id: { in: CUTOVER.tournamentIds }, platform: 'CUEVERSE' } })
const toReassign = divB ? await prisma.season.count({ where: { competitionSeriesId: divB.id } }) : 0
const toUnrank = await prisma.season.count({ where: { division: 'B', countsTowardRankings: true } })
const afterCutover = await prisma.season.count({ where: { id: { notIn: CUTOVER.seasonIds } } })

console.log('\nplanned:')
console.log(`  Season -> YAHOO:                 ${toYahooSeasons}`)
console.log(`  Tournament -> YAHOO:             ${toYahooTournaments}`)
console.log(`  Division B Season -> 8BRCAM:     ${toReassign}`)
console.log(`  Division B countsToward -> false:${toUnrank}`)
console.log(`  Seasons created since cutover (left CueVerse): ${afterCutover}`)

if (!APPLY) {
  console.log('\nDRY RUN — nothing changed. Re-run with --apply.')
  await prisma.$disconnect()
  process.exit(0)
}

/*
 * Short transactions, one concern each.
 *
 * The owner is editing Seasons in another window while this runs, so nothing here holds a long lock
 * or reads the world into memory first. Each statement is scoped by primary key or by the exact
 * classification it is fixing, and none of them touch a Season created after the cutover.
 */
const yahooSeasons = await prisma.season.updateMany({
  where: { id: { in: CUTOVER.seasonIds }, platform: 'CUEVERSE' },
  data: { platform: 'YAHOO' },
})
const yahooTournaments = await prisma.tournament.updateMany({
  where: { id: { in: CUTOVER.tournamentIds }, platform: 'CUEVERSE' },
  data: { platform: 'YAHOO' },
})

let reassigned = 0
if (divB) {
  const moved = await prisma.season.updateMany({
    where: { competitionSeriesId: divB.id },
    data: { competitionSeriesId: canonical.id },
  })
  reassigned = moved.count
}

const unranked = await prisma.season.updateMany({
  where: { division: 'B', countsTowardRankings: true },
  data: { countsTowardRankings: false },
})

console.log('\napplied:')
console.log(`  Season -> YAHOO:                 ${yahooSeasons.count}`)
console.log(`  Tournament -> YAHOO:             ${yahooTournaments.count}`)
console.log(`  Division B Season -> 8BRCAM:     ${reassigned}`)
console.log(`  Division B countsToward -> false:${unranked.count}`)

// ── What it looks like now ─────────────────────────────────────────────────────────────────────
const byPlatform = await prisma.season.groupBy({ by: ['platform'], _count: true })
const bySeries = await prisma.competitionSeries.findMany({
  select: { id: true, name: true, slug: true, _count: { select: { seasons: true, tournaments: true } } },
  orderBy: { id: 'asc' },
})
const divBNow = await prisma.season.count({ where: { division: 'B' } })
const divBRanked = await prisma.season.count({ where: { division: 'B', countsTowardRankings: true } })

console.log('\nresult:')
for (const p of byPlatform) console.log(`  Season platform ${p.platform}: ${p._count}`)
for (const c of bySeries) console.log(`  ${c.name} (${c.slug}): ${c._count.seasons} season(s), ${c._count.tournaments} tournament(s)`)
console.log(`  Division B Seasons: ${divBNow}, of which ranked: ${divBRanked}`)
console.log(`  every Division B Season is unranked: ${divBRanked === 0}`)

await prisma.$disconnect()
