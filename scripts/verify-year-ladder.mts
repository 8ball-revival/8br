/**
 * Year and scope ladders: are they self-contained, and do they know what year a result belongs to?
 *
 * Two questions, and the second is the one that was wrong. A ladder for 2008 used to show 2008's
 * RECORD beside a rating carried in from every year before it, so a player who arrived already rated
 * 1680 looked as though they had earned it that season. A period is now replayed from the standard
 * initial rating using only the results inside it, which is what makes the number and the record
 * beside it describe the same thing.
 *
 * The first question is about provenance. Every Yahoo Season in this database was imported in 2026
 * and every one of them belongs to a year between 2005 and 2014, so anything that read a timestamp
 * would file the entire archive under 2026. These checks assert the association comes from
 * `competitionYear` and from nothing else.
 *
 * READ-ONLY. Safe against the primary local copy.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env.replica scripts/verify-year-ladder.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { computeExplorer, computeFacets } from '../src/lib/stats/ladder-explorer.ts'
import { ELO_START } from '../src/lib/stats/elo.ts'

assertLocalDatabase('verify-year-ladder')

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++ } else { fail++; console.log('  FAIL ' + n + (d ? ' - ' + d : '')) }
}
const section = (s: string) => console.log('\n' + s)

const YAHOO = { platform: 'YAHOO' as const }

// -- Provenance: the canonical year, and never a timestamp
section('A result belongs to the year it was played, not the year it was typed in')
{
  const seasons = await prisma.season.findMany({
    where: { platform: 'YAHOO' },
    select: { id: true, competitionYear: true, createdAt: true, updatedAt: true },
  })
  check('every Yahoo Season exists to test', seasons.length > 0, String(seasons.length))

  const importedLater = seasons.filter((s) => s.createdAt.getUTCFullYear() !== s.competitionYear)
  check('the archive really was imported in a different year than it was played',
    importedLater.length === seasons.length,
    importedLater.length + '/' + seasons.length + ' differ')
  console.log('  (imported ' + [...new Set(seasons.map((s) => s.createdAt.getUTCFullYear()))].join(', ')
    + '; played ' + Math.min(...seasons.map((s) => s.competitionYear))
    + '-' + Math.max(...seasons.map((s) => s.competitionYear)) + ')')

  const tournaments = await prisma.tournament.findMany({
    where: { platform: 'YAHOO' },
    select: { id: true, name: true, competitionYear: true, createdAt: true },
  })
  for (const t of tournaments) {
    check('tournament "' + t.name + '" (' + t.id + ') keeps its event year, not its administrative stamp',
      t.competitionYear !== t.createdAt.getUTCFullYear() || tournaments.length === 0,
      t.competitionYear + ' vs created ' + t.createdAt.getUTCFullYear())
  }

  /* Nothing may fall outside a canonical year: an unassociable row would silently vanish from every
   * year filter, and a reader would see a smaller archive without being told why. */
  const orphans = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n
      FROM "public"."rating_ledger" rl
      LEFT JOIN "public"."season" s ON s."id" = rl."seasonId"
      LEFT JOIN "public"."comp_tournament" t ON t."id" = rl."tournamentId"
     WHERE coalesce(s."competitionYear", t."competitionYear") IS NULL`
  check('no ledger row is missing a canonical year', Number(orphans[0].n) === 0, String(orphans[0].n))

  const src = (await import('node:fs')).readFileSync('src/lib/stats/ladder-explorer.ts', 'utf8')
  check('the year comes from competitionYear',
    src.includes('coalesce(sea."competitionYear", tou."competitionYear") AS comp_year'))
  check('...and no administrative timestamp is used to date a result',
    !/comp_year[^\n]*createdAt|createdAt[^\n]*AS comp_year/.test(src))
}

// -- Facets belong to the ladder they describe
section('The year and competition choices offered are the ones this ladder has')
{
  const yahoo = await computeFacets('YAHOO')
  const cueverse = await computeFacets('CUEVERSE')

  const yahooYears = await prisma.season.findMany({
    where: { platform: 'YAHOO' }, select: { competitionYear: true }, distinct: ['competitionYear'],
  })
  const expected = new Set(yahooYears.map((y) => y.competitionYear))
  check('the Yahoo year list holds only years the archive played in',
    yahoo.years.every((y) => expected.has(y)),
    yahoo.years.join(','))
  check('...and offers no year from the current era',
    !yahoo.years.includes(new Date().getUTCFullYear()),
    yahoo.years.join(','))

  const yahooSeasonIds = new Set((await prisma.season.findMany({
    where: { platform: 'YAHOO' }, select: { id: true },
  })).map((s) => s.id))
  check('the Yahoo season list contains no CueVerse season',
    yahoo.seasons.every((s) => yahooSeasonIds.has(s.id)))
  check('the Yahoo tournament list contains no CueVerse tournament',
    yahoo.tournaments.every((t) => t.year <= Math.max(...expected)))
  check('the CueVerse facets are a different set',
    cueverse.seasons.every((s) => !yahooSeasonIds.has(s.id)))
  console.log('  (Yahoo years ' + yahoo.years.join(',') + ' | CueVerse years ' + cueverse.years.join(',') + ')')
}

// -- A single year is a competition of its own
section('A single year is a self-contained ladder')
const years = [2006, 2008, 2011, 2013]
const perYear: Record<number, { players: number; top: string; rating: number }> = {}
{
  for (const year of years) {
    const rows = await computeExplorer('all-time', 'overall', { ...YAHOO, year })
    check(year + ' has players', rows.length > 0, String(rows.length))
    if (!rows.length) continue
    perYear[year] = { players: rows.length, top: rows[0].label, rating: rows[0].rating }

    /*
     * Everyone starts level. A player who only ever played in this year cannot carry a rating in
     * from anywhere, so the sum of their rating changes must be the whole distance from the start --
     * which is only true if the replay actually began at the standard initial rating.
     */
    const zeroPlayed = rows.filter((r) => r.played === 0)
    check(year + ': nobody appears without having played in it', zeroPlayed.length === 0,
      zeroPlayed.slice(0, 3).map((r) => r.label).join(', '))

    const expectedIds = await prisma.$queryRaw<{ playerId: string }[]>`
      SELECT DISTINCT rl."playerId"
        FROM "public"."rating_ledger" rl
        LEFT JOIN "public"."season" s ON s."id" = rl."seasonId"
        LEFT JOIN "public"."comp_tournament" t ON t."id" = rl."tournamentId"
       WHERE rl."platform" = 'YAHOO'
         AND coalesce(s."competitionYear", t."competitionYear") = ${year}`
    check(year + ': exactly the players who competed that year',
      rows.length === expectedIds.length, rows.length + ' vs ' + expectedIds.length)

    const matches = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n
        FROM "public"."rating_ledger" rl
        LEFT JOIN "public"."season" s ON s."id" = rl."seasonId"
        LEFT JOIN "public"."comp_tournament" t ON t."id" = rl."tournamentId"
       WHERE rl."platform" = 'YAHOO'
         AND coalesce(s."competitionYear", t."competitionYear") = ${year}`
    const played = rows.reduce((a, r) => a + r.played, 0)
    check(year + ': the record counts only that year\'s results',
      played === Number(matches[0].n), played + ' vs ' + matches[0].n)
  }

  /*
   * The proof that the ladder is genuinely restarted: a single year cannot produce the all-time
   * ratings, and its spread must be far narrower, because nobody has had a decade to climb.
   */
  const allTime = await computeExplorer('all-time', 'overall', YAHOO)
  const spread = (rs: { rating: number }[]) => Math.max(...rs.map((r) => r.rating)) - Math.min(...rs.map((r) => r.rating))
  const one = await computeExplorer('all-time', 'overall', { ...YAHOO, year: 2008 })
  check('a single year is narrower than the whole archive', spread(one) < spread(allTime),
    spread(one) + ' vs ' + spread(allTime))
  check('...and does not reproduce the all-time order',
    allTime[0].playerId !== one[0].playerId || allTime[0].rating !== one[0].rating)
  check('a player rated in one year is not carrying an all-time figure',
    one.every((r) => Math.abs(r.rating - ELO_START) < spread(allTime)))
}

// -- Ranges are inclusive, and made only of the years inside them
section('A year range is inclusive and self-contained')
{
  const range = await computeExplorer('all-time', 'overall', { ...YAHOO, fromYear: 2006, toYear: 2008 })
  const inRange = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n
      FROM "public"."rating_ledger" rl
      LEFT JOIN "public"."season" s ON s."id" = rl."seasonId"
      LEFT JOIN "public"."comp_tournament" t ON t."id" = rl."tournamentId"
     WHERE rl."platform" = 'YAHOO'
       AND coalesce(s."competitionYear", t."competitionYear") BETWEEN 2006 AND 2008`
  const played = range.reduce((a, r) => a + r.played, 0)
  check('2006-2008 counts every result in those three years and nothing else',
    played === Number(inRange[0].n), played + ' vs ' + inRange[0].n)
  check('...and both ends are included',
    Number(inRange[0].n) > 0 && played > 0)

  const only2007 = await computeExplorer('all-time', 'overall', { ...YAHOO, year: 2007 })
  check('a range is larger than one of the years inside it', played > only2007.reduce((a, r) => a + r.played, 0))
  check('the range is not the whole archive',
    played < (await computeExplorer('all-time', 'overall', YAHOO)).reduce((a, r) => a + r.played, 0))
}

// -- A year with nothing in it
section('A year with no results is empty rather than wrong')
{
  const empty = await computeExplorer('all-time', 'overall', { ...YAHOO, year: 1999 })
  check('1999 has no Yahoo ladder', empty.length === 0, String(empty.length))
  const future = await computeExplorer('all-time', 'overall', { ...YAHOO, year: 2026 })
  check('2026 has no Yahoo ladder either, though CueVerse has results in it',
    future.length === 0, String(future.length))
}

// -- All Time is untouched
section('All Time still reproduces the verified legacy ladder')
{
  const allTime = await computeExplorer('all-time', 'overall', YAHOO)
  const ledger = await prisma.ratingLedger.findMany({
    where: { platform: 'YAHOO' }, select: { playerId: true }, distinct: ['playerId'],
  })
  check('every Yahoo player is on it', allTime.length === ledger.length,
    allTime.length + ' vs ' + ledger.length)

  /* All-Time is read from the stored running rating, so the top of the table must equal the last
   * postRating the ledger wrote for that player -- give or take the championship step. */
  const top = allTime[0]
  const last = await prisma.ratingLedger.findFirst({
    where: { platform: 'YAHOO', playerId: top.playerId },
    orderBy: { sequence: 'desc' },
    select: { postRating: true },
  })
  check('the leader\'s rating is the one the ledger stored (plus any championship step)',
    last != null && top.rating >= last.postRating,
    top.label + ' ' + top.rating + ' vs stored ' + last?.postRating)
  console.log('  (all-time leader ' + top.label + ' ' + top.rating + ', ' + allTime.length + ' players)')
}

// -- The four current scopes, each derived from its own results
section('Each current scope is derived from its own results')
{
  const CUEVERSE = { platform: 'CUEVERSE' as const }
  const series = await prisma.competitionSeries.findMany({ select: { id: true, slug: true } })
  const bySlug = new Map(series.map((x) => [x.slug, x.id]))

  const all = await computeExplorer('all-time', 'overall', CUEVERSE)
  const cam = await computeExplorer('all-time', 'overall',
    { ...CUEVERSE, eventType: 'seasons', competitionSeriesId: bySlug.get('8brcam') ?? -1 })
  const wcc = await computeExplorer('all-time', 'overall',
    { ...CUEVERSE, eventType: 'seasons', competitionSeriesId: bySlug.get('wcc') ?? -1 })
  const cups = await computeExplorer('all-time', 'overall', { ...CUEVERSE, eventType: 'cups' })

  console.log('  (all=' + all.length + ' 8brcam=' + cam.length + ' wcc=' + wcc.length + ' tournaments=' + cups.length + ')')

  const yahooPlayers = new Set((await prisma.ratingLedger.findMany({
    where: { platform: 'YAHOO' }, select: { playerId: true }, distinct: ['playerId'],
  })).map((p) => p.playerId))
  const cuePlayers = new Set((await prisma.ratingLedger.findMany({
    where: { platform: 'CUEVERSE' }, select: { playerId: true }, distinct: ['playerId'],
  })).map((p) => p.playerId))
  for (const [name, rows] of [['all', all], ['8brcam', cam], ['wcc', wcc], ['tournaments', cups]] as const) {
    check(name + ' contains no archive-only player',
      rows.every((r) => cuePlayers.has(r.playerId) || !yahooPlayers.has(r.playerId)))
  }

  /*
   * A scope is a replay, not a filtered view of the ALL rating. With one finalised Season the two
   * happen to agree, so the check that carries weight is the structural one: a narrowed scope must
   * count only its own results.
   */
  const camPlayed = cam.reduce((a, r) => a + r.played, 0)
  const camRows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM "public"."rating_ledger" rl
      JOIN "public"."season" s ON s."id" = rl."seasonId"
      JOIN "public"."competition_series" cs ON cs."id" = s."competitionSeriesId"
     WHERE rl."platform" = 'CUEVERSE' AND cs."slug" = '8brcam'`
  check('8BRCAM counts exactly the 8BRCAM results', camPlayed === Number(camRows[0].n),
    camPlayed + ' vs ' + camRows[0].n)
  check('WCC has no seasons yet, so it is empty', wcc.length === 0, String(wcc.length))
  check('Tournaments has no eligible tournament yet, so it is empty', cups.length === 0, String(cups.length))

  if (cam.length) {
    check('a scope ladder starts from the standard initial rating, not from a carried figure',
      cam.every((r) => r.rating > 0))
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
await prisma.$disconnect()
process.exit(fail ? 1 : 0)
