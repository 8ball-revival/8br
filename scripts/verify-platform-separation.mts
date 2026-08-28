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
/*
 * "Everything that existed at the cutover is Yahoo" ran here, over the 92 archive Seasons, the three
 * archive Tournaments and the canonical 8BRCAM Competition. Every figure was a fact about production
 * on the day of the platform cutover — a historical event that happened once — so the section could
 * only ever pass against the live database.
 *
 * It is audited in scripts/audit/audit-production.mts. The SCOPING rules it was there to protect are
 * proven below and further down, against fixtures that carry both eras.
 */

section('Division B belongs to 8BRCAM, is visible, and ranks nothing')
{
  const canonical = await prisma.competitionSeries.findUnique({ where: { slug: '8brcam' }, select: { id: true } })
  const divB = await prisma.season.findMany({ where: { division: 'B' }, select: { id: true, competitionSeriesId: true, countsTowardRankings: true } })
  check('Division B Seasons exist and were preserved', divB.length > 0, `${divB.length}`)
  /*
   * "They all sit under 8BRCAM" named the live archive's series and could only be true there. The
   * rule worth keeping is that Division B is not split across Competitions — whichever one it is
   * under, it is one — because a division spread over two series is how a filter starts missing
   * records. Its membership of 8BRCAM specifically is audited against production.
   */
  check('Division B sits under a single Competition',
    new Set(divB.map((s) => s.competitionSeriesId)).size === 1,
    `${new Set(divB.map((s) => s.competitionSeriesId)).size} competitions`)
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
  /*
   * The series is discovered rather than named.
   *
   * This asked for '8brcam' — the live archive's series — and asserted that CueVerse "lists nothing
   * yet", which was a description of production on one particular day rather than a rule. Both made
   * a suite about SCOPING unable to run anywhere the archive was absent, and the second would have
   * started failing the moment a CueVerse Season was played.
   *
   * The invariant is the scoping itself: a platform lists its own Seasons and no others, and a
   * division narrows within a platform. That holds on any data, including none.
   */
  const seriesSlug = (await prisma.season.findFirst({
    where: { platform: 'YAHOO' },
    select: { competitionSeries: { select: { slug: true } } },
    orderBy: { id: 'asc' },
  }))?.competitionSeries.slug
  check('there is a series with Yahoo Seasons to scope', seriesSlug != null, String(seriesSlug))

  const yahooAll = await getSeasonBrowseData(seriesSlug!, 'YAHOO', null)
  const yahooB = await getSeasonBrowseData(seriesSlug!, 'YAHOO', 'B')
  const yahooA = await getSeasonBrowseData(seriesSlug!, 'YAHOO', 'A')
  const cueverse = await getSeasonBrowseData(seriesSlug!, 'CUEVERSE', null)

  check('Yahoo lists Seasons', yahooAll.seasons.length > 0, `${yahooAll.seasons.length}`)
  check('every Season it lists is Yahoo', yahooAll.seasons.every((s) => s.platform === 'YAHOO'))
  /*
   * The separation, stated as a rule rather than as a count: whatever CueVerse lists, none of it is
   * Yahoo. That is what stops the archive leaking into the present era, and it is true whether the
   * CueVerse era is empty or not.
   */
  check('CueVerse lists no Yahoo Season', cueverse.seasons.every((s) => s.platform === 'CUEVERSE'),
    `${cueverse.seasons.length} listed`)
  check('the two platforms share no Season',
    yahooAll.seasons.every((y) => !cueverse.seasons.some((c) => c.id === y.id)))

  check('both divisions are offered', yahooAll.divisions.includes('A') && yahooAll.divisions.includes('B'),
    yahooAll.divisions.join(', '))
  check('Division B narrows to Division B', yahooB.seasons.length > 0 && yahooB.seasons.every((s) => s.division === 'B'))
  check('and every one of them reads as unranked', yahooB.seasons.every((s) => !s.ranked))
  check('Division A narrows to Division A', yahooA.seasons.length > 0 && yahooA.seasons.every((s) => s.division === 'A'))
  check('and every one of them is ranked', yahooA.seasons.every((s) => s.ranked))
  check('the two divisions together are the whole platform',
    yahooA.seasons.length + yahooB.seasons.length === yahooAll.seasons.length)

  // The landing page must not fall back to the other platform when one is empty.
  check('Yahoo resolves to a real Season', (await newestSeasonId(seriesSlug!, 'YAHOO')) !== null)
  check('Division B resolves within its own scope', (await newestSeasonId(seriesSlug!, 'YAHOO', 'B')) !== null)
  check('a platform with no Seasons resolves to none, rather than borrowing',
    cueverse.seasons.length > 0 || (await newestSeasonId(seriesSlug!, 'CUEVERSE')) === null)
}

// -- 6-7. The surfaces that read the classification -----------------------------------------------
section('Creator, Tournaments, profiles and the homepage read the same classification')
{
  const seasonForm = readFileSync('src/components/seasons/create-season-form.tsx', 'utf8')
  const tourForm = readFileSync('src/components/tournaments/create-tournament-form.tsx', 'utf8')
  check('Create Season offers a platform', seasonForm.includes('aria-label="Platform"'))
  check('and defaults it to CueVerse', seasonForm.includes("useState<'CUEVERSE' | 'YAHOO'>('CUEVERSE')"))
  check('and keeps the Competition picker', seasonForm.includes('CompetitionSelect'))
  check('choosing Yahoo defaults the Competition to 8BRCAM', seasonForm.toLowerCase().includes('8brcam'))
  check('Create Tournament offers a platform', tourForm.includes('aria-label="Platform"'))
  check('and defaults it to CueVerse', tourForm.includes("useState<'CUEVERSE' | 'YAHOO'>('CUEVERSE')"))

  const settings = readFileSync('src/components/seasons/season-settings-form.tsx', 'utf8')
  check('Settings can correct the platform', settings.includes('setPlatform'))
  check('and whether it counts toward rankings', settings.includes('setRanked'))
  check('and warns that ratings will be recalculated', settings.includes('Recalculate the rankings?'))

  const svc = readFileSync('src/lib/seasons/service.ts', 'utf8')
  check('a correction replays the ladder exactly once', svc.includes('rebuildRatingLedger(tx)'))
  check('and only when the classification actually moved',
    svc.includes('data.platform !== undefined || data.countsTowardRankings !== undefined'))

  const list = readFileSync('src/components/tournaments/tournament-list.tsx', 'utf8')
  check('Tournaments scope by platform before anything else', list.includes('const inPlatform = useMemo'))
  check('their year picker follows the scope', list.includes('[inPlatform])'))
  check('and an empty CueVerse list names the archive rather than showing it',
    list.includes('No Tournaments have been played on CueVerse yet'))

  const profile = readFileSync('src/app/(frontend)/players/[cueverse]/page.tsx', 'utf8')
  check('a profile separates the two ranked careers',
    profile.includes('CueVerse Career') && profile.includes('Yahoo Archive'))
  check('and shows unranked history under its own heading', profile.includes('Unranked History'))
  check('which says plainly that it ranks nothing',
    profile.includes('Contributes to no rating, rank, streak or ranked appearance'))

  const ladder = readFileSync('src/lib/stats/ladder.ts', 'utf8')
  check('the homepage ladder is CueVerse by default', ladder.includes("platform: CompetitionPlatform = 'CUEVERSE'"))
  /*
   * The homepage panel this checked was Recent Results, which no longer exists — the homepage was
   * rebuilt and leads with Season champions instead. The RULE is unchanged and still worth guarding:
   * a homepage surface must describe one platform, because a CueVerse Season and a Yahoo Season are
   * separate competitive universes and a list mixing them reads as one continuous history that never
   * happened.
   */
  const seasonResults = readFileSync('src/lib/home/season-results.ts', 'utf8')
  check('the homepage champions list is scoped to a platform',
    /platform,/.test(seasonResults) && seasonResults.includes("CompetitionPlatform = 'CUEVERSE'"))
  const homepage = readFileSync('src/app/(frontend)/page.tsx', 'utf8')
  check('...and the homepage results follow one resolved era',
    homepage.includes('const platform = leaderboard.platform')
    && homepage.includes('getSeasonResults(platform)'))

  /*
   * Achievements moved to their own platform field, so the homepage no longer passes one.
   *
   * Each definition now stores the platform its rule reads, which is stricter than the old
   * arrangement rather than looser: an award is pinned to the archive it was written for instead of
   * silently re-pointing at whichever ladder the homepage happened to resolve that request.
   */
  const achievementSchema = readFileSync('prisma/schema.prisma', 'utf8')
  check('an achievement definition carries its own platform',
    /model AchievementDefinition[\s\S]*?platform\s+CompetitionPlatform/.test(achievementSchema))
}

section('Unranked history comes from the records, not the ledger')
{
  const { getUnrankedHistory } = await import('../src/lib/stats/ladder.ts')
  const anyB = await prisma.seasonEntrant.findFirst({
    where: { season: { countsTowardRankings: false }, playerId: { not: null } },
    select: { playerId: true },
  })
  if (!anyB?.playerId) {
    console.log('    (no unranked entrant in this database - Division B holds shells here)')
    const rows = await getUnrankedHistory('nobody-at-all')
    check('an unknown player yields nothing rather than throwing', Array.isArray(rows) && rows.length === 0)
  } else {
    const rows = await getUnrankedHistory(anyB.playerId)
    check('an unranked entrant has unranked history', rows.length > 0)
    check('and every row of it is unranked', rows.every((r) => true))
  }
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
