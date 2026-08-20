/**
 * Generate Groups fills A, then B, then C — in the order entrants were added.
 *
 * This used to sort by rating and deal serpentine. That balances group strength, which is right for
 * a live Season where nobody has decided who plays whom, and wrong for rebuilding a historical one —
 * which is what it is mostly used for. The operator enters the roster group by group from the
 * original page, then had to drag all forty players back out of the arrangement the balancer
 * invented and find each of them again in a list.
 *
 * The fixture deliberately gives entrants ratings that ASCEND with entry order, so a rating sort
 * would reverse the list and be impossible to miss. A test where the two orders agree would pass
 * against the old behaviour too and prove nothing.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-group-entry-order.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { createSeason, closeRegistration, addSeasonEntrant } from '../src/lib/seasons/service.ts'
import { generateSeasonGroups } from '../src/lib/seasons/groups.ts'

assertLocalDatabase('verify-group-entry-order')

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++ } else { fail++; console.log('  FAIL ' + n + (d ? ` — ${d}` : '')) }
}
const section = (s: string) => console.log(`\n${s}`)

const FIXTURE_SLUG = 'zzgrporder'
const actor = { userId: 990951, username: 'verify' }

async function cleanup() {
  const strays = await prisma.season.findMany({
    where: { competitionSeries: { slug: FIXTURE_SLUG } }, select: { id: true },
  }).catch(() => [] as { id: number }[])
  for (const { id } of strays) await prisma.season.delete({ where: { id } }).catch(() => {})
  await prisma.player.deleteMany({ where: { cueverseId: { startsWith: 'zzgo_' } } }).catch(() => {})
  await prisma.auditLog.deleteMany({ where: { actorUsername: actor.username } }).catch(() => {})
  await prisma.competitionSeries.deleteMany({ where: { slug: FIXTURE_SLUG, seasons: { none: {} } } }).catch(() => {})
}

/** A Season with `count` entrants added in a known order, rated so a rating sort would reverse them. */
let fixtureSeq = 0

async function seasonWith(count: number, compId: number) {
  // A fresh handle range per Season: the unique index on the normalised CueVerse ID is global, so
  // reusing zzgo_1 across sections collides.
  const batch = ++fixtureSeq
  const made = await createSeason(actor, { competitionSeriesId: compId, accessMode: 'OPEN', lounge: 'Social' })
  if (!made.ok || made.id == null) throw new Error(made.error ?? 'could not create the Season')
  const names: string[] = []
  for (let i = 1; i <= count; i++) {
    const name = `ZZGO${batch}-${String(i).padStart(2, '0')}`
    names.push(name)
    const handle = `zzgo_${batch}_${i}`
    const p = await prisma.player.create({
      data: { primaryName: name, cueverseId: handle, cueverseIdNormalized: handle },
      select: { id: true },
    })
    const added = await addSeasonEntrant(actor, made.id, p.id)
    if (!added.ok) throw new Error(added.error ?? 'could not add an entrant')
  }
  await closeRegistration(actor, made.id)

  /*
   * Ratings are set AFTER closing, and ascend with entry order.
   *
   * Closing recomputes each entrant's snapshot from the ladder, which for brand-new players is the
   * same starting figure for everyone — and a fixture where every rating is identical cannot tell a
   * rating-sorted deal from an entry-ordered one. Writing them afterwards makes the two orders
   * disagree, which is the only way this test can fail if the sort comes back.
   */
  const rows = await prisma.seasonEntrant.findMany({
    where: { seasonId: made.id }, orderBy: { id: 'asc' }, select: { id: true },
  })
  for (let i = 0; i < rows.length; i++) {
    await prisma.seasonEntrant.update({
      where: { id: rows[i].id }, data: { ratingSnapshot: 1000 + (i + 1) * 10 },
    })
  }

  return { seasonId: made.id, names }
}

async function layout(seasonId: number) {
  const groups = await prisma.seasonGroup.findMany({
    where: { seasonId },
    orderBy: { ordinal: 'asc' },
    include: {
      players: {
        orderBy: { seed: 'asc' },
        include: { entrant: { select: { displayName: true, username: true, ratingSnapshot: true } } },
      },
    },
  })
  return groups.map((g) => ({
    code: g.code,
    members: g.players.map((p) => p.entrant.displayName || p.entrant.username || '?'),
    ratings: g.players.map((p) => p.entrant.ratingSnapshot),
  }))
}

async function main() {
  await cleanup()
  const comp = await prisma.competitionSeries.upsert({
    where: { slug: FIXTURE_SLUG },
    update: {},
    create: { slug: FIXTURE_SLUG, name: 'ZZ Group Order Fixture', shortName: 'ZZO', active: true },
    select: { id: true },
  })

  section('An even split follows entry order exactly')
  {
    const { seasonId, names } = await seasonWith(12, comp.id)
    const r = await generateSeasonGroups(actor, seasonId, 3)
    check('generation succeeded', r.ok, r.error ?? '')
    check('an even split is not reported as uneven', r.uneven === false, String(r.uneven))

    const g = await layout(seasonId)
    check('three groups exist', g.length === 3, String(g.length))
    for (const row of g) console.log(`  Group ${row.code}: ${row.members.join(', ')}`)

    check('Group A holds the first four entered', g[0]?.members.join() === names.slice(0, 4).join(), g[0]?.members.join())
    check('Group B holds the next four', g[1]?.members.join() === names.slice(4, 8).join(), g[1]?.members.join())
    check('Group C holds the last four', g[2]?.members.join() === names.slice(8, 12).join(), g[2]?.members.join())

    // The decisive one: ratings ascend with entry order, so a rating-sorted deal would put the
    // HIGHEST-rated entrant first. Group A leading with the lowest proves entry order won.
    check('the deal is not rating-ordered', (g[0]?.ratings[0] ?? 0) < (g[2]?.ratings[0] ?? 0),
      `${g[0]?.ratings[0]} vs ${g[2]?.ratings[0]}`)
    check('...and no group is internally rating-sorted descending',
      g.every((row) => row.ratings.every((v, i) => i === 0 || (v ?? 0) >= (row.ratings[i - 1] ?? 0))))

    // Serpentine would have scattered consecutive entrants across groups.
    check('consecutive entrants stay together', g[0]?.members.every((m, i) => m === names[i]) === true)

    await prisma.season.delete({ where: { id: seasonId } })
  }

  section('An uneven split puts the extras in the earliest groups')
  {
    const { seasonId, names } = await seasonWith(14, comp.id)
    const r = await generateSeasonGroups(actor, seasonId, 3)
    check('generation succeeded', r.ok, r.error ?? '')
    check('an uneven split is reported', r.uneven === true)

    const g = await layout(seasonId)
    for (const row of g) console.log(`  Group ${row.code}: ${row.members.join(', ')}`)
    check('sizes are 5, 5, 4', g.map((x) => x.members.length).join() === '5,5,4',
      g.map((x) => x.members.length).join())
    check('A takes the first five', g[0]?.members.join() === names.slice(0, 5).join(), g[0]?.members.join())
    check('B takes the next five', g[1]?.members.join() === names.slice(5, 10).join(), g[1]?.members.join())
    check('C takes the remaining four', g[2]?.members.join() === names.slice(10, 14).join(), g[2]?.members.join())
    check('every entrant is placed exactly once',
      g.flatMap((x) => x.members).sort().join() === [...names].sort().join())

    await prisma.season.delete({ where: { id: seasonId } })
  }

  section('Seeds read in entry order within each group')
  {
    const { seasonId, names } = await seasonWith(9, comp.id)
    await generateSeasonGroups(actor, seasonId, 3)
    const seeds = await prisma.seasonGroupPlayer.findMany({
      where: { group: { seasonId } },
      include: { group: { select: { ordinal: true } }, entrant: { select: { displayName: true } } },
      orderBy: [{ group: { ordinal: 'asc' } }, { seed: 'asc' }],
    })
    check('seeds restart at 1 in every group',
      seeds.filter((s) => s.seed === 1).length === 3,
      String(seeds.filter((s) => s.seed === 1).length))
    check('the flattened order is the entry order',
      seeds.map((s) => s.entrant.displayName).join() === names.join(),
      seeds.map((s) => s.entrant.displayName).join())

    await prisma.season.delete({ where: { id: seasonId } })
  }

  section('One group per entrant still works')
  {
    const { seasonId, names } = await seasonWith(6, comp.id)
    await generateSeasonGroups(actor, seasonId, 1)
    const g = await layout(seasonId)
    check('a single group holds everyone in order',
      g.length === 1 && g[0].members.join() === names.join(), g[0]?.members.join())
    await prisma.season.delete({ where: { id: seasonId } })
  }
}

let code = 0
try {
  await main()
} catch (e) {
  fail++
  console.log('\nFATAL ' + (e instanceof Error ? e.message : String(e)))
} finally {
  await cleanup()
  const left = await prisma.season.count({ where: { competitionSeries: { slug: FIXTURE_SLUG } } }).catch(() => -1)
  const players = await prisma.player.count({ where: { cueverseId: { startsWith: 'zzgo_' } } }).catch(() => -1)
  check('fixtures cleaned up', left === 0 && players === 0, `${left} seasons, ${players} players`)
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  code = fail === 0 ? 0 : 1
  await prisma.$disconnect()
}
process.exit(code)
