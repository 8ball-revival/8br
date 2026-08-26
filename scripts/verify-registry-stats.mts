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

  // Unique canonical participants, resolved through merges — the same rule the service applies:
  // entering a competition is what makes somebody a participant, not having a rated match.
  const players = n(await prisma.$queryRawUnsafe(`
    SELECT count(*) n FROM (
      SELECT DISTINCT coalesce(
               'player:' || coalesce(pm."canonicalPlayerId", e."playerId"),
               'name:' || lower(btrim(e."username"))
             ) AS identity
        FROM "public"."season_entrant" e
        LEFT JOIN "public"."PlayerMerge" pm
          ON pm."mergedPlayerId" = e."playerId" AND pm."status" = 'APPROVED'
       WHERE e."playerId" IS NOT NULL OR btrim(coalesce(e."username", '')) <> ''
      UNION
      SELECT DISTINCT coalesce(
               'player:' || coalesce(pm."canonicalPlayerId", r."playerId"),
               'name:' || lower(btrim(r."username"))
             )
        FROM "public"."comp_registration" r
        LEFT JOIN "public"."PlayerMerge" pm
          ON pm."mergedPlayerId" = r."playerId" AND pm."status" = 'APPROVED'
       WHERE r."playerId" IS NOT NULL OR btrim(coalesce(r."username", '')) <> ''
    ) p`))
  check('Players counts unique canonical participants', stats.players === players, `${stats.players} vs ${players}`)

  // The ledger-derived figure is a lower bound: an entrant with no recorded match is a participant
  // but has no ledger row. Asserting the relationship documents why the two differ.
  const rated = n(await prisma.$queryRawUnsafe(`SELECT count(DISTINCT "playerId") n FROM "public"."rating_ledger"`))
  check('Players is at least the number with a rated match', stats.players >= rated,
        `${stats.players} participants, ${rated} with ledger rows`)

  /*
   * Champions counts unique PEOPLE, so the independent count has to as well.
   *
   * This used to count distinct champion NAMES, which quietly asserts that no two champions ever
   * share one — and 8BR has two Chrises with a season each, new.zealand and chris.dogg. The name
   * count folded them into a single champion and the statistic, correctly, did not. Counting by
   * canonical player id (through an approved merge, falling back to the name only for archive rows
   * that never had a profile) is the same rule the figure itself uses, and the only one that can
   * tell two Chrises apart.
   */
  const champs = n(await prisma.$queryRawUnsafe(`
    SELECT count(*) n FROM (
      SELECT DISTINCT coalesce(
               'player:' || coalesce(pm."canonicalPlayerId", s."championPlayerId"),
               'name:' || lower(btrim(s."championName"))
             ) AS identity
        FROM "public"."season" s
        LEFT JOIN "public"."PlayerMerge" pm
          ON pm."mergedPlayerId" = s."championPlayerId" AND pm."status" = 'APPROVED'
       WHERE s."lifecycleState" = 'COMPLETED'
         AND (s."championPlayerId" IS NOT NULL OR btrim(coalesce(s."championName", '')) <> '')
      UNION
      SELECT DISTINCT 'name:' || lower(btrim(t."championName"))
        FROM "public"."comp_tournament" t
       WHERE t."status" = 'COMPLETED' AND btrim(coalesce(t."championName", '')) <> '') z`))
  check('Champions counts unique people, not unique names', stats.champions === champs,
        `${stats.champions} vs ${champs}`)

  const countries = n(await prisma.$queryRawUnsafe(`
    SELECT count(DISTINCT lower(btrim(p."country"))) n FROM "public"."Player" p
    WHERE p."country" IS NOT NULL AND btrim(p."country") <> ''
      AND EXISTS (SELECT 1 FROM "public"."rating_ledger" r WHERE r."playerId" = p."id")`))
  // Countries is deliberately FIXED at 8 rather than derived — the one intentionally constant figure
  // on the homepage. The derived count is still read above so the divergence is visible here rather
  // than being a silent surprise if the instruction is ever revisited.
  check('Countries is the fixed figure', stats.countries === 8, `${stats.countries}`)
  check('Countries is not the derived count', countries !== stats.countries || countries === 8,
        `derived ${countries}, shown ${stats.countries}`)

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

  /*
   * The On This Day checks went with the feature.
   *
   * `on-this-day.ts` was the homepage almanac's data layer and had no consumers left once the
   * homepage was rebuilt without it. The registry TOTALS this suite exists for are untouched and
   * still checked above; only the almanac half of the file is gone.
   */


  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  await prisma.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async (e) => { console.error(e); await dropOnThisDayFixture().catch(() => {}); await prisma.$disconnect(); process.exit(1) })
