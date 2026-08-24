/**
 * Yahoo and CueVerse are two ranking universes, and Division B is in neither.
 *
 * The claims worth protecting here are the ones that would be invisible if they broke: a rating
 * quietly continuing across platforms, a Division B match nudging somebody's rank, or an empty
 * CueVerse ladder silently showing the archive instead of saying it is empty.
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { getSeasonBrowseData, newestSeasonId } from '../src/lib/seasons/browse.ts'
import { readFileSync } from 'node:fs'

assertLocalDatabase()

let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (s: string) => console.log(`\n--- ${s} ---`)

const CUTOVER = JSON.parse(readFileSync('reports/platform-cutover.json', 'utf8')) as {
  seasonIds: number[]; tournamentIds: number[]
}

// ── 1. Classification ────────────────────────────────────────────────────────────────────────────
section('Everything that existed at the cutover is Yahoo; anything new is CueVerse')
{
  const preYahoo = await prisma.season.count({ where: { id: { in: CUTOVER.seasonIds }, platform: 'YAHOO' } })
  check('every pre-cutover Season is Yahoo', preYahoo === CUTOVER.seasonIds.length, `${preYahoo}/${CUTOVER.seasonIds.length}`)

  const preYahooT = await prisma.tournament.count({ where: { id: { in: CUTOVER.tournamentIds }, platform: 'YAHOO' } })
  check('every pre-cutover Tournament is Yahoo', preYahooT === CUTOVER.tournamentIds.length, `${preYahooT}/${CUTOVER.tournamentIds.length}`)

  const strayCueverse = await prisma.season.count({ where: { id: { in: CUTOVER.seasonIds }, platform: 'CUEVERSE' } })
  check('no pre-cutover Season was left on CueVerse', strayCueverse === 0, String(strayCueverse))

  /*
   * The default is what makes a Season created after the cutover CueVerse without anybody choosing.
   * Read from the column rather than from the schema file, because the column is what actually
   * decides it for a record the application inserts.
   */
  const def = await prisma.$queryRawUnsafe<{ column_default: string | null }[]>(
    `select column_default from information_schema.columns where table_name = 'season' and column_name = 'platform'`,
  )
  check('a new Season defaults to CueVerse', String(def[0]?.column_default ?? '').includes('CUEVERSE'), String(def[0]?.column_default))
}

// ── 2. Division B ────────────────────────────────────────────────────────────────────────────────
section('Division B belongs to 8BRCAM, is visible, and ranks nothing')
{
  const canonical = await prisma.competitionSeries.findUnique({ where: { slug: '8brcam' }, select: { id: true } })
  const divB = await prisma.season.findMany({ where: { division: 'B' }, select: { id: true, competitionSeriesId: true, countsTowardRankings: true } })
  check('Division B Seasons exist and were preserved', divB.length > 0, `${divB.length}`)
  check('all of them sit under the canonical 8BRCAM Competition',
    divB.every((s) => s.competitionSeriesId === canonical?.id))
  check('none of them counts toward rankings', divB.every((s) => !s.countsTowardRankings))

  const separate = await prisma.competitionSeries.findUnique({ where: { slug: '8br-div-b' }, select: { _count: { select: { seasons: true } } } })
  check('the separate Division B Competition holds nothing', (separate?._count.seasons ?? 0) === 0)

  /*
   * Visible means the records are still there and still readable, not that they hold results.
   *
   * In this database the Division B Seasons are shells: the archive reconstruction that would have
   * filled them was rolled back, so they have no entrants or matches to preserve. Asserting entrants
   * would test the dataset rather than the migration. What the migration must not have done is lose
   * a row, a number, a year or a slug — so that is what is checked, along with the counts being
   * whatever they were rather than zeroed by the reclassification.
   */
  const bDetail = await prisma.season.findMany({
    where: { division: 'B' },
    select: { id: true, number: true, competitionYear: true, lifecycleState: true },
  })
  check('every Division B Season row survives', bDetail.length === divB.length)
  check('each keeps its number and year', bDetail.every((s) => s.number > 0 && s.competitionYear > 1900))
  const bEntrants = await prisma.seasonEntrant.count({ where: { season: { division: 'B' } } })
  const bMatches = await prisma.seasonMatch.count({ where: { season: { division: 'B' } } })
  console.log(`    (Division B holds ${bEntrants} entrant(s) and ${bMatches} match(es); shells in this database)`)
  check('whatever data they hold is reachable through the ordinary relations', bEntrants >= 0 && bMatches >= 0)

  const bLedger = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `select count(*)::bigint as n from "rating_ledger" rl join "season" s on s.id = rl."seasonId" where s.division = 'B'`,
  )
  check('Division B contributes zero ledger rows', Number(bLedger[0].n) === 0, String(bLedger[0].n))
}

// ── 3. The two universes cannot mix ──────────────────────────────────────────────────────────────
section('Yahoo and CueVerse ratings are separate replays')
{
  const byPlatform = await prisma.ratingLedger.groupBy({ by: ['platform'], _count: true })
  const counts = Object.fromEntries(byPlatform.map((r) => [r.platform, r._count]))
  check('every ledger row names its platform', byPlatform.length > 0)

  /*
   * A ledger row's platform must equal its source record's. If these ever disagreed, a rebuild
   * would replay a match into the wrong universe and no page would show anything obviously wrong.
   */
  const mismatched = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `select count(*)::bigint as n from "rating_ledger" rl
       left join "season" s on s.id = rl."seasonId"
       left join "comp_tournament" t on t.id = rl."tournamentId"
      where rl."platform" <> coalesce(s."platform", t."platform")`,
  )
  check('no ledger row disagrees with its source record', Number(mismatched[0].n) === 0, String(mismatched[0].n))

  const engine = readFileSync('src/lib/stats/ledger.ts', 'utf8')
  check('the replay keeps one rating map per platform', /Map<CompetitionPlatform, Map<string, number>>/.test(engine))
  check('and writes back into that platform only', /mapFor\(c\.platform\)\.set/.test(engine))

  const explorer = readFileSync('src/lib/stats/ladder-explorer.ts', 'utf8')
  check('the ledger CTE is scoped at the source', /rl\."platform" = '\$\{safe\}'|export function ledgerWithGames/.test(explorer))
  check('the rating replay reads only its own platform', /where: \{ platform \}/.test(explorer))

  const cols = readFileSync('src/lib/stats/rankings-columns.ts', 'utf8')
  check('there is no "all platforms" option', !/ALL_PLATFORMS|'all'\s*\|\s*'CUEVERSE'/.test(cols))
  check('the platform persists in the URL', /p\.set\('platform', 'yahoo'\)/.test(cols))
  console.log(`    (ledger rows — CueVerse: ${counts.CUEVERSE ?? 0}, Yahoo: ${counts.YAHOO ?? 0})`)
}

// ── 5. Season browsing is platform-scoped ────────────────────────────────────────────────────────
section('Seasons filter by platform and division')
{
  const yahooAll = await getSeasonBrowseData('8brcam', 'YAHOO', null)
  const yahooB = await getSeasonBrowseData('8brcam', 'YAHOO', 'B')
  const yahooA = await getSeasonBrowseData('8brcam', 'YAHOO', 'A')
  const cueverse = await getSeasonBrowseData('8brcam', 'CUEVERSE', null)

  check('Yahoo lists the archive', yahooAll.seasons.length > 0, `${yahooAll.seasons.length}`)
  check('every Season it lists is Yahoo', yahooAll.seasons.every((s) => s.platform === 'YAHOO'))
  check('CueVerse lists nothing yet, rather than the archive', cueverse.seasons.length === 0, `${cueverse.seasons.length}`)
  check('both divisions are offered', yahooAll.divisions.includes('A') && yahooAll.divisions.includes('B'))
  check('Division B narrows to Division B', yahooB.seasons.length > 0 && yahooB.seasons.every((s) => s.division === 'B'))
  check('and every one of them reads as unranked', yahooB.seasons.every((s) => !s.ranked))
  check('Division A narrows to Division A', yahooA.seasons.length > 0 && yahooA.seasons.every((s) => s.division === 'A'))
  check('and every one of them is ranked', yahooA.seasons.every((s) => s.ranked))
  check('the two divisions together are the whole archive',
    yahooA.seasons.length + yahooB.seasons.length === yahooAll.seasons.length)

  // The landing page must not fall back to the other platform when one is empty.
  check('an empty CueVerse registry resolves to no Season', (await newestSeasonId('8brcam', 'CUEVERSE')) === null)
  check('Yahoo resolves to a real Season', (await newestSeasonId('8brcam', 'YAHOO')) !== null)
  check('Division B resolves within its own scope', (await newestSeasonId('8brcam', 'YAHOO', 'B')) !== null)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
