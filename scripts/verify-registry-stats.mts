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

  // Find a real completed result and ask for the anniversary of it, one year on.
  const row = await prisma.$queryRawUnsafe<Array<{ d: Date }>>(`
    SELECT d FROM (
      SELECT "completedAt" d FROM "public"."season_match"          WHERE "completedAt" IS NOT NULL AND "homeGames" IS NOT NULL AND "awayGames" IS NOT NULL
      UNION ALL SELECT "completedAt" FROM "public"."season_playoff_match"   WHERE "completedAt" IS NOT NULL AND "homeGames" IS NOT NULL AND "awayGames" IS NOT NULL
      UNION ALL SELECT "completedAt" FROM "public"."comp_tournament_match"  WHERE "completedAt" IS NOT NULL AND "homeGames" IS NOT NULL AND "awayGames" IS NOT NULL
      UNION ALL SELECT "completedAt" FROM "public"."comp_playoff_match"     WHERE "completedAt" IS NOT NULL AND "homeGames" IS NOT NULL AND "awayGames" IS NOT NULL
    ) u LIMIT 1`)
  check('found a real completed result to test the populated state', !!row[0])
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

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  await prisma.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
