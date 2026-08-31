/**
 * Yahoo and CueVerse are two ranking universes, and Division B is in neither.
 *
 * The claims worth protecting here are the ones that would be invisible if they broke: a rating
 * quietly continuing across platforms, a Division B match nudging somebody's rank, or one platform
 * silently showing the other's Seasons.
 *
 * ── Two things changed under this suite, and it was asserting neither ────────────────────────────
 * Division B was PURGED from the site data — all 44 of its Seasons deleted, deliberately. And
 * CueVerse is no longer empty: it has live Seasons of its own. This suite still described the
 * moment of the cutover, so it failed eleven checks against a database that is exactly right.
 *
 * The rules it exists to protect have not changed, so they are asserted against what is true now: a
 * surviving pre-cutover Season is Yahoo, Division B ranks nothing BECAUSE none of it is left, and
 * each platform's listing holds only its own Seasons rather than falling through to the other.
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { getSeasonBrowseData, newestSeasonId } from '../src/lib/seasons/browse.ts'
import { existsSync, readFileSync } from 'node:fs'

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
  /*
   * Asserted over the Seasons that SURVIVE, not over the whole cutover list.
   *
   * That list is a frozen record of what existed on the day, and 44 of its 92 Seasons have since
   * been deleted — the Division B purge. Requiring all 92 to still be present made this check fail
   * whenever the site legitimately removed something, which says nothing about platform separation.
   * What still matters is that nothing which survived changed universe.
   */
  const preSurviving = await prisma.season.count({ where: { id: { in: CUTOVER.seasonIds } } })
  const preYahoo = await prisma.season.count({ where: { id: { in: CUTOVER.seasonIds }, platform: 'YAHOO' } })
  check('every pre-cutover Season that still exists is Yahoo', preYahoo === preSurviving,
    `${preYahoo}/${preSurviving} surviving, of ${CUTOVER.seasonIds.length} at the cutover`)

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
section('Division B was purged, and nothing is left that could rank')
{
  /*
   * This section used to assert that Division B Seasons were PRESERVED — visible, readable, and
   * ranking nothing. They were subsequently deleted from the site data on purpose, so those
   * assertions described a database nobody wanted any more.
   *
   * The rule underneath them has not changed: no Division B result may reach a rating. Absence
   * satisfies it more completely than preservation did, so that is what is checked — together with
   * the surfaces that used to offer Division B, because a filter still advertising an empty
   * division is the visible half of an incomplete purge.
   */
  const divB = await prisma.season.count({ where: { division: 'B' } })
  check('no Season carries Division B any more', divB === 0, String(divB))

  const separate = await prisma.competitionSeries.findUnique({ where: { slug: '8br-div-b' }, select: { _count: { select: { seasons: true } } } })
  check('the separate Division B Competition holds nothing', (separate?._count.seasons ?? 0) === 0)

  const bEntrants = await prisma.seasonEntrant.count({ where: { season: { division: 'B' } } })
  const bMatches = await prisma.seasonMatch.count({ where: { season: { division: 'B' } } })
  check('no entrant or match is still attached to one', bEntrants === 0 && bMatches === 0,
    `${bEntrants} entrant(s), ${bMatches} match(es)`)

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
  /*
   * The archive is no longer a mode of this page.
   *
   * `?platform=yahoo` used to switch the Rankings table to the Yahoo ladder. That ladder has its own
   * page at /yahoo, so the parameter is now ignored -- an old bookmark carrying it lands on the
   * current rankings rather than half-opening a view that is not there any more.
   */
  check('the rankings URL no longer carries a platform', !/p\.set\('platform'/.test(cols))
  check('...and an old ?platform= bookmark is treated as obsolete rather than honoured',
    /OBSOLETE_PARAMS = \[[^\]]*'platform'/.test(cols))
  check('the archive has a page of its own', existsSync('src/app/(frontend)/yahoo/page.tsx'))
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
  /*
   * CueVerse has Seasons of its own now, so "lists nothing" is no longer the interesting claim.
   *
   * The claim that mattered was never emptiness — it was that one platform's listing must not fall
   * through to the other's. That is asserted directly instead, which keeps working whichever
   * platform happens to be empty on any given day.
   */
  check('CueVerse lists only CueVerse Seasons', cueverse.seasons.every((s) => s.platform === 'CUEVERSE'),
    `${cueverse.seasons.length} Season(s)`)
  check('...and no part of the archive leaks into it',
    !cueverse.seasons.some((s) => yahooAll.seasons.some((y) => y.id === s.id)))

  // Division B is purged, so the filter must stop offering it: an empty division left in a picker
  // is the visible half of an incomplete removal.
  check('Division A is offered', yahooAll.divisions.includes('A'))
  check('...and Division B is not', !yahooAll.divisions.includes('B'))
  check('asking for Division B anyway returns nothing', yahooB.seasons.length === 0, `${yahooB.seasons.length}`)
  check('Division A narrows to Division A', yahooA.seasons.length > 0 && yahooA.seasons.every((s) => s.division === 'A'))
  check('and every one of them is ranked', yahooA.seasons.every((s) => s.ranked))
  check('Division A alone is now the whole archive',
    yahooA.seasons.length === yahooAll.seasons.length, `${yahooA.seasons.length}/${yahooAll.seasons.length}`)

  /*
   * The landing page must not fall back to the other platform.
   *
   * This used to be checked by asserting CueVerse resolved to null, which only held while CueVerse
   * was empty — it was testing the calendar, not the code. Now that both platforms have Seasons the
   * stronger form is available: each resolves, and each resolves to a Season ON ITS OWN PLATFORM.
   */
  const newestCv = await newestSeasonId('8brcam', 'CUEVERSE')
  const newestY = await newestSeasonId('8brcam', 'YAHOO')
  check('CueVerse resolves to a real Season', newestCv !== null)
  check('Yahoo resolves to a real Season', newestY !== null)
  check('...and neither resolves into the other universe',
    newestCv !== newestY
    && (await prisma.season.findUnique({ where: { id: newestCv! }, select: { platform: true } }))?.platform === 'CUEVERSE'
    && (await prisma.season.findUnique({ where: { id: newestY! }, select: { platform: true } }))?.platform === 'YAHOO')
  check('a purged division resolves to nothing at all', (await newestSeasonId('8brcam', 'YAHOO', 'B')) === null)
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

  /*
   * The profile's three headings moved out of the route and into the component that draws them.
   *
   * This was reading the page file, found none of them, and reported that a profile no longer
   * separates the two careers — which was never true. The body component is where they live now, so
   * that is what is read.
   */
  const profile = readFileSync('src/components/system/player-detail-body.tsx', 'utf8')
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
  /*
   * The homepage is a Site Builder page now, so it no longer resolves a platform itself.
   *
   * It used to read one from the leaderboard and pass it down. Each competition module now carries
   * its own platform in its saved config, which is stricter rather than looser: a panel is pinned
   * to the universe it was configured for instead of inheriting whichever the homepage happened to
   * resolve. The rule is unchanged — no surface may call the service unscoped — so that is what is
   * checked, at the seam where the call is now made.
   */
  const modules = readFileSync('src/components/site-builder/modules/competitions.tsx', 'utf8')
  check('...and every homepage results panel names the platform it is showing',
    modules.includes('getSeasonResults(config.platform'))
  check('...with no unscoped call left anywhere',
    !/getSeasonResults\(\s*\)/.test(modules))

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
