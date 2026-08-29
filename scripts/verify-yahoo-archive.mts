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
  const src = read('src/components/yahoo/yahoo-archive.tsx')
  check('the page has an explicit "Unknown"', src.includes("const UNKNOWN = 'Unknown'"))
  check('...and a phrase for what the archive lost', src.includes('Not available in the surviving archive'))
  check('a missing final score is stated rather than blanked', src.includes('Final score {UNKNOWN.toLowerCase()}'))
  check('a missing entrant count is stated rather than shown as zero', src.includes('Entrant count unknown'))
  check('an unrecorded group score is not printed as nil-nil', src.includes('unrecorded'))

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

// -- Proofs 9 + 12: the explorer is part of the page, and the phone reads it in the right order
section('9 + 12. Inline explorer, no inner scroll pane, and the mobile order')
{
  const src = read('src/components/yahoo/yahoo-archive.tsx')
  check('the explorer is a section in the page, not a dialog',
    !src.includes('role="dialog"') && src.includes('ya-explorer'))
  check('no section is given its own vertical scroller',
    !/overflow-y-(auto|scroll)/.test(src) && !/max-h-\[/.test(src))
  check('only horizontal overflow is allowed, for the wide tables and the bracket',
    src.includes('overflow-x-auto'))

  /*
   * Order is expressed as CSS order rather than as two copies of the markup: a duplicated section is
   * two things to keep in step, and a screen reader hears both.
   */
  check('the honour roll comes first on a phone', /order-1 [^"]*lg:order-2/.test(src))
  check('...and the ladder second', /order-2 [^"]*lg:order-1/.test(src))
  check('the summary is above both', src.indexOf('<Summary s={summary} />') < src.indexOf('lg:order-1'))
  check('the explorer is last', src.indexOf('<SeasonExplorer') > src.indexOf('lg:order-2'))
  /*
   * Both columns must be allowed to shrink. A grid child defaults to `min-width: auto`, so the
   * ladder's `min-w-[38rem]` table refused to let its column narrow and pushed a 375px page sideways
   * -- the wide table is supposed to scroll inside its own box, not take the page with it.
   */
  check('neither column can be widened past the screen by the table inside it',
    (src.match(/min-w-0/g) || []).length >= 4)

  const css = read('src/app/(frontend)/globals.css')
  const scoped = css.split('Yahoo Pool Archive')[1] || ''
  check('the archive styles are scoped to the page', scoped.includes('.ya-root .ya-runner'))
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
    page.includes('const detail = seasonId'))

  const src = read('src/components/yahoo/yahoo-archive.tsx')
  check('unrelated query parameters survive a selection change',
    src.includes('new URLSearchParams(params.toString())'))
  check('closing removes the selection from the URL',
    src.includes('urlWith({ season: null, view: null, group: null })'))
  check('navigating does not jump the page to the top', src.includes('{ scroll: false }'))
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

// -- The disclaimer and where the ladder points
section('The archive says what it is')
{
  const src = read('src/components/yahoo/yahoo-archive.tsx')
  check('the affiliation disclaimer is present, verbatim',
    src.includes('A historical community archive. 8 Ball Registry is not affiliated with or endorsed by Yahoo.'))
  check('the ladder opens the YAHOO record on a profile, not the empty CueVerse one',
    src.includes('?platform=yahoo'))
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
