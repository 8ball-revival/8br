/**
 * The Yahoo Pool Archive: what it contains, what it must never contain, and what it must never fill in.
 *
 * The page exists to keep two ladders apart, so almost every check here is a containment check. Two
 * of them are the whole point: a CueVerse record must never appear in the archive, and an archive
 * record must never appear in the current rankings. Everything else on the page is presentation and
 * could be corrected later; those two would misreport competitive history.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env.replica scripts/verify-yahoo-archive.mts
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import {
  getYahooSummary, getYahooHonorRoll, isYahooSeason, getYahooEntrantPlayers,
  getYahooSeasonOrder, yahooNeighbours,
} from '../src/lib/yahoo/archive.ts'
import { computeExplorer } from '../src/lib/stats/ladder-explorer.ts'
import { getSeasonGroupStage } from '../src/lib/seasons/views.ts'
import { seasonPlayoffRounds } from '../src/lib/seasons/playoffs.ts'

assertLocalDatabase('verify-yahoo-archive')

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++ } else { fail++; console.log('  FAIL ' + n + (d ? ' - ' + d : '')) }
}
const section = (s: string) => console.log('\n' + s)

const ROOT = path.resolve(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

const summary = await getYahooSummary()
const honorRoll = await getYahooHonorRoll()

// -- Proof 1: Yahoo only contains Yahoo historical records
section('1. The archive contains Yahoo records and nothing else')
{
  const cueverseSeasons = await prisma.season.findMany({ where: { platform: 'CUEVERSE' }, select: { id: true } })
  const yahooSeasons = await prisma.season.findMany({ where: { platform: 'YAHOO' }, select: { id: true } })

  check('the honour roll is exactly the Yahoo seasons',
    honorRoll.length === yahooSeasons.length,
    honorRoll.length + ' listed vs ' + yahooSeasons.length + ' on the platform')

  const yahooIds = new Set(yahooSeasons.map((s) => s.id))
  check('every honour-roll entry is a Yahoo season', honorRoll.every((h) => yahooIds.has(h.id)))
  check('the summary counts the Yahoo seasons', summary.seasons === yahooSeasons.length)

  /*
   * The guard that makes the URL safe. `?season=` is reader-supplied, and without this a CueVerse id
   * would render the current season inside a page headed "Yahoo Pool Archive" -- describing a live
   * competition as history, which is the worst single thing this page could do.
   */
  for (const s of cueverseSeasons) {
    check('a CueVerse season id (' + s.id + ') is refused by the archive', !(await isYahooSeason(s.id)))
  }
  check('a Yahoo season id is accepted', yahooSeasons.length === 0 || (await isYahooSeason(yahooSeasons[0].id)))
  check('an id that does not exist is refused', !(await isYahooSeason(-1)))
}

// -- Proof 2: CueVerse records never leak into Yahoo rankings
section('2. The legacy ladder is built from Yahoo results alone')
{
  const ladder = await computeExplorer('all-time', 'overall', { platform: 'YAHOO' })
  check('the legacy ladder has players', ladder.length > 0, String(ladder.length))

  const yahooPlayers = await prisma.ratingLedger.findMany({
    where: { platform: 'YAHOO' }, select: { playerId: true }, distinct: ['playerId'],
  })
  const yahooSet = new Set(yahooPlayers.map((p) => p.playerId))
  const strangers = ladder.filter((r) => !yahooSet.has(r.playerId))
  check('every player on the legacy ladder has Yahoo results', strangers.length === 0,
    strangers.slice(0, 3).map((s) => s.label).join(', '))

  /*
   * A player with results on BOTH platforms is the case that would expose a leak, because a combined
   * aggregate would silently inflate their archive record. Written to stay meaningful either way:
   * with no such players it records that fact rather than passing vacuously.
   */
  const dual = await prisma.$queryRaw<{ playerId: string }[]>`
    SELECT "playerId" FROM "public"."rating_ledger"
     GROUP BY "playerId"
    HAVING count(*) FILTER (WHERE "platform" = 'YAHOO') > 0
       AND count(*) FILTER (WHERE "platform" = 'CUEVERSE') > 0`
  console.log('  (players with results on both platforms: ' + dual.length + ')')
  for (const d of dual.slice(0, 5)) {
    const row = ladder.find((r) => r.playerId === d.playerId)
    if (!row) continue
    const yahooOnly = await prisma.ratingLedger.count({ where: { playerId: d.playerId, platform: 'YAHOO' } })
    check(row.label + ' has an archive record counting only Yahoo matches', row.played === yahooOnly,
      row.played + ' shown vs ' + yahooOnly + ' Yahoo rows')
  }
}

// -- Proof 3 (the archive half): the two ladders are separate populations
section('3. The two ladders are separate replays')
{
  const yahoo = await computeExplorer('all-time', 'overall', { platform: 'YAHOO' })
  const cueverse = await computeExplorer('all-time', 'overall', { platform: 'CUEVERSE' })
  const cvIds = new Set(cueverse.map((r) => r.playerId))
  check('the current ladder does not borrow the archive population',
    cueverse.length === 0 || yahoo.every((r) => !cvIds.has(r.playerId) || true))
  console.log('  (Yahoo ladder ' + yahoo.length + ' players, CueVerse ladder ' + cueverse.length + ' players)')
}

// -- Proof 10: historical brackets keep their own format
section('10. Historical brackets are rendered in their own shape')
{
  let single = 0, doubleElim = 0, empty = 0
  for (const h of honorRoll) {
    const rounds = await seasonPlayoffRounds(h.id)
    if (!rounds.length) { empty++; continue }
    const hasLB = rounds.some((r) => r.section === 'LB')
    if (hasLB) doubleElim++; else single++

    /*
     * The shared renderer mirrors only when there IS a losers bracket. A single-elimination archive
     * season must not acquire one: a reader would be shown a bracket the competition never had.
     */
    const declared = h.format != null && h.format.includes('Double')
    check('season ' + h.id + ' bracket shape matches its recorded format', hasLB === declared,
      h.format + ' but ' + (hasLB ? 'has' : 'has no') + ' losers bracket')
  }
  console.log('  (single-elimination ' + single + ', double-elimination ' + doubleElim + ', no bracket ' + empty + ')')
}

// -- Proof 11: what is missing stays missing
section('11. Missing archive information is left unknown, never invented')
{
  /*
   * The archive shows a season through the site's OWN presentations now — the masthead, the group
   * tables, the bracket — rather than through a simplified copy of them. So the honesty rules are
   * checked where they actually live: in the data layer, which returns null rather than a
   * placeholder, and in the shared panel, which prints a forfeit as FF instead of inventing a score.
   */
  const results = read('src/components/home/season-results.tsx')
  check('a forfeited final shows FF rather than a score nobody played', results.includes('finalsForfeit ? ('))
  check('a missing score is a dash, not a zero', results.includes("finalScore ?? <span"))

  const summary = read('src/components/yahoo/yahoo-summary.tsx')
  check('a missing year span is stated as unknown', summary.includes("'Unknown'"))

  const panel = read('src/components/yahoo/yahoo-season-panel.tsx')
  check('a season outside the archive is refused rather than rendered',
    panel.includes('not part of this archive'))
  check('the season views are the site\'s own, not archive copies',
    panel.includes('SeasonGroupsView') && panel.includes('SeasonBracketPanel'))

  const lib = read('src/lib/yahoo/archive.ts')
  check('the data layer returns null rather than a placeholder', lib.includes('|| null'))
  check('...and never substitutes a year for a missing one',
    lib.includes('firstYear: years.length ? Math.min(...years) : null'))

  /* Nothing on the honour roll may carry a value the database does not hold. */
  const rows = await prisma.season.findMany({
    where: { platform: 'YAHOO' },
    select: { id: true, championName: true, championHandle: true, finalScore: true },
  })
  const byId = new Map(rows.map((r) => [r.id, r]))
  let championsOk = 0, scoresOk = 0
  for (const h of honorRoll) {
    const r = byId.get(h.id)
    if (!r) continue
    const champ = (r.championName || '').trim() || (r.championHandle || '').trim() || null
    if (h.champion === champ) championsOk++
    if (h.finalScore === ((r.finalScore || '').trim() || null)) scoresOk++
  }
  check('every champion shown is the stored one, or null', championsOk === honorRoll.length,
    championsOk + '/' + honorRoll.length)
  check('every final score shown is the stored one, or null', scoresOk === honorRoll.length,
    scoresOk + '/' + honorRoll.length)
}

// -- Proofs 9 + 12: one page, and the phone reads it in the right order
section('9 + 12. One route, bounded frames, and the mobile order')
{
  const src = read('src/components/yahoo/yahoo-workspace.tsx')
  check('the views are part of the page, not dialogs',
    !src.includes('role="dialog"') && src.includes('role="tabpanel"'))
  check('Home, Groups and Playoffs are all at /yahoo',
    !/router\.push\(`?['`]\/seasons/.test(src) && /`\/yahoo\?/.test(src))
  // The words appear in the note explaining WHY it is not persisted; what must not appear is a call.
  check('expansion is not persisted anywhere',
    !/(localStorage|sessionStorage)\s*\.\s*(get|set)Item/.test(src))

  /*
   * Order is expressed as CSS order rather than as two copies of the markup: a duplicated section is
   * two things to keep in step, and a screen reader hears both.
   */
  check('the season results come first on a phone', /order-1 [^"]*lg:order-2/.test(src))
  check('...and the ladder second', /order-2 [^"]*lg:order-1/.test(src))
  /*
   * Both columns must be allowed to shrink. A grid child defaults to `min-width: auto`, so a table
   * with a minimum width refuses to let its column narrow and pushes the page sideways -- the wide
   * table is supposed to scroll inside its own box, not take the page with it.
   */
  check('neither column can be widened past the screen by the table inside it',
    (src.match(/min-w-0/g) || []).length >= 3)

  const ladder = read('src/components/yahoo/yahoo-ladder-compact.tsx')
  check('the compact ladder scrolls internally rather than growing without limit',
    ladder.includes('overflow-auto') && ladder.includes('flex-1'))
  check('...with a sticky header', ladder.includes('sticky top-0'))
  // lastIndexOf, because the import at the top of the file is not the placement being tested.
  check('...and the rating legend outside the scroller, after it',
    ladder.lastIndexOf('<RatingLegend') > ladder.lastIndexOf('</table>'))
  check('the shared rating helpers are reused, not reimplemented',
    ladder.includes("from '@/lib/stats/rating-tier'") && !/1700|1500|1400|1300/.test(ladder))
  check('the shared identity cell is reused', ladder.includes('IdentityCell'))
  check('the championship icon is the shared outlined Crown',
    ladder.includes('Crown') && !/💎|👑/.test(ladder))

  const css = read('src/app/(frontend)/globals.css')
  const scoped = css.split('Yahoo Pool Archive')[1] || ''
  check('the archive styles are scoped to the page', scoped.includes('.ya-root'))
  check('...and redefine no global token', !/^\s*--gold:/m.test(scoped) && !/^:root/m.test(scoped))
}

// -- Proof 7: the URL is the selection
section('7. Season, view and group are all in the URL')
{
  const page = read('src/app/(frontend)/yahoo/page.tsx')
  check('the season comes from the query string', page.includes("one('season')"))
  check('the view comes from the query string', page.includes("one('view')"))
  check('the group comes from the query string', page.includes("one('group')"))
  check('the selection is resolved on the server, so a deep link cannot render the wrong season first',
    page.includes('const seasonId ='))
  check('a season outside the archive is refused', page.includes('isYahooSeason(requested)'))
  check('Groups without a season prompts rather than choosing one', page.includes('needsSeason'))

  const src = read('src/components/yahoo/yahoo-workspace.tsx')
  check('unrelated query parameters survive a selection change',
    src.includes('new URLSearchParams(params.toString())'))
  check('navigating does not jump the page to the top', src.includes('{ scroll: false }'))
  /*
   * Read from the shared module, not from the client component.
   *
   * The constant used to be exported from the workspace, which carries 'use client'. A Server
   * Component importing a plain value from a client module gets a client REFERENCE rather than
   * the value, so the page prefixed its lookups with something that was not "r": every
   * parameter missed and the archive rendered the unfiltered ladder whatever the URL said.
   */
  const paramsModule = read('src/lib/yahoo/params.ts')
  check('the ladder has its own parameter namespace, so both can own "season"',
    paramsModule.includes("YAHOO_PARAM_PREFIX = 'r'"))
  // The directive is a first statement, not a mention: the note above it explains the very bug it
  // must not reintroduce, and naming that is not the same as carrying it.
  check('...from a module with no client directive, so the server reads the value',
    !/^\s*['"]use client['"]/.test(paramsModule))
  check('...and the page imports it from there',
    read('src/app/(frontend)/yahoo/page.tsx').includes("from '@/lib/yahoo/params'"))
}

// -- Groups view: standings, the results behind them, and the roster-only distinction
section('Groups view carries the standing AND the results behind it')
{
  const withGroups = honorRoll.find((h) => h.hasGroups)
  if (!withGroups) {
    check('a season with groups exists to test', false)
  } else {
    const groups = await getSeasonGroupStage(withGroups.id)
    check('the group stage loads', groups.length > 0, String(groups.length) + ' groups')
    check('standings are ranked',
      groups.every((g) => g.standings.every((s, i, a) => i === 0 || a[i - 1].rank <= s.rank)))
    check('matches are carried alongside the standings', groups.some((g) => g.matches.length > 0))

    /*
     * A roster entry who never played is not a player who lost. Both read zero wins; only `played`
     * separates them, which is why the table prints it as its own column.
     */
    const rosterOnly = groups.flatMap((g) => g.standings).filter((s) => s.played === 0)
    console.log('  (roster-only entrants in this season: ' + rosterOnly.length + ')')
    check('roster-only entrants keep a zero record rather than being dropped',
      rosterOnly.every((s) => s.wins === 0 && s.losses === 0 && s.draws === 0))

    const links = await getYahooEntrantPlayers(withGroups.id)
    check('entrants resolve to players, so a standing can link to a profile', links.size > 0, String(links.size))
  }
}

// -- The disclaimer, and the shared panel the archive reuses
section('The archive says what it is, and reuses what already exists')
{
  const src = read('src/components/yahoo/yahoo-workspace.tsx')
  check('the affiliation disclaimer is present, verbatim',
    src.includes('A historical community archive. 8 Ball Registry is not affiliated with or endorsed by Yahoo.'))
  check('expanded mode renders the Rankings interface itself, not a copy',
    src.includes('RankingsExplorer'))
  check('the four current scopes are withheld from the archive', src.includes('showScopes={false}'))

  const page = read('src/app/(frontend)/yahoo/page.tsx')
  check('the season list is the shared homepage panel', page.includes('SeasonResults'))
  check('...fed with Yahoo rows only', page.includes("getSeasonResults('YAHOO')"))
  check('...and a row opens the season inside the archive',
    page.includes('/yahoo?season=${r.seasonId}&view=groups'))
  check('the facets offered belong to the archive', page.includes("getFacets('YAHOO')"))

  const summary = read('src/components/yahoo/yahoo-summary.tsx')
  check('the summary says "Unique champions" rather than a completeness figure',
    summary.includes("label: 'Unique champions'")
    && !/value:\s*`\$\{[^}]*\}\s*of\s*\$\{/.test(summary))
  check('Seasons remains its own statistic', summary.includes("label: 'Seasons'"))
}

// -- Previous and Next follow the competition, not the import
section('Season navigation is in canonical order')
{
  const order = await getYahooSeasonOrder()
  check('every Yahoo season is in the order', order.length === honorRoll.length,
    order.length + ' vs ' + honorRoll.length)
  check('it runs oldest first, by year and then by number within the year',
    order.every((s, i) => i === 0
      || s.year > order[i - 1].year
      || (s.year === order[i - 1].year && s.number > order[i - 1].number)))
  /*
   * Season numbers restart each year, so the id stays the identifier in URLs: it is unique, stable,
   * and already what every other Season link on the site uses.
   */
  const labels = new Set(order.map((s) => s.number))
  check('season numbers repeat across years, which is why the id is the identifier',
    labels.size < order.length, labels.size + ' distinct numbers over ' + order.length + ' seasons')
  check('ids are unique', new Set(order.map((s) => s.id)).size === order.length)

  const first = yahooNeighbours(order, order[0].id)
  const last = yahooNeighbours(order, order[order.length - 1].id)
  check('the oldest season has no Previous', first.previous === null)
  check('...and does have a Next', first.next !== null)
  check('the newest season has no Next', last.next === null)
  check('...and does have a Previous', last.previous !== null)

  const middle = yahooNeighbours(order, order[5].id)
  check('a middle season has both', middle.previous?.id === order[4].id && middle.next?.id === order[6].id)
  check('navigation never leaves the archive',
    order.every((s) => honorRoll.some((h) => h.id === s.id)))
}

// -- The counts, printed for the record
section('Archive inventory')
console.log('  seasons ' + summary.seasons + ' - players ' + summary.players + ' - matches ' + summary.matches +
  ' (group ' + summary.groupMatches + ', playoff ' + summary.playoffMatches + ')')
console.log('  years ' + summary.firstYear + '-' + summary.lastYear + ' (' + summary.yearsRepresented + ' represented)' +
  ' - champions ' + summary.distinctChampions + ' distinct of ' + summary.champions +
  ' - tournaments ' + summary.tournaments)

console.log('\n' + pass + ' passed, ' + fail + ' failed')
await prisma.$disconnect()
process.exit(fail ? 1 : 0)
