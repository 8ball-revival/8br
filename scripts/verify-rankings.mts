/**
 * The Rankings page: identity, columns, sorting, filters, URL state, pins, CSV and the derived
 * "best" statistics.
 *
 * Pure rules only — no database. The service that reads the ledger is exercised by
 * verify-rankings-data.mts; everything here is a decision the code makes about data it is handed,
 * which is the half that can be wrong silently.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-rankings.mts
 */
import {
  COLUMNS, COLUMN_BY_KEY, columnsForView, visibleKeys, keysForDensity,
  cycleSort, sortRows, filterRows, matchesQuery, isQualified, activeChips, hasAnyFilter,
  encodeRankingsState, decodeRankingsState, defaultState, aggregateFilters,
  applySavedView, availableSavedViews, SAVED_VIEWS, partitionPinned,
  readDevicePrefs, readPins, MAX_COMPARE, UNASSIGNED_DIVISION,
  type RankingsState,
} from '../src/lib/stats/rankings-columns.ts'
import { completenessOf } from '../src/lib/stats/rankings-facts.ts'
import { identityShape } from '../src/components/rankings/identity-cell.tsx'
import { csvField, buildRankingsCsv } from '../src/lib/stats/rankings-csv.ts'
import { pickBestSeason, pickBestPlayoffRun, roundDepth, BEST_SEASON_MIN_MATCHES } from '../src/lib/stats/rankings-detail.ts'
import type { ExplorerRow } from '../src/lib/stats/ladder-explorer.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++ } else { fail++; console.log('  FAIL ' + n + (d ? ` — ${d}` : '')) }
}
const section = (s: string) => console.log(`\n${s}`)

/** A row with everything at zero, so each test only states the fields it is actually about. */
function row(over: Partial<ExplorerRow> = {}): ExplorerRow {
  return {
    playerId: 'p1', preferredName: 'Player One', cueverseId: 'player_one',
    label: 'player_one (Player One)', slug: 'player-one', rank: 1,
    wins: 0, losses: 0, draws: 0, played: 0, matchWinPct: 0,
    gamesWon: 0, gamesLost: 0, gameDiff: 0, gameWinPct: 0,
    rating: 1500, peakRating: 1500, currentStreak: 0, longestStreak: 0,
    competitionsEntered: 0, forfeits: 0, idleDays: null,
    groupWins: 0, groupLosses: 0, playoffWins: 0, playoffLosses: 0,
    tournamentWins: 0, tournamentLosses: 0,
    seasonTitles: 0, tournamentTitles: 0, runnerUps: 0,
    finalsAppearances: 0, semifinalAppearances: 0, playoffAppearances: 0,
    groupPoints: null, groupsEntered: null, groupFirstPlaces: null,
    perfectGroupStages: null, playoffQualifications: null, qualificationPct: null,
    isTeamPlayer: false, active: true, aliases: [], matchesWithGameData: 0,
    ...over,
  }
}

// ─────────────────────────────────────────────── canonical identity presentation
section('Identity: preferred name over CueVerse ID, no brackets')
{
  check('both present and different renders as two lines',
    identityShape({ preferredName: 'Tyler', cueverseId: 'bongman420_' }) === 'both')

  check('identical values collapse to one line',
    identityShape({ preferredName: 'Starkiller', cueverseId: 'Starkiller' }) === 'name-only')
  check('...and the comparison ignores case and surrounding space',
    identityShape({ preferredName: '  starkiller ', cueverseId: 'Starkiller' }) === 'name-only')

  check('no preferred name falls back to the CueVerse ID alone',
    identityShape({ preferredName: '', cueverseId: 'indianhacker' }) === 'id-only')
  check('no CueVerse ID falls back to the preferred name alone',
    identityShape({ preferredName: 'Adnan', cueverseId: null }) === 'name-only')
  check('neither renders as nothing, not as a blank cell',
    identityShape({ preferredName: '', cueverseId: null }) === 'none')

  // The column definition must not describe the old bracketed format.
  const player = COLUMN_BY_KEY.player
  check('the Player column tooltip no longer promises brackets',
    !/in brackets/i.test(player.tooltip), player.tooltip)
  check('...and says the identity belongs to one canonical account',
    /canonical/i.test(player.tooltip))
}

section('Search matches name, current ID and historical aliases')
{
  const r = row({
    preferredName: 'Michael', cueverseId: 'mjpool',
    aliases: ['mike_1985', 'yahoo_mikey', 'MJ'],
  })
  check('finds by preferred name', matchesQuery(r, 'micha'))
  check('finds by current CueVerse ID', matchesQuery(r, 'mjpool'))
  check('finds by an old Yahoo alias', matchesQuery(r, 'yahoo_mikey'))
  check('...case-insensitively', matchesQuery(r, 'YAHOO_MIKEY'))
  check('finds by a partial alias', matchesQuery(r, 'mike_'))
  check('does not match an unrelated string', !matchesQuery(r, 'zzzz'))
  check('an empty query matches everyone', matchesQuery(r, '   '))

  // The alias must NOT be needed to find the current identity, and vice versa: one account.
  const noAliases = row({ preferredName: 'Michael', cueverseId: 'mjpool', aliases: [] })
  check('a player with no recorded aliases is still found by name', matchesQuery(noAliases, 'michael'))

  const filtered = filterRows(
    [r, row({ playerId: 'p2', preferredName: 'Adnan', cueverseId: 'x0_adnan_0x', aliases: [] })],
    { search: 'mike_1985', minMatches: 0, championsOnly: false, entrantType: 'all', activeOnly: false },
    'SC',
  )
  check('an alias search returns exactly the one canonical player', filtered.length === 1, String(filtered.length))
  check('...and it is the SAME player id, not a duplicate account', filtered[0]?.playerId === 'p1')
}

// ─────────────────────────────────────────────── terminology
section('Column terminology')
{
  check('P became MP', COLUMN_BY_KEY.played.short === 'MP')
  check('...and MP is spelled out in its tooltip', /Matches Played/.test(COLUMN_BY_KEY.played.tooltip))
  check('W–L is explained as the match record', /Match Record/.test(COLUMN_BY_KEY.record.tooltip))
  check('Games became GW–GL', COLUMN_BY_KEY.games.short === 'GW–GL')
  check('...and GW–GL is spelled out', /Games Won . Games Lost/.test(COLUMN_BY_KEY.games.tooltip))

  const abbreviated = COLUMNS.filter((c) => c.short && c.short !== c.label)
  check('every abbreviated header carries an explanation',
    abbreviated.every((c) => c.tooltip.trim().length > 20),
    abbreviated.filter((c) => c.tooltip.trim().length <= 20).map((c) => c.key).join(', '))
  check('every column has a tooltip at all',
    COLUMNS.every((c) => c.tooltip.trim().length > 0))

  check('Diff is explained', /Game Differential/.test(COLUMN_BY_KEY.gameDiff.tooltip))
  check('Rating is explained', /Elo/.test(COLUMN_BY_KEY.rating.tooltip))
  check('Streak is explained', /unbroken run/.test(COLUMN_BY_KEY.currentStreak.tooltip))
  check('Finals is explained and traceable', /round label/.test(COLUMN_BY_KEY.finalsAppearances.tooltip))
}

section('Points: a real formula, shown only where it applies')
{
  const pts = COLUMN_BY_KEY.groupPoints
  check('Pts states where the number comes from', /stored standings/.test(pts.tooltip))
  check('...and states the actual scoring rule', /3 points for a win/.test(pts.tooltip))
  check('Pts appears in the Overall view', columnsForView('overall').some((c) => c.key === 'groupPoints'))
  check('Pts appears in the Group Play view', columnsForView('group').some((c) => c.key === 'groupPoints'))
  check('Pts is HIDDEN in the Playoffs view, where no standings points exist',
    !columnsForView('playoff').some((c) => c.key === 'groupPoints'))
  check('Pts is HIDDEN in the Tournaments view',
    !columnsForView('tournament').some((c) => c.key === 'groupPoints'))

  check('a player with no group history reads as not applicable, not as zero',
    pts.format!(row({ groupPoints: null }), 'SC') === '—')
  check('a genuine zero still reads as zero',
    pts.format!(row({ groupPoints: 0 }), 'SC') === '0')
}

// ─────────────────────────────────────────────── density
section('Density presets')
{
  const compact = visibleKeys('compact', 'overall', null)
  check('Compact holds rank, player, record, win %, rating and titles',
    compact.join(',') === 'rank,player,record,matchWinPct,rating,titles', compact.join(','))

  const standard = visibleKeys('standard', 'overall', null)
  check('Standard is broader than Compact', standard.length > compact.length)
  check('Standard is narrower than Full', standard.length < visibleKeys('full', 'overall', null).length)

  const full = visibleKeys('full', 'overall', null)
  check('Full shows every column that applies to the view',
    full.length === columnsForView('overall').length, `${full.length} of ${columnsForView('overall').length}`)
  check('...including the Highest Achieved columns, which Standard omits',
    full.includes('peakRating') && full.includes('longestStreak')
    && !standard.includes('peakRating'))

  check('Full in the Playoffs view drops the group-only columns',
    !visibleKeys('full', 'playoff', null).includes('groupPoints'))

  const custom = visibleKeys('custom', 'overall', ['rating', 'titles'])
  check('Custom honours the selection', custom.includes('rating') && custom.includes('titles'))
  check('...and never drops the locked columns', custom[0] === 'rank' && custom[1] === 'player')
  check('...and ignores a key that does not exist',
    !visibleKeys('custom', 'overall', ['rating', 'not_a_column']).includes('not_a_column'))
  check('Custom with nothing selected falls back to Standard',
    visibleKeys('custom', 'overall', null).join(',') === standard.join(','))

  // Order must come from the canonical column order, not from click order.
  const clickedBackwards = visibleKeys('custom', 'overall', ['titles', 'rating', 'played'])
  const canonical = COLUMNS.map((c) => c.key)
  check('columns render in canonical order however they were switched on',
    clickedBackwards.every((k, i, arr) =>
      i === 0 || canonical.indexOf(arr[i - 1]) < canonical.indexOf(k)),
    clickedBackwards.join(','))

  check('every density keeps Rank and Player',
    (['compact', 'standard', 'full', 'custom'] as const).every((d) => {
      const keys = keysForDensity(d, 'overall')
      return d === 'custom' || (keys.includes('rank') && keys.includes('player'))
    }))
}

// ─────────────────────────────────────────────── sorting and official rank
section('Sorting never renumbers the official rank')
{
  const rows = [
    row({ playerId: 'a', rank: 1, rating: 1700, matchWinPct: 40, wins: 4, played: 10 }),
    row({ playerId: 'b', rank: 2, rating: 1600, matchWinPct: 90, wins: 9, played: 10 }),
    row({ playerId: 'c', rank: 3, rating: 1500, matchWinPct: 60, wins: 6, played: 10 }),
  ]

  const byWinPct = sortRows(rows, [{ key: 'matchWinPct', dir: 'desc' }], 'SC')
  check('sorting reorders the rows', byWinPct.map((r) => r.playerId).join('') === 'bca', byWinPct.map((r) => r.playerId).join(''))
  check('...and every row keeps the rank it arrived with',
    byWinPct.find((r) => r.playerId === 'a')?.rank === 1
    && byWinPct.find((r) => r.playerId === 'b')?.rank === 2
    && byWinPct.find((r) => r.playerId === 'c')?.rank === 3)
  check('...and the ranks are not renumbered 1,2,3 down the screen',
    byWinPct.map((r) => r.rank).join(',') === '2,3,1', byWinPct.map((r) => r.rank).join(','))
  check('the input array is not mutated', rows.map((r) => r.playerId).join('') === 'abc')

  check('no sort returns official order',
    sortRows([...rows].reverse(), [], 'SC').map((r) => r.rank).join(',') === '1,2,3')

  // Determinism: rows that tie on the sort key must always resolve the same way.
  const tied = [
    row({ playerId: 'x', rank: 5, rating: 1500 }),
    row({ playerId: 'y', rank: 3, rating: 1500 }),
    row({ playerId: 'z', rank: 9, rating: 1500 }),
  ]
  const once = sortRows(tied, [{ key: 'rating', dir: 'desc' }], 'SC').map((r) => r.playerId).join('')
  const twice = sortRows([...tied].reverse(), [{ key: 'rating', dir: 'desc' }], 'SC').map((r) => r.playerId).join('')
  check('a tie resolves by official rank, deterministically', once === 'yxz', once)
  check('...and does not depend on the order the rows arrived in', once === twice, `${once} vs ${twice}`)

  // Null sorts last in BOTH directions — a blank rising to the top would read as a zero.
  const withNulls = [
    row({ playerId: 'n', rank: 1, groupPoints: null }),
    row({ playerId: 'p', rank: 2, groupPoints: 5 }),
  ]
  check('not-applicable sorts last descending',
    sortRows(withNulls, [{ key: 'groupPoints', dir: 'desc' }], 'SC')[1].playerId === 'n')
  check('...and last ascending too',
    sortRows(withNulls, [{ key: 'groupPoints', dir: 'asc' }], 'SC')[1].playerId === 'n')

  // Sort cycle
  check('first click sorts descending', cycleSort([], 'rating', false)[0].dir === 'desc')
  check('second click sorts ascending',
    cycleSort([{ key: 'rating', dir: 'desc' }], 'rating', false)[0].dir === 'asc')
  check('third click clears the sort',
    cycleSort([{ key: 'rating', dir: 'asc' }], 'rating', false).length === 0)
  check('shift-click adds a secondary key',
    cycleSort([{ key: 'titles', dir: 'desc' }], 'rating', true).length === 2)
  check('a plain click replaces the sort rather than adding to it',
    cycleSort([{ key: 'titles', dir: 'desc' }], 'rating', false).length === 1)
}

section('Championship mode switches what Titles means')
{
  const r = row({ seasonTitles: 3, tournamentTitles: 1 })
  const titles = COLUMN_BY_KEY.titles
  check('SC reads the Season count', titles.value(r, 'SC') === 3)
  check('TC reads the Tournament count', titles.value(r, 'TC') === 1)
  check('the two are genuinely different fields', titles.value(r, 'SC') !== titles.value(r, 'TC'))
  check('the tooltip explains both', /Season Championships/.test(titles.tooltip) && /Tournament Championships/.test(titles.tooltip))
  check('...and says the count can be traced', /trace|see the exact|behind it/i.test(titles.tooltip))

  const rows = [row({ playerId: 'a', seasonTitles: 0, tournamentTitles: 2 }), row({ playerId: 'b', seasonTitles: 2, tournamentTitles: 0 })]
  const sc = filterRows(rows, { search: '', minMatches: 0, championsOnly: true, entrantType: 'all', activeOnly: false }, 'SC')
  const tc = filterRows(rows, { search: '', minMatches: 0, championsOnly: true, entrantType: 'all', activeOnly: false }, 'TC')
  check('champions-only follows the selected mode', sc[0]?.playerId === 'b' && tc[0]?.playerId === 'a')
}

// ─────────────────────────────────────────────── qualification
section('Minimum-match qualification')
{
  const oneAndOh = row({ playerId: 'thin', played: 1, wins: 1, matchWinPct: 100 })
  const proven = row({ playerId: 'thick', played: 20, wins: 14, matchWinPct: 70 })

  check('a 1–0 record is not qualified at a threshold of 5', !isQualified(oneAndOh, 5))
  check('a 20-match record is', isQualified(proven, 5))
  check('a threshold of 0 qualifies everyone', isQualified(oneAndOh, 0))

  const shown = filterRows([oneAndOh, proven],
    { search: '', minMatches: 5, championsOnly: false, entrantType: 'all', activeOnly: false }, 'SC')
  check('the threshold filters the table when set', shown.length === 1 && shown[0].playerId === 'thick')
  check('...and with no threshold both appear',
    filterRows([oneAndOh, proven], { search: '', minMatches: 0, championsOnly: false, entrantType: 'all', activeOnly: false }, 'SC').length === 2)

  // The record itself is untouched — qualification is about ranking, not existence.
  check('qualification does not alter the record', oneAndOh.wins === 1 && oneAndOh.played === 1)
}

// ─────────────────────────────────────────────── completeness
section('Data completeness comes from the fields')
{
  check('all matches scored → complete',
    completenessOf({ played: 10, forfeits: 0, matchesWithGameData: 10 }) === 'complete')
  check('some matches scored → partial',
    completenessOf({ played: 10, forfeits: 0, matchesWithGameData: 4 }) === 'partial')
  check('none scored → match results only',
    completenessOf({ played: 10, forfeits: 0, matchesWithGameData: 0 }) === 'match-only')
  check('no matches at all → none',
    completenessOf({ played: 0, forfeits: 0, matchesWithGameData: 0 }) === 'none')

  // The forfeit rule is the whole reason this is not a plain ratio.
  check('a forfeit does not make a fully-recorded season look incomplete',
    completenessOf({ played: 10, forfeits: 2, matchesWithGameData: 8 }) === 'complete')
  check('a season of nothing but forfeits is match-results-only, not complete',
    completenessOf({ played: 3, forfeits: 3, matchesWithGameData: 0 }) === 'match-only')
}

// ─────────────────────────────────────────────── derived "best" statistics
section('Derived statistics: documented, deterministic, and absent when unsupported')
{
  const season = (o: Partial<Parameters<typeof pickBestSeason>[0][number]>) => ({
    seasonId: 1, label: 'S', year: 2005, wins: 0, losses: 0, draws: 0, played: 0, winPct: 0, gameDiff: 0, ...o,
  })

  check('a single-match perfect season is not eligible to be the best',
    pickBestSeason([season({ seasonId: 1, played: 1, wins: 1, winPct: 100 })]) === null)
  check('...and the threshold is stated as a constant', BEST_SEASON_MIN_MATCHES === 3)

  const best = pickBestSeason([
    season({ seasonId: 1, played: 10, wins: 6, winPct: 60, gameDiff: 30 }),
    season({ seasonId: 2, played: 10, wins: 8, winPct: 80, gameDiff: 5 }),
    season({ seasonId: 3, played: 2, wins: 2, winPct: 100 }),
  ])
  check('win percentage leads', best?.seasonId === 2, String(best?.seasonId))
  check('...over game differential', best?.gameDiff === 5)

  const tiedPct = pickBestSeason([
    season({ seasonId: 1, played: 10, wins: 8, winPct: 80, gameDiff: 10 }),
    season({ seasonId: 2, played: 20, wins: 16, winPct: 80, gameDiff: 4 }),
  ])
  check('an equal percentage breaks on match wins', tiedPct?.seasonId === 2, String(tiedPct?.seasonId))

  const tiedBoth = pickBestSeason([
    season({ seasonId: 7, year: 2005, played: 10, wins: 8, winPct: 80, gameDiff: 3 }),
    season({ seasonId: 9, year: 2006, played: 10, wins: 8, winPct: 80, gameDiff: 3 }),
  ])
  check('then on the more recent season', tiedBoth?.seasonId === 9)

  // Order-independence: the answer must not depend on how the rows arrived.
  const set = [
    season({ seasonId: 4, played: 10, wins: 7, winPct: 70 }),
    season({ seasonId: 5, played: 10, wins: 9, winPct: 90 }),
    season({ seasonId: 6, played: 10, wins: 5, winPct: 50 }),
  ]
  check('best season is order-independent',
    pickBestSeason(set)?.seasonId === pickBestSeason([...set].reverse())?.seasonId)

  // ── playoff runs
  const run = (o: Partial<Parameters<typeof pickBestPlayoffRun>[0][number]>) => ({
    seasonId: 1, label: 'S', year: 2005, outcome: 'round' as const,
    deepestRound: null, wins: 0, losses: 0, depth: null, ...o,
  })
  check('a championship beats a runner-up finish',
    pickBestPlayoffRun([run({ seasonId: 1, outcome: 'runner-up' }), run({ seasonId: 2, outcome: 'champion' })])?.seasonId === 2)
  check('a runner-up finish beats any other run',
    pickBestPlayoffRun([run({ seasonId: 1, outcome: 'round', depth: 5 }), run({ seasonId: 2, outcome: 'runner-up' })])?.seasonId === 2)
  check('between two ordinary runs the deeper round wins',
    pickBestPlayoffRun([run({ seasonId: 1, depth: 3 }), run({ seasonId: 2, depth: 5 })])?.seasonId === 2)
  check('a run whose depth is unknown sorts below one that is known',
    pickBestPlayoffRun([run({ seasonId: 1, depth: null }), run({ seasonId: 2, depth: 1 })])?.seasonId === 2)
  check('no playoff history yields nothing rather than a placeholder',
    pickBestPlayoffRun([]) === null)
  check('the returned run does not leak the internal depth field',
    !('depth' in (pickBestPlayoffRun([run({ seasonId: 1, depth: 3 })]) as object)))

  // ── round depth is a lookup, never a parse
  check('Final is deeper than Semifinal',
    (roundDepth('Final')?.depth ?? 0) > (roundDepth('Semifinals')?.depth ?? 0))
  check('Semifinal is deeper than Quarterfinal',
    (roundDepth('Semifinal')?.depth ?? 0) > (roundDepth('Quarterfinals')?.depth ?? 0))
  check('"Semifinal" is not mistaken for "Final"', roundDepth('Semifinal')?.name === 'Semifinal')
  check('"Quarterfinal" is not mistaken for "Final"', roundDepth('Quarterfinal')?.name === 'Quarterfinal')
  check('Round of 16 is shallower than Quarterfinal',
    (roundDepth('Round of 16')?.depth ?? 0) < (roundDepth('Quarterfinals')?.depth ?? 0))
  check('an unrecognised label is unknown, not shallow', roundDepth('Round 3') === null)
  check('an empty label is unknown', roundDepth('') === null && roundDepth(null) === null)
  check('a group label is not a playoff round', roundDepth('Group A') === null)
}

// ─────────────────────────────────────────────── URL state
section('URL state round trip')
{
  const configured: RankingsState = {
    ...defaultState(),
    scope: 'all-time', view: 'playoff', mode: 'TC',
    sort: [{ key: 'rating', dir: 'desc' }, { key: 'titles', dir: 'asc' }],
    density: 'custom', columns: ['rating', 'titles'],
    rowFilters: { search: 'tyler', minMatches: 5, championsOnly: true, entrantType: 'teams', activeOnly: true },
    competitionSeriesId: 3, year: 2005, seasonId: 12, tournamentId: null,
    division: 'A', fromYear: 2005, toYear: 2009,
    expanded: 'player-x', compare: ['a', 'b'],
  }
  const back = decodeRankingsState(encodeRankingsState(configured))

  check('scope survives', back.scope === 'all-time')
  check('record view survives', back.view === 'playoff')
  check('championship mode survives', back.mode === 'TC')
  check('a multi-key sort survives in order',
    back.sort.map((s) => `${s.key}:${s.dir}`).join(',') === 'rating:desc,titles:asc')
  check('density survives', back.density === 'custom')
  check('the custom column set survives', back.columns?.join(',') === 'rating,titles')
  check('the search survives', back.rowFilters.search === 'tyler')
  check('the minimum survives', back.rowFilters.minMatches === 5)
  check('champions-only survives', back.rowFilters.championsOnly)
  check('entrant type survives', back.rowFilters.entrantType === 'teams')
  check('active-only survives', back.rowFilters.activeOnly)
  check('competition survives', back.competitionSeriesId === 3)
  check('year survives', back.year === 2005)
  check('season survives', back.seasonId === 12)
  check('division survives', back.division === 'A')
  check('the year range survives', back.fromYear === 2005 && back.toYear === 2009)
  check('the expanded player survives', back.expanded === 'player-x')
  check('the comparison survives', back.compare.join(',') === 'a,b')

  const plain = encodeRankingsState(defaultState())
  check('the default table produces an empty query string', plain === '', plain)

  check('a bare /rankings decodes to the defaults',
    JSON.stringify(decodeRankingsState('')) === JSON.stringify(defaultState()))
}

section('Invalid query parameters degrade instead of crashing')
{
  const nonsense = decodeRankingsState(
    'scope=sideways&view=curling&mode=XX&sort=not_a_column:desc,rating:sideways'
    + '&density=enormous&cols=fake1,fake2&min=-4&year=abc&season=&division=' + 'x'.repeat(40)
    + '&from=2010&to=2000&compare=a,a,b,c,d,e&type=aliens&expand=',
  )
  check('an unknown scope falls back to the default', nonsense.scope === 'current')
  check('an unknown view falls back to the default', nonsense.view === 'overall')
  check('an unknown mode falls back to the default', nonsense.mode === 'SC')
  check('an unknown sort key is dropped',
    nonsense.sort.length === 1 && nonsense.sort[0].key === 'rating', JSON.stringify(nonsense.sort))
  check('an unknown direction becomes descending', nonsense.sort[0]?.dir === 'desc')
  check('an unknown density falls back', nonsense.density === 'standard')
  check('unknown columns are dropped entirely', nonsense.columns === null)
  check('a negative minimum becomes zero', nonsense.rowFilters.minMatches === 0)
  check('a non-numeric year is dropped', nonsense.year === null)
  check('an empty numeric parameter is dropped, not read as zero', nonsense.seasonId === null)
  check('an absurdly long division code is dropped', nonsense.division === null)
  check('a reversed year range is read the way it was clearly meant',
    nonsense.fromYear === 2000 && nonsense.toYear === 2010, `${nonsense.fromYear}-${nonsense.toYear}`)
  check('duplicates are removed from the comparison and it is capped',
    nonsense.compare.length === MAX_COMPARE && new Set(nonsense.compare).size === nonsense.compare.length,
    nonsense.compare.join(','))
  check('an unknown entrant type falls back to all', nonsense.rowFilters.entrantType === 'all')
  check('an empty expand parameter is null, not an empty string', nonsense.expanded === null)

  check('a link naming columns switches to Custom so they are honoured',
    decodeRankingsState('cols=rating,titles').density === 'custom')
  check('an unsupported preset is ignored', decodeRankingsState('preset=made-up').savedView === null)
}

section('Only the aggregate-changing filters reach the query')
{
  const s: RankingsState = {
    ...defaultState(),
    seasonId: 4, division: 'B', fromYear: 2005, toYear: 2007,
    rowFilters: { search: 'x', minMatches: 9, championsOnly: true, entrantType: 'teams', activeOnly: true },
    sort: [{ key: 'rating', dir: 'desc' }],
  }
  const f = aggregateFilters(s)
  check('the season reaches the aggregate', f.seasonId === 4)
  check('the division reaches the aggregate', f.division === 'B')
  check('the year range reaches the aggregate', f.fromYear === 2005 && f.toYear === 2007)
  check('the search does NOT — it selects rows, it does not change any figure',
    !('search' in f))
  check('the minimum does NOT', !('minMatches' in f))
  check('the sort does NOT', !('sort' in f))
}

// ─────────────────────────────────────────────── divisions and eras
section('Division and era filtering')
{
  check('the unassigned sentinel is a real value, not null', UNASSIGNED_DIVISION === 'unassigned')
  check('it round-trips through the URL',
    decodeRankingsState(encodeRankingsState({ ...defaultState(), division: UNASSIGNED_DIVISION })).division === UNASSIGNED_DIVISION)

  const chips = activeChips({ ...defaultState(), division: UNASSIGNED_DIVISION })
  check('unassigned is labelled honestly rather than as a division',
    chips.some((c) => /unassigned/i.test(c.label)), JSON.stringify(chips))
  check('a real division is labelled as one',
    activeChips({ ...defaultState(), division: 'A' }).some((c) => c.label === 'Division A'))

  // Era: the parameter exists so the shape is ready, but nothing is invented to match it.
  const era = decodeRankingsState('era=golden-age')
  check('an era parameter is parsed rather than rejected', era.era === 'golden-age')
  check('...and no era is set by default', defaultState().era === null)

  // The year range is the real, evidence-backed way to narrow by time.
  const range = activeChips({ ...defaultState(), fromYear: 2005, toYear: 2009 })
  check('a year range is shown as an active filter', range.some((c) => c.label === '2005–2009'))
  check('an open-ended range is labelled as such',
    activeChips({ ...defaultState(), fromYear: 2005 }).some((c) => c.label === 'from 2005'))
}

// ─────────────────────────────────────────────── saved views
section('Saved views are filters, not hidden ranking logic')
{
  check('every saved view is expressible as a state patch',
    SAVED_VIEWS.every((v) => typeof v.patch === 'object' && v.patch !== null))

  const champs = applySavedView(SAVED_VIEWS.find((v) => v.id === 'all-time-champions')!)
  check('All-Time Champions sets scope and champions-only',
    champs.scope === 'all-time' && champs.rowFilters.championsOnly)
  check('...and is recorded in the URL as a preset',
    decodeRankingsState(encodeRankingsState(champs)).savedView === 'all-time-champions')
  check('...and is fully described by its query string',
    decodeRankingsState(encodeRankingsState(champs)).rowFilters.championsOnly)

  const playoffs = applySavedView(SAVED_VIEWS.find((v) => v.id === 'best-playoff-records')!)
  check('Best Playoff Records sets a qualification floor',
    playoffs.view === 'playoff' && playoffs.rowFilters.minMatches === 5)

  check('a saved view is resettable — its state is the default plus a patch',
    JSON.stringify(applySavedView({ id: 'x', label: 'x', hint: 'x', patch: {} }))
    === JSON.stringify({ ...defaultState(), savedView: 'x' }))

  check('division presets are hidden when no division data exists',
    !availableSavedViews([]).some((v) => v.id === 'division-a'))
  check('...and offered when it does',
    availableSavedViews(['A', 'B']).some((v) => v.id === 'division-a')
    && availableSavedViews(['A', 'B']).some((v) => v.id === 'division-b'))
  check('the non-division presets are always available',
    availableSavedViews([]).length === SAVED_VIEWS.filter((v) => !v.available).length)
}

// ─────────────────────────────────────────────── pins
section('Pinning is a reading aid, not a ranking')
{
  const rows = [
    row({ playerId: 'a', rank: 1 }), row({ playerId: 'b', rank: 2 }), row({ playerId: 'c', rank: 3 }),
  ]
  const { pinned, rest } = partitionPinned(rows, ['c'])
  check('the pinned player is separated out', pinned.length === 1 && pinned[0].playerId === 'c')
  check('the rest keep their order', rest.map((r) => r.playerId).join('') === 'ab')
  check('the pinned player KEEPS their official rank', pinned[0].rank === 3, String(pinned[0].rank))
  check('nobody else is renumbered', rest.map((r) => r.rank).join(',') === '1,2')
  check('no pins leaves everything alone',
    partitionPinned(rows, []).rest.length === 3 && partitionPinned(rows, []).pinned.length === 0)
  check('a pin for a player who is not in the table is harmless',
    partitionPinned(rows, ['zzz']).rest.length === 3)

  // Local storage only.
  const store = (v: string | null) => ({ getItem: () => v })
  check('pins read back from storage', readPins(store('["a","b"]')).join(',') === 'a,b')
  check('corrupt pin storage yields no pins rather than a crash', readPins(store('{not json')).length === 0)
  check('a non-array value yields no pins', readPins(store('"a"')).length === 0)
  check('missing storage yields no pins', readPins(null).length === 0)
  check('non-string entries are discarded', readPins(store('["a",5,null]')).join(',') === 'a')
}

section('Device preferences, and the URL winning over them')
{
  const store = (v: string | null) => ({ getItem: () => v })
  const prefs = readDevicePrefs(store('{"density":"compact","columns":["rating"]}'))
  check('a saved density reads back', prefs?.density === 'compact')
  check('saved columns read back', prefs?.columns?.join(',') === 'rating')
  check('an unknown density falls back to the default',
    readDevicePrefs(store('{"density":"gigantic"}'))?.density === 'standard')
  check('unknown columns are filtered out',
    readDevicePrefs(store('{"columns":["nope"]}'))?.columns === null)
  check('corrupt preferences yield nothing rather than a crash',
    readDevicePrefs(store('not json')) === null)
  check('missing storage yields nothing', readDevicePrefs(null) === null)

  // The precedence rule itself: a URL that names a density must not be overridden by a device
  // preference. Encoded here as the property the component relies on.
  check('a URL naming a density is distinguishable from a URL that is silent',
    decodeRankingsState('density=full').density === 'full'
    && decodeRankingsState('').density === 'standard')
}

// ─────────────────────────────────────────────── CSV
section('CSV: correctness and formula-injection defence')
{
  check('a plain value is unquoted', csvField('Tyler') === 'Tyler')
  check('a comma forces quoting', csvField('Smith, John') === '"Smith, John"')
  check('a quote is doubled inside quotes', csvField('He said "hi"') === '"He said ""hi"""')
  check('a newline forces quoting', csvField('a\nb') === '"a\nb"')
  check('a carriage return forces quoting', csvField('a\rb') === '"a\rb"')
  check('null becomes empty', csvField(null) === '')
  check('zero is exported as zero, not as empty', csvField(0) === '0')
  check('unicode passes through unchanged', csvField('Ærøskøbing 日本') === 'Ærøskøbing 日本')

  // Formula injection: every leading character a spreadsheet will execute.
  for (const lead of ['=', '+', '-', '@']) {
    const out = csvField(`${lead}cmd|'/c calc'!A1`)
    check(`a leading ${lead} is neutralised`, out.startsWith("'") || out.startsWith('"\''), out)
  }
  check('a tab lead is neutralised', csvField('	SUM(A1)').startsWith("'"), csvField('	SUM(A1)'))
  check('...and the original text is still readable after the marker',
    csvField('=1+1').includes('=1+1'))
  check('a negative NUMBER is not mangled into text', csvField(-5) === "'-5" || csvField(-5) === '-5')

  const state = { ...defaultState(), density: 'compact' as const }
  const csv = buildRankingsCsv({
    rows: [
      row({ playerId: 'a', rank: 1, preferredName: 'Tyler', cueverseId: 'bongman420_', wins: 15, losses: 2, played: 17, matchWinPct: 88.2, rating: 1667, aliases: ['old_tyler'], matchesWithGameData: 17, forfeits: 0 }),
      row({ playerId: 'b', rank: 2, preferredName: '=HYPERLINK("evil")', cueverseId: 'sneaky', played: 3, matchesWithGameData: 0, forfeits: 0 }),
    ],
    state,
    filterSummary: 'None',
  })

  check('the export names the site without the abbreviation',
    csv.includes('8 Ball Registry') && !/\b8BR\b/.test(csv))
  check('preferred name and CueVerse ID are SEPARATE columns',
    csv.includes('Preferred Name,CueVerse ID'))
  check('historical aliases are exported', csv.includes('old_tyler'))
  check('data completeness is exported', csv.includes('Complete — match and game data'))
  check('partial data is labelled as such', csv.includes('Match results only'))
  check('the malicious-looking name is neutralised',
    csv.includes('"\'=HYPERLINK(""evil"")"'), csv.split('\r\n').find((l) => l.includes('HYPERLINK')) ?? '')
  check('the active sort is recorded in the file', csv.includes('Official rank'))
  check('the scope is recorded in the file', csv.includes('rolling 365 days'))
  check('rows are separated by CRLF', csv.includes('\r\n'))
  check('no private field name appears anywhere',
    !/email|password|token|moderation|linkedUserId/i.test(csv))

  // The export follows the SELECTED columns, not everything.
  const compactHeader = csv.split('\r\n').find((l) => l.startsWith('Rank,')) ?? ''
  check('a Compact export carries the compact columns', compactHeader.includes('Rating'))
  check('...and omits the ones Compact hides', !compactHeader.includes('Peak Rating'), compactHeader)

  // Filtering and sorting apply to the export.
  const sorted = buildRankingsCsv({
    rows: [row({ playerId: 'a', rank: 1, rating: 1500 }), row({ playerId: 'b', rank: 2, rating: 1900, preferredName: 'Higher' })],
    state: { ...defaultState(), sort: [{ key: 'rating', dir: 'desc' }] },
  })
  const dataLines = sorted.split('\r\n').filter((l) => /^\d+,/.test(l))
  check('the export honours the active sort', dataLines[0].includes('Higher'), dataLines[0])
  check('...and the exported rank is still the OFFICIAL rank', dataLines[0].startsWith('2,'), dataLines[0])

  const filteredCsv = buildRankingsCsv({
    rows: [row({ playerId: 'a', preferredName: 'Keep', played: 10 }), row({ playerId: 'b', preferredName: 'Drop', played: 1 })],
    state: { ...defaultState(), rowFilters: { search: '', minMatches: 5, championsOnly: false, entrantType: 'all', activeOnly: false } },
  })
  check('the export honours the active filters',
    filteredCsv.includes('Keep') && !filteredCsv.includes('Drop'))
}

// ─────────────────────────────────────────────── reset
section('Reset Filters')
{
  check('a default table has nothing to reset', !hasAnyFilter(defaultState()))
  check('a division filter makes Reset relevant', hasAnyFilter({ ...defaultState(), division: 'A' }))
  check('a search makes Reset relevant',
    hasAnyFilter({ ...defaultState(), rowFilters: { ...defaultState().rowFilters, search: 'x' } }))
  check('a minimum makes Reset relevant',
    hasAnyFilter({ ...defaultState(), rowFilters: { ...defaultState().rowFilters, minMatches: 3 } }))
  check('sorting alone does NOT count as a filter — it narrows nothing',
    !hasAnyFilter({ ...defaultState(), sort: [{ key: 'rating', dir: 'desc' }] }))
  check('changing scope alone does NOT count as a filter',
    !hasAnyFilter({ ...defaultState(), scope: 'all-time' }))
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
