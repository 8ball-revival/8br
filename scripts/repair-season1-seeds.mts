/**
 * Restore the playoff seeds Season 1 lost.
 *
 * WHY THEY WERE LOST: `enterSeasonPlayoffSetup` clears `seasonEntrant.playoffSeed`, and the old
 * `generateSeasonBracket` wrote seeds only onto the match rows. Moving a player between slots then
 * re-read the seed from the entrant — which was null — and wrote that null onto the match. Every
 * player who was ever repositioned lost their seed; the two who were not kept theirs.
 *
 * WHERE THE VALUES COME FROM: the same deterministic function the generator used,
 * `loadSeasonSeeding`, over group standings that are frozen because the Season is closed. Nothing is
 * guessed. The two seeds that survived are used as a control: if the recomputation disagrees with
 * either of them it has not reproduced the original order, and the repair aborts.
 *
 * Writes ONLY seed fields, and proves it by comparing a full before/after snapshot of everything
 * else. Idempotent.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/repair-season1-seeds.mts [--apply]
 */
import { prisma } from '../src/lib/prisma.ts'
import { loadSeasonSeeding } from '../src/lib/seasons/playoffs.ts'
import { assignSeeds, validateSeedSet, persistSeeds } from '../src/lib/seasons/playoff-seeds.ts'

const APPLY = process.argv.includes('--apply')
const SEASON_NUMBER = 1

const season = await prisma.season.findFirst({ where: { number: SEASON_NUMBER, competitionYear: 2005, competitionSeries: { slug: '8brcam' } }, select: { id: true, lifecycleState: true } })
if (!season) { console.error(`Season ${SEASON_NUMBER} not found.`); process.exit(1) }

/** Everything that must NOT change, captured so it can be compared afterwards. */
async function snapshot() {
  const matches = await prisma.seasonPlayoffMatch.findMany({
    where: { seasonId: season!.id },
    orderBy: [{ round: 'asc' }, { slot: 'asc' }],
    select: {
      id: true, round: true, slot: true, label: true, status: true,
      homeEntrantId: true, awayEntrantId: true, homeUsername: true, awayUsername: true,
      homeGames: true, awayGames: true, winnerEntrantId: true, feedsMatchId: true, loserFeedsMatchId: true,
    },
  })
  const groups = await prisma.seasonMatch.count({ where: { seasonId: season!.id } })
  const standings = await prisma.seasonStanding.findMany({
    where: { seasonId: season!.id }, orderBy: { id: 'asc' },
    select: { id: true, points: true, wins: true, losses: true, draws: true, rank: true, gamesWon: true, gamesLost: true },
  })
  const s = await prisma.season.findUnique({
    where: { id: season!.id },
    select: { lifecycleState: true, championName: true, championHandle: true, runnerUpName: true, finalScore: true },
  })
  return JSON.stringify({ matches, groups, standings, s })
}

const before = await snapshot()

// ---- rebuild the original order --------------------------------------------------------------
const rows = (await loadSeasonSeeding(season.id)).filter((r) => r.included && r.overallSeed != null)
const assignments = assignSeeds(rows.map((r) => ({ entrantId: r.entrantId, order: r.overallSeed! })))
validateSeedSet(assignments)

const nameOf = new Map(rows.map((r) => [r.entrantId, r.cueverseId ?? r.name]))
console.log(`Season ${SEASON_NUMBER}: ${assignments.length} playoff participants, seeds 1..${assignments.length}`)

// ---- control: the seeds that survived must agree ------------------------------------------------
const survivors = await prisma.seasonPlayoffMatch.findMany({
  where: { seasonId: season.id },
  select: { homeSeed: true, homeEntrantId: true, awaySeed: true, awayEntrantId: true },
})
const stored = new Map<number, number>()
for (const m of survivors) {
  if (m.homeSeed != null && m.homeEntrantId != null) stored.set(m.homeEntrantId, m.homeSeed)
  if (m.awaySeed != null && m.awayEntrantId != null) stored.set(m.awayEntrantId, m.awaySeed)
}
const computed = new Map(assignments.map((a) => [a.entrantId, a.seed]))
let disagreements = 0
for (const [entrantId, seed] of stored) {
  const got = computed.get(entrantId)
  const ok = got === seed
  if (!ok) disagreements++
  console.log(`  control: ${nameOf.get(entrantId)} stored ${seed}, recomputed ${got} — ${ok ? 'agrees' : 'DISAGREES'}`)
}
if (disagreements > 0) {
  console.error(`\nABORTED: the recomputation disagrees with ${disagreements} surviving seed(s); it has not reproduced the original order.`)
  await prisma.$disconnect(); process.exit(1)
}
if (stored.size === 0) console.log('  control: no surviving seeds to check against.')

console.log('\nSeeds to write:')
for (const a of [...assignments].sort((x, y) => x.seed - y.seed)) {
  console.log(`  ${String(a.seed).padStart(2)}  ${nameOf.get(a.entrantId)}`)
}

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write.')
  await prisma.$disconnect(); process.exit(0)
}

// ---- apply -------------------------------------------------------------------------------------
await prisma.$transaction(async (tx) => {
  await persistSeeds(tx, season.id, assignments)
  // Mirror onto the match rows so the stored bracket agrees with the entrants. Seeds are the ONLY
  // columns touched; players, scores, winners and progression are untouched.
  for (const a of assignments) {
    await tx.seasonPlayoffMatch.updateMany({ where: { seasonId: season.id, homeEntrantId: a.entrantId }, data: { homeSeed: a.seed } })
    await tx.seasonPlayoffMatch.updateMany({ where: { seasonId: season.id, awayEntrantId: a.entrantId }, data: { awaySeed: a.seed } })
  }
})

const after = await snapshot()
console.log(`\nEverything except seeds unchanged: ${before === after ? 'YES' : 'NO'}`)
if (before !== after) {
  console.error('ABORT-WORTHY: something other than seeds changed. Restore from the backup taken before this run.')
  await prisma.$disconnect(); process.exit(1)
}

const finalSeeds = await prisma.seasonEntrant.findMany({
  where: { seasonId: season.id, playoffSeed: { not: null } },
  select: { id: true, playoffSeed: true }, orderBy: { playoffSeed: 'asc' },
})
validateSeedSet(finalSeeds.map((f) => ({ entrantId: f.id, seed: f.playoffSeed! })))
console.log(`Seeds persisted and validated: ${finalSeeds.length} players, 1..${finalSeeds.length}.`)
await prisma.$disconnect()
