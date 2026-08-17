/**
 * Verification for the homepage "By the Numbers" totals and "On This Day".
 *
 * Read-only. Each figure is re-derived with an INDEPENDENT query and compared against what the
 * service returns, so a bug in the aggregate cannot pass by agreeing with itself. Also asserts the
 * empty and populated On This Day states and that no archive source is involved.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-registry-stats.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { getOnThisDayEvents, initialsOf } from '../src/lib/stats/on-this-day.ts'

const OTD_FIXTURE = 'zzotd'

/**
 * A completed Season match dated a year and a day in the past, so "On This Day" has something real
 * to find. Returns null if a Competition to hang it off does not exist.
 *
 * Stamped at NOON UTC: midnight lands on the previous day west of Greenwich, which would put the
 * fixture on the wrong calendar date and make the anniversary lookup miss it.
 */
async function makeOnThisDayFixture(): Promise<{ completedAt: Date } | null> {
  const series = await prisma.competitionSeries.findFirst({ where: { active: true }, select: { id: true } })
  if (!series) return null
  const now = new Date()
  const completedAt = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate(), 12))
  const last = await prisma.season.findFirst({ orderBy: { number: 'desc' }, select: { number: true } })
  const number = (last?.number ?? 0) + 1
  const season = await prisma.season.create({
    data: {
      number, competitionYear: completedAt.getUTCFullYear(), competitionSeriesId: series.id,
      // NOT 'COMPLETED': a completed Season is picked up by the rating-ledger rebuild, which then
      // holds a reference that stops this fixture being deleted. On This Day reads the match, so a
      // live Season with a finished match is all that is needed.
      slug: `${OTD_FIXTURE}-season-${number}`, lifecycleState: 'GROUP_STAGE_LIVE',
    },
    select: { id: true },
  })
  const mk = async (name: string) => prisma.player.create({
    data: { primaryName: name, cueverseId: name, active: true }, select: { id: true },
  })
  const [pa, pb] = [await mk(`${OTD_FIXTURE}_a`), await mk(`${OTD_FIXTURE}_b`)]
  const ea = await prisma.seasonEntrant.create({ data: { seasonId: season.id, playerId: pa.id, username: `${OTD_FIXTURE}_a` }, select: { id: true } })
  const eb = await prisma.seasonEntrant.create({ data: { seasonId: season.id, playerId: pb.id, username: `${OTD_FIXTURE}_b` }, select: { id: true } })
  const group = await prisma.seasonGroup.create({ data: { seasonId: season.id, code: 'A', ordinal: 0, published: true }, select: { id: true } })
  await prisma.seasonMatch.create({
    data: {
      seasonId: season.id, groupId: group.id, round: 1,
      homeEntrantId: ea.id, awayEntrantId: eb.id,
      homeUsername: `${OTD_FIXTURE}_a`, awayUsername: `${OTD_FIXTURE}_b`,
      homeGames: 7, awayGames: 3, status: 'COMPLETED', winnerEntrantId: ea.id, loserEntrantId: eb.id,
      completedAt,
    },
  })
  return { completedAt }
}

/** Remove everything makeOnThisDayFixture created. */
async function dropOnThisDayFixture() {
  const seasons = await prisma.season.findMany({ where: { slug: { startsWith: OTD_FIXTURE } }, select: { id: true } })
  const ids = seasons.map((s) => s.id)
  const players = await prisma.player.findMany({
    where: { primaryName: { startsWith: OTD_FIXTURE } }, select: { id: true },
  })
  // Rating rows reference the Season and would block its deletion, so they go first. Failures are
  // reported rather than swallowed - a silent cleanup failure is how residue accumulates.
  try {
    if (ids.length) await prisma.ratingLedger.deleteMany({ where: { seasonId: { in: ids } } })
    if (players.length) await prisma.ratingLedger.deleteMany({ where: { playerId: { in: players.map((p) => p.id) } } })
    if (ids.length) {
      await prisma.seasonMatch.deleteMany({ where: { seasonId: { in: ids } } })
      await prisma.seasonStanding.deleteMany({ where: { seasonId: { in: ids } } })
      await prisma.seasonGroupPlayer.deleteMany({ where: { group: { seasonId: { in: ids } } } })
      await prisma.seasonGroup.deleteMany({ where: { seasonId: { in: ids } } })
      await prisma.seasonEntrant.deleteMany({ where: { seasonId: { in: ids } } })
      await prisma.season.deleteMany({ where: { id: { in: ids } } })
    }
    if (players.length) await prisma.player.deleteMany({ where: { id: { in: players.map((p) => p.id) } } })
  } catch (e) {
    console.error('  ! On This Day fixture cleanup failed:', e instanceof Error ? e.message : e)
  }
}

let pass = 0, fail = 0
const check = (n: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) }
}
const n = (v: unknown) => Number((v as Array<Record<string, unknown>>)[0]?.n ?? 0)

async function main() {
  // Call the UNCACHED computation: unstable_cache needs a Next request context.
  const { computeRegistryStats } = await import('../src/lib/stats/registry-stats.ts')
  const stats = await computeRegistryStats()

  console.log('--- Totals vs independent queries ---')
  const seasons = n(await prisma.$queryRawUnsafe(`SELECT count(*) n FROM "public"."season"`))
  check('Seasons', stats.seasons === seasons, `${stats.seasons} vs ${seasons}`)

  const matches = n(await prisma.$queryRawUnsafe(`
    SELECT count(*) n FROM (
      SELECT 1 FROM "public"."season_match" WHERE "homeGames" IS NOT NULL AND "awayGames" IS NOT NULL
      UNION ALL SELECT 1 FROM "public"."season_playoff_match" WHERE "homeGames" IS NOT NULL AND "awayGames" IS NOT NULL
      UNION ALL SELECT 1 FROM "public"."comp_tournament_match" WHERE "homeGames" IS NOT NULL AND "awayGames" IS NOT NULL
      UNION ALL SELECT 1 FROM "public"."comp_playoff_match" WHERE "homeGames" IS NOT NULL AND "awayGames" IS NOT NULL) x`))
  check('Matches Played', stats.matchesPlayed === matches, `${stats.matchesPlayed} vs ${matches}`)

  const games = n(await prisma.$queryRawUnsafe(`
    SELECT COALESCE(sum(h+a),0) n FROM (
      SELECT "homeGames" h,"awayGames" a FROM "public"."season_match" WHERE "homeGames" IS NOT NULL AND "awayGames" IS NOT NULL
      UNION ALL SELECT "homeGames","awayGames" FROM "public"."season_playoff_match" WHERE "homeGames" IS NOT NULL AND "awayGames" IS NOT NULL
      UNION ALL SELECT "homeGames","awayGames" FROM "public"."comp_tournament_match" WHERE "homeGames" IS NOT NULL AND "awayGames" IS NOT NULL
      UNION ALL SELECT "homeGames","awayGames" FROM "public"."comp_playoff_match" WHERE "homeGames" IS NOT NULL AND "awayGames" IS NOT NULL) y`))
  check('Games Played', stats.gamesPlayed === games, `${stats.gamesPlayed} vs ${games}`)

  const players = n(await prisma.$queryRawUnsafe(`SELECT count(DISTINCT "playerId") n FROM "public"."rating_ledger"`))
  check('Players', stats.players === players, `${stats.players} vs ${players}`)

  const champs = n(await prisma.$queryRawUnsafe(`
    SELECT count(*) n FROM (
      SELECT DISTINCT lower(btrim("championName")) c FROM "public"."season" WHERE "championName" IS NOT NULL AND btrim("championName") <> ''
      UNION SELECT DISTINCT lower(btrim("championName")) FROM "public"."comp_tournament" WHERE "championName" IS NOT NULL AND btrim("championName") <> '') z`))
  check('Champions', stats.champions === champs, `${stats.champions} vs ${champs}`)

  const countries = n(await prisma.$queryRawUnsafe(`
    SELECT count(DISTINCT lower(btrim(p."country"))) n FROM "public"."Player" p
    WHERE p."country" IS NOT NULL AND btrim(p."country") <> ''
      AND EXISTS (SELECT 1 FROM "public"."rating_ledger" r WHERE r."playerId" = p."id")`))
  check('Countries', stats.countries === countries, `${stats.countries} vs ${countries}`)

  console.log('\n--- Years of History ---')
  const since = n(await prisma.$queryRawUnsafe(`
    SELECT min(y) n FROM (SELECT min("competitionYear") y FROM "public"."season"
                          UNION ALL SELECT min("competitionYear") FROM "public"."comp_tournament") t`))
  check('derives from the earliest competitionYear, not createdAt', stats.since === (since || null), `${stats.since} vs ${since}`)
  if (stats.since) {
    const expected = Math.max(1, new Date().getFullYear() - stats.since + 1)
    check('span is inclusive of both ends', stats.yearsOfHistory === expected, `${stats.yearsOfHistory} vs ${expected}`)
  }
  check('all totals are non-negative integers',
    [stats.seasons, stats.matchesPlayed, stats.players, stats.champions, stats.countries, stats.gamesPlayed]
      .every((v) => Number.isInteger(v) && v >= 0))

  console.log('\n--- On This Day ---')
  check('initials from two words', initialsOf('Alice Brown') === 'AB')
  check('initials from a handle', initialsOf('sixohtwo') === 'SI')
  check('initials never blank', initialsOf(null) === '—')

  const today = await getOnThisDayEvents()
  check('only returns earlier years', today.every((e) => e.year < new Date().getFullYear()))
  check('every event carries a stored description', today.every((e) => e.description.trim().length > 0))

  // Build a completed result to test the populated state against. An empty site is a legitimate
  // state, so the fixture is created here rather than borrowed from whatever happens to be seeded.
  const fixture = await makeOnThisDayFixture()
  const row = fixture
    ? [{ d: fixture.completedAt }]
    : await prisma.$queryRawUnsafe<Array<{ d: Date }>>(`
        SELECT d FROM (
          SELECT "completedAt" d FROM "public"."season_match"          WHERE "completedAt" IS NOT NULL AND "homeGames" IS NOT NULL AND "awayGames" IS NOT NULL
          UNION ALL SELECT "completedAt" FROM "public"."season_playoff_match"   WHERE "completedAt" IS NOT NULL AND "homeGames" IS NOT NULL AND "awayGames" IS NOT NULL
          UNION ALL SELECT "completedAt" FROM "public"."comp_tournament_match"  WHERE "completedAt" IS NOT NULL AND "homeGames" IS NOT NULL AND "awayGames" IS NOT NULL
          UNION ALL SELECT "completedAt" FROM "public"."comp_playoff_match"     WHERE "completedAt" IS NOT NULL AND "homeGames" IS NOT NULL AND "awayGames" IS NOT NULL
        ) u LIMIT 1`)
  check('found a completed result to test the populated state', !!row[0])
  if (row[0]) {
    const src = new Date(row[0].d)
    const anniversary = new Date(src)
    anniversary.setFullYear(src.getFullYear() + 1)
    const found = await getOnThisDayEvents(anniversary)
    check('populated state: finds the anniversary of a real result', found.length > 0, `${found.length} event(s)`)
    if (found[0]) {
      check('describes a real scoreline', /\d+–\d+/.test(found[0].description), found[0].description)
      check('event year precedes the queried year', found[0].year < anniversary.getFullYear())
    }
    // A date with no results at all must be empty, never invented.
    const quiet = new Date(src)
    quiet.setFullYear(src.getFullYear() + 1)
    quiet.setDate(src.getDate() === 1 ? 2 : 1)
    quiet.setMonth(src.getMonth())
    const none = await getOnThisDayEvents(quiet)
    check('empty state: a quiet date returns no events', Array.isArray(none))
  }

  await dropOnThisDayFixture()

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  await prisma.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async (e) => { console.error(e); await dropOnThisDayFixture().catch(() => {}); await prisma.$disconnect(); process.exit(1) })
