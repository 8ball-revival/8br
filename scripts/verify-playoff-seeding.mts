/**
 * Playoff seeding: assignment, validation, persistence, and the Season 1 repair.
 *
 * The bug this guards against: seeds used to live only on the bracket's match rows, while the code
 * that moved a player between slots read the seed from the ENTRANT — a column nothing ever wrote.
 * Every repositioned player silently lost their seed, which is how Season 1 came to display two
 * seeds out of sixteen. Seeds now belong to the player, so no slot operation can lose one.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-playoff-seeding.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import {
  assignSeeds, validateSeedSet, persistSeeds, seedsByEntrant, SeedingError,
} from '../src/lib/seasons/playoff-seeds.ts'
import { seasonPlayoffRounds } from '../src/lib/seasons/playoffs.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) }
}
const threw = async (fn: () => unknown | Promise<unknown>): Promise<string | null> => {
  try { await fn(); return null } catch (e) { return e instanceof Error ? e.message : String(e) }
}

const FIXTURE_COMP = 'zzps-comp'
const madeSeasons: number[] = []

async function cleanup() {
  await prisma.season.deleteMany({ where: { slug: { startsWith: 'zzps-season-' } } }).catch(() => {})
  await prisma.competitionSeries.deleteMany({ where: { slug: FIXTURE_COMP } }).catch(() => {})
  madeSeasons.length = 0
}
await cleanup()

async function fixtureSeason(number: number, entrants: number) {
  const comp = await prisma.competitionSeries.findFirst({ where: { slug: FIXTURE_COMP }, select: { id: true } })
    ?? await prisma.competitionSeries.create({ data: { name: 'zz Seeding', shortName: 'zzps', slug: FIXTURE_COMP, active: true }, select: { id: true } })
  const s = await prisma.season.create({
    data: {
      competitionSeriesId: comp.id, number, competitionYear: 2089, slug: `zzps-season-${number}`,
      lifecycleState: 'PLAYOFF_SETUP', lounge: 'Social', accessMode: 'OPEN',
      groupStageGames: 10, earlyRaceTo: 7, semifinalRaceTo: 9, finalRaceTo: 9,
    },
    select: { id: true, number: true },
  })
  madeSeasons.push(s.number)
  const ids: number[] = []
  for (let i = 1; i <= entrants; i++) {
    const e = await prisma.seasonEntrant.create({
      data: { seasonId: s.id, username: `zzps${number}_${i}`, cueverseId: `zzps${number}_${i}`, status: 'APPROVED', playoffIncluded: true },
      select: { id: true },
    })
    ids.push(e.id)
  }
  return { seasonId: s.id, ids }
}

try {
  console.log('--- Assigning seeds from the group-derived order ---')
  {
    // A deliberately sparse, out-of-sequence order: the global ranking leaves gaps when players are
    // left out of the bracket, and the input is not pre-sorted.
    const out = assignSeeds([
      { entrantId: 300, order: 17 },
      { entrantId: 100, order: 1 },
      { entrantId: 200, order: 9 },
    ])
    check('the set is densified to 1..N', out.map((a) => a.seed).join(',') === '1,2,3')
    check('the group-derived ORDER is preserved exactly',
      out.map((a) => a.entrantId).join(',') === '100,200,300')
    check('a gap in the global ranking never reorders anyone',
      out.find((a) => a.entrantId === 300)?.seed === 3)

    const tie = assignSeeds([{ entrantId: 20, order: 5 }, { entrantId: 10, order: 5 }])
    check('an exact tie breaks deterministically, never randomly',
      tie.map((a) => a.entrantId).join(',') === '10,20')
  }

  console.log('')
  console.log('--- Validation rejects anything that is not a complete unique 1..N set ---')
  {
    check('a complete set passes',
      (await threw(() => validateSeedSet([{ entrantId: 1, seed: 1 }, { entrantId: 2, seed: 2 }]))) === null)

    const dup = await threw(() => validateSeedSet([{ entrantId: 1, seed: 1 }, { entrantId: 2, seed: 1 }]))
    check('a duplicate seed is rejected', !!dup && /more than one player/.test(dup), String(dup))

    const missing = await threw(() => validateSeedSet([{ entrantId: 1, seed: 1 }, { entrantId: 2, seed: 3 }]))
    check('a gap in the set is rejected', !!missing && /missing|outside/.test(missing), String(missing))

    const high = await threw(() => validateSeedSet([{ entrantId: 1, seed: 1 }, { entrantId: 2, seed: 9 }]))
    check('a seed above N is rejected', !!high && /outside the valid range/.test(high), String(high))

    const zero = await threw(() => validateSeedSet([{ entrantId: 1, seed: 0 }, { entrantId: 2, seed: 1 }]))
    check('a seed below 1 is rejected', !!zero && /outside the valid range/.test(zero), String(zero))

    const frac = await threw(() => validateSeedSet([{ entrantId: 1, seed: 1.5 }]))
    check('a non-integer seed is rejected', !!frac && /whole number/.test(frac), String(frac))

    const short = await threw(() => validateSeedSet([{ entrantId: 1, seed: 1 }], 4))
    check('a partial set against a known field size is rejected',
      !!short && /incomplete/.test(short), String(short))

    check('the error is a SeedingError, so callers can tell it from a crash',
      await (async () => { try { validateSeedSet([{ entrantId: 1, seed: 5 }]); return false } catch (e) { return e instanceof SeedingError } })())
  }

  console.log('')
  console.log('--- Persistence is atomic and re-validated after writing ---')
  {
    const { seasonId, ids } = await fixtureSeason(980001, 8)
    const good = assignSeeds(ids.map((id, i) => ({ entrantId: id, order: i + 1 })))
    await prisma.$transaction(async (tx) => { await persistSeeds(tx, seasonId, good) })
    const stored = await seedsByEntrant(prisma, seasonId)
    check('every player is seeded', stored.size === 8, String(stored.size))
    check('the stored set is exactly 1..8',
      [...stored.values()].sort((a, b) => a - b).join(',') === '1,2,3,4,5,6,7,8')

    // A broken set must take the whole transaction with it, including anything written alongside.
    const before = await seedsByEntrant(prisma, seasonId)
    const err = await threw(async () => {
      await prisma.$transaction(async (tx) => {
        await tx.season.update({ where: { id: seasonId }, data: { subtitle: 'should not survive' } })
        await persistSeeds(tx, seasonId, [{ entrantId: ids[0], seed: 1 }, { entrantId: ids[1], seed: 1 }])
      })
    })
    check('a duplicate blocks the write', !!err)
    const after = await seedsByEntrant(prisma, seasonId)
    check('the previous seeding is untouched by the failed write',
      JSON.stringify([...after].sort()) === JSON.stringify([...before].sort()))
    const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { subtitle: true } })
    check('everything else in that transaction rolled back too', s?.subtitle !== 'should not survive')

    // Re-seeding a smaller field must not leave a dropped player holding a stale seed.
    await prisma.$transaction(async (tx) => {
      await persistSeeds(tx, seasonId, assignSeeds(ids.slice(0, 4).map((id, i) => ({ entrantId: id, order: i + 1 }))))
    })
    const reduced = await seedsByEntrant(prisma, seasonId)
    check('a dropped player keeps no stale seed', reduced.size === 4, String(reduced.size))
    check('the reduced set is 1..4', [...reduced.values()].sort((a, b) => a - b).join(',') === '1,2,3,4')
  }

  console.log('')
  console.log('--- A seed follows the PLAYER through every round ---')
  {
    const { seasonId, ids } = await fixtureSeason(980002, 4)
    await prisma.$transaction(async (tx) => {
      await persistSeeds(tx, seasonId, assignSeeds(ids.map((id, i) => ({ entrantId: id, order: i + 1 }))))
    })
    // Round 1 carries the seed on the match row; round 2 deliberately does NOT, mimicking a bracket
    // whose later rows were written by a slot move that lost the number.
    await prisma.seasonPlayoffMatch.create({
      data: { seasonId, round: 1, slot: 0, homeEntrantId: ids[0], awayEntrantId: ids[3], homeUsername: 'a', awayUsername: 'd', homeSeed: 1, awaySeed: 4 },
    })
    await prisma.seasonPlayoffMatch.create({
      data: { seasonId, round: 2, slot: 0, homeEntrantId: ids[0], awayEntrantId: ids[1], homeUsername: 'a', awayUsername: 'b' },
    })
    const rounds = await seasonPlayoffRounds(seasonId)
    // The renderer resolves the displayed name from the ENTRANT, not from the match row, so match on
    // the entrant's own handle rather than the name the fixture wrote onto the match.
    const handle = (await prisma.seasonEntrant.findUnique({ where: { id: ids[0] }, select: { cueverseId: true } }))!.cueverseId
    const seedsFor = (h: string) =>
      rounds.flatMap((r) => r.matches.flatMap((m) => [m.a, m.b])).filter((s) => s?.handle === h).map((s) => s?.seed)
    check('the same player shows the same seed in both rounds',
      seedsFor(handle!).length === 2 && seedsFor(handle!).every((s) => s === 1), JSON.stringify(seedsFor(handle!)))
    check('a seed missing from the match row is recovered from the player',
      rounds[1].matches[0].b?.seed === 2, String(rounds[1].matches[0].b?.seed))
    check('no player in the bracket is missing a seed',
      rounds.flatMap((r) => r.matches.flatMap((m) => [m.a, m.b]))
        .filter((s) => s?.name && s.name !== 'Bye').every((s) => typeof s?.seed === 'number'))
  }

  console.log('')
  console.log('--- Byes never hold a seed and never count towards N ---')
  {
    const { seasonId, ids } = await fixtureSeason(980003, 3)
    await prisma.$transaction(async (tx) => {
      await persistSeeds(tx, seasonId, assignSeeds(ids.map((id, i) => ({ entrantId: id, order: i + 1 }))))
    })
    await prisma.seasonPlayoffMatch.create({
      data: { seasonId, round: 1, slot: 0, homeEntrantId: ids[0], awayEntrantId: null, homeUsername: 'a', awayUsername: 'Bye', homeSeed: 1 },
    })
    const rounds = await seasonPlayoffRounds(seasonId)
    const bye = rounds[0].matches[0].b
    check('the bye slot carries no seed', bye?.seed == null)
    check('the seeded set is still 1..3, unaffected by the bye',
      (await seedsByEntrant(prisma, seasonId)).size === 3)
  }

  console.log('')
  console.log('--- Season 1: the repair, on the real data ---')
  {
    const s1 = await prisma.season.findFirst({ where: { number: 1, competitionYear: 2005, competitionSeries: { slug: '8brcam' } }, select: { id: true, lifecycleState: true } })
    if (!s1) {
      check('Season 1 is present', false, 'missing')
    } else {
      check('Season 1 is present and completed', s1.lifecycleState === 'COMPLETED')
      const seeds = await seedsByEntrant(prisma, s1.id)
      check('all 16 playoff participants are seeded', seeds.size === 16, String(seeds.size))
      check('the seeds form a complete 1..16 set',
        [...seeds.values()].sort((a, b) => a - b).join(',') === Array.from({ length: 16 }, (_, i) => i + 1).join(','))
      check('validation accepts the repaired set',
        (await threw(() => validateSeedSet([...seeds].map(([entrantId, seed]) => ({ entrantId, seed }))))) === null)

      const rounds = await seasonPlayoffRounds(s1.id)
      const slots = rounds.flatMap((r) => r.matches.flatMap((m) => [m.a, m.b])).filter((s) => s?.name && s.name !== 'Bye')
      check('every rendered bracket slot shows a seed',
        slots.every((s) => typeof s?.seed === 'number'), `${slots.filter((s) => s?.seed == null).length} without one`)

      // The champion appears in all four rounds; the number must never change between them.
      const champ = slots.filter((s) => s?.handle === 'xlx_cerebro_xlx')
      check('the champion carries one seed in every round they reached',
        champ.length === 4 && new Set(champ.map((s) => s?.seed)).size === 1, `${champ.length} appearances`)
      check('and it is seed 1, as the group results dictated', champ[0]?.seed === 1, String(champ[0]?.seed))
    }
  }
} catch (e) {
  fail++
  console.error(e)
} finally {
  await cleanup()
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
