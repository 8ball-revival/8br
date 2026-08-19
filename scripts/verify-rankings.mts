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
import { readdirSync, readFileSync } from 'node:fs'
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
import {
  ratingTier, ratingTierLabel, ratingAriaLabel, ratingAriaLabelFor, highestRatingOf, isHighestRating,
} from '../src/lib/stats/rating-tier.ts'
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
  check('the overall record header is W–L–D', COLUMN_BY_KEY.record.short === 'W–L–D', COLUMN_BY_KEY.record.short)
  check('...and shows all three numbers, including a zero draw count',
    COLUMN_BY_KEY.record.format!(row({ wins: 15, losses: 2, draws: 0 }), 'SC') === '15–2–0',
    COLUMN_BY_KEY.record.format!(row({ wins: 15, losses: 2, draws: 0 }), 'SC'))
  check('...and a real draw count',
    COLUMN_BY_KEY.record.format!(row({ wins: 5, losses: 1, draws: 3 }), 'SC') === '5–1–3')
  check('draws are explained in the tooltip', /draws/.test(COLUMN_BY_KEY.record.tooltip))
  check('the standalone Draws column is gone — the record carries it', !COLUMN_BY_KEY.draws)
  check('the GAME record stays two numbers — a frame cannot be drawn',
    COLUMN_BY_KEY.games.format!(row({ gamesWon: 110, gamesLost: 55 }), 'SC') === '110–55')

  // ── The three stage records, and how they relate
  const seasonR = COLUMN_BY_KEY.seasonRecord
  const playoffR = COLUMN_BY_KEY.playoffRecord
  const cupR = COLUMN_BY_KEY.cupRecord
  const split = row({
    groupWins: 11, groupLosses: 1, groupDraws: 2,
    playoffWins: 4, playoffLosses: 1, playoffDraws: 0,
    tournamentWins: 3, tournamentLosses: 2, tournamentDraws: 0,
  })
  check('Season W–L–D is group play AND Season playoffs together',
    seasonR.format!(split, 'SC') === '15–2–2', seasonR.format!(split, 'SC'))
  check('Playoffs W–L is the playoff subset, with no draw column',
    playoffR.format!(split, 'SC') === '4–1', playoffR.format!(split, 'SC'))
  check('...and the tooltip says it is a SUBSET of the Season record',
    /subset/i.test(playoffR.tooltip))
  check('Cup W–L is Cups only', cupR.format!(split, 'SC') === '3–2', cupR.format!(split, 'SC'))
  check('a Cup draw shows when one genuinely exists, not as a permanent zero',
    cupR.format!(row({ tournamentWins: 2, tournamentLosses: 1, tournamentDraws: 1 }), 'SC') === '2–1–1')
  check('each stage record sorts by its own wins',
    seasonR.value(split, 'SC') === 15 && playoffR.value(split, 'SC') === 4 && cupR.value(split, 'SC') === 3)
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

  // Signed, not W#/L#: the sign says the direction and the column sorts as one continuous scale.
  const streak = COLUMN_BY_KEY.currentStreak
  check('a winning run formats with a plus', streak.format!(row({ currentStreak: 9 }), 'SC') === '+9')
  check('a losing run formats with a minus', streak.format!(row({ currentStreak: -1 }), 'SC') === '-1')
  check('no run reads as not applicable', streak.format!(row({ currentStreak: 0 }), 'SC') === '—')
  check('the W/L prefixes are gone',
    !/^[WL]/.test(streak.format!(row({ currentStreak: 4 }), 'SC'))
    && !/^[WL]/.test(streak.format!(row({ currentStreak: -4 }), 'SC')))
  check('the tooltip states where the marking starts', /three or more/.test(streak.tooltip))
  check('...and that a tie is skipped rather than breaking the run',
    /neither extends nor breaks/.test(streak.tooltip))
  check('...and that the number carries the meaning, not the colour alone',
    /\+3|−2/.test(streak.tooltip))
  // Sorting runs from the longest losing run to the longest winning one, in one order.
  check('streak sorts as a continuous signed scale',
    (streak.value(row({ currentStreak: -5 }), 'SC') as number)
    < (streak.value(row({ currentStreak: 0 }), 'SC') as number)
    && (streak.value(row({ currentStreak: 0 }), 'SC') as number)
    < (streak.value(row({ currentStreak: 5 }), 'SC') as number))
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
  check('Compact holds rank, player, rating, record, win % and both championship counts',
    compact.join(',') === 'rank,player,rating,record,matchWinPct,seasonTitles,tournamentTitles',
    compact.join(','))

  const standard = visibleKeys('standard', 'overall', null)
  check('Standard is exactly the requested eleven columns, in order',
    standard.join(',') === 'rank,player,rating,record,matchWinPct,currentStreak,'
      + 'seasonRecord,playoffRecord,cupRecord,seasonTitles,tournamentTitles',
    standard.join(','))
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

  const custom = visibleKeys('custom', 'overall', ['rating', 'seasonTitles'])
  check('Custom honours the selection', custom.includes('rating') && custom.includes('seasonTitles'))
  check('...and never drops the locked columns', custom[0] === 'rank' && custom[1] === 'player')
  check('...and ignores a key that does not exist',
    !visibleKeys('custom', 'overall', ['rating', 'not_a_column']).includes('not_a_column'))
  check('Custom with nothing selected falls back to Standard',
    visibleKeys('custom', 'overall', null).join(',') === standard.join(','))

  // Order must come from the canonical column order, not from click order.
  const clickedBackwards = visibleKeys('custom', 'overall', ['seasonTitles', 'rating', 'played'])
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
  const sc = COLUMN_BY_KEY.seasonTitles
  const tc = COLUMN_BY_KEY.tournamentTitles
  check('SC and TC are SEPARATE columns, both shown at once', !!sc && !!tc && !COLUMN_BY_KEY.titles)
  check('SC reads the Season count', sc.value(r, 'SC') === 3)
  check('TC reads the Tournament count', tc.value(r, 'SC') === 1)
  check('neither depends on the SC/TC control', sc.value(r, 'TC') === 3 && tc.value(r, 'SC') === 1)
  check('Season Championships is explained', /Season Championships/.test(sc.tooltip))
  check('Cup Titles is explained', /Cup Titles/.test(tc.tooltip))
  check('the honours headers carry their emblems',
    sc.short === 'Season Championships 👑' && tc.short === 'Cup Titles 🏆', `${sc.short} / ${tc.short}`)
  check('no public column still says "Tournament"',
    !COLUMNS.some((c) => /Tournament/.test(c.label) || /Tournament/.test(c.short ?? '')),
    COLUMNS.filter((c) => /Tournament/.test(c.label + (c.short ?? ''))).map((c) => c.key).join(', '))
  check('...and both say the count can be traced',
    /which ones/i.test(sc.tooltip) && /which ones/i.test(tc.tooltip))

  const rows = [row({ playerId: 'a', seasonTitles: 0, tournamentTitles: 2 }), row({ playerId: 'b', seasonTitles: 2, tournamentTitles: 0 })]
  const scOnly = filterRows(rows, { search: '', minMatches: 0, championsOnly: true, entrantType: 'all', activeOnly: false }, 'SC')
  const tcOnly = filterRows(rows, { search: '', minMatches: 0, championsOnly: true, entrantType: 'all', activeOnly: false }, 'TC')
  // Both counts are always columns now, so this is what the SC/TC control is still FOR.
  check('champions-only follows the selected mode', scOnly[0]?.playerId === 'b' && tcOnly[0]?.playerId === 'a')
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
    sort: [{ key: 'rating', dir: 'desc' }, { key: 'seasonTitles', dir: 'asc' }],
    density: 'custom', columns: ['rating', 'seasonTitles'],
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
    back.sort.map((s) => `${s.key}:${s.dir}`).join(',') === 'rating:desc,seasonTitles:asc')
  check('density survives', back.density === 'custom')
  check('the custom column set survives', back.columns?.join(',') === 'rating,seasonTitles')
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
    decodeRankingsState('cols=rating,seasonTitles').density === 'custom')
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
section('Renamed columns migrate rather than vanish')
{
  check('a legacy `titles` column maps to Season Championships',
    decodeRankingsState('cols=rating,titles').columns?.includes('seasonTitles') === true,
    JSON.stringify(decodeRankingsState('cols=rating,titles').columns))
  check('a legacy `draws` column maps to the record that absorbed it',
    decodeRankingsState('cols=draws').columns?.includes('record') === true)
  check('a legacy sort key migrates too',
    decodeRankingsState('sort=titles:desc').sort[0]?.key === 'seasonTitles')
  check('migration does not duplicate a column already present',
    (decodeRankingsState('cols=seasonTitles,titles').columns ?? []).filter((k) => k === 'seasonTitles').length === 1)
  check('an unknown column is still dropped', decodeRankingsState('cols=not_a_column').columns === null)
  const store = (v: string | null) => ({ getItem: () => v })
  check('a saved device preference migrates its columns',
    readDevicePrefs(store('{"density":"custom","columns":["titles","rating"]}'))?.columns?.includes('seasonTitles') === true)
}

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

section('Rating tiers: every boundary, from both sides')
{
  // The bands ARE the feature, so each is asserted at its floor and one below it. A band that is
  // right in the middle and wrong on the line is wrong for every player sitting on that line.
  const cases: [number, string][] = [
    [0, 'grey'],
    [1, 'grey'],
    [1199, 'grey'],
    [1200, 'red'],
    [1299, 'red'],
    [1300, 'green'],
    [1399, 'green'],
    [1400, 'blue'],
    [1499, 'blue'],
    [1500, 'purple'],
    [1599, 'purple'],
    [1600, 'gold'],
    [1601, 'gold'],
    [2400, 'gold'],
  ]
  for (const [rating, tier] of cases) {
    check(`${rating} is ${tier}`, ratingTier(rating) === tier, String(ratingTier(rating)))
  }

  check('exactly 1200 is Red, not Grey', ratingTier(1200) === 'red')
  check('exactly 1199 is Grey, not Red', ratingTier(1199) === 'grey')
  check('exactly 1600 is Gold', ratingTier(1600) === 'gold')
  check('exactly 1599 is Purple, not Gold', ratingTier(1599) === 'purple')
  check('exactly 1500 is Purple', ratingTier(1500) === 'purple')
  check('exactly 1499 is Blue, not Purple', ratingTier(1499) === 'blue')
  check('exactly 1400 is Blue', ratingTier(1400) === 'blue')
  check('exactly 1399 is Green, not Blue', ratingTier(1399) === 'green')
  check('exactly 1300 is Green', ratingTier(1300) === 'green')
  check('exactly 1299 is Red, not Green', ratingTier(1299) === 'red')

  // The superseded scheme, asserted as ABSENT. 1500-1599 was red; anyone reading a red rating as
  // "elite" is reading the old mapping, so its removal is a fact worth keeping a test on.
  check('the old Red 1500-1599 mapping is gone', ratingTier(1500) !== 'red' && ratingTier(1599) !== 'red')
  check('red now sits low, at 1200-1299', ratingTier(1250) === 'red')
  check('no rating at or above 1300 is red',
    [1300, 1400, 1500, 1600, 1900].every((r) => ratingTier(r) !== 'red'))
  check('a negative rating is still Grey rather than untiered', ratingTier(-50) === 'grey')

  // An absent rating is NOT a tier. Grey would say "rated below 1200", a different claim entirely.
  check('a missing rating has no tier', ratingTier(null) === null)
  check('an undefined rating has no tier', ratingTier(undefined) === null)
  check('NaN has no tier', ratingTier(Number.NaN) === null)
  check('Infinity has no tier', ratingTier(Number.POSITIVE_INFINITY) === null)

  check('every band is reachable', new Set(cases.map(([r]) => ratingTier(r))).size === 6)

  // Monotonic: a higher rating can never land in a lower band. Cheap, and it catches any future
  // edit that reorders the bands.
  const RANK: Record<string, number> = { grey: 0, red: 1, green: 2, blue: 3, purple: 4, gold: 5 }
  let monotonic = true
  for (let r = 1; r <= 2000; r += 1) {
    if (RANK[ratingTier(r)!] < RANK[ratingTier(r - 1)!]) monotonic = false
  }
  check('the tier never decreases as the rating rises', monotonic)
}

section('Rating tiers: the accessible label carries what the colour says')
{
  check('a Gold rating is described', ratingAriaLabel(1651) === '1651 rating, Gold tier')
  check('a Purple rating is described', ratingAriaLabel(1540) === '1540 rating, Purple tier')
  check('a Blue rating is described', ratingAriaLabel(1450) === '1450 rating, Blue tier')
  check('a Green rating is described', ratingAriaLabel(1350) === '1350 rating, Green tier')
  check('a Red rating is described', ratingAriaLabel(1250) === '1250 rating, Red tier')
  check('a Grey rating is described', ratingAriaLabel(1150) === '1150 rating, Grey tier')
  check('a missing rating gets no label — the dash already says it', ratingAriaLabel(null) === undefined)
  check('every tier has a name',
    (['gold', 'red', 'purple', 'blue', 'green', 'grey'] as const).every((t) => ratingTierLabel(t).length > 0))
}

section('First place: the highest rating renders red, over its band')
{
  check('the largest rating wins', highestRatingOf([1400, 1667, 1200]) === 1667)
  check('order does not matter', highestRatingOf([1667, 1400, 1200]) === 1667)
  check('nulls are skipped', highestRatingOf([null, 1500, undefined, 1200]) === 1500)
  check('an all-null table has no leader', highestRatingOf([null, undefined]) === null)
  check('an empty table has no leader', highestRatingOf([]) === null)
  check('NaN is not a rating', highestRatingOf([Number.NaN, 1300]) === 1300)
  check('Infinity is not a rating', highestRatingOf([Number.POSITIVE_INFINITY, 1300]) === 1300)

  const top = highestRatingOf([1667, 1657, 1200])
  check('the leader is marked', isHighestRating(1667, top))
  check('the runner-up is not', !isHighestRating(1657, top))
  check('a missing rating is never the leader', !isHighestRating(null, top))
  check('nothing is marked when there is no leader', !isHighestRating(1667, null))

  // A genuine tie marks BOTH. Choosing one of two identical ratings would assert a difference the
  // data does not contain, and nobody could tell which was chosen or why.
  const tied = highestRatingOf([1667, 1667, 1400])
  check('a tie at the top marks both holders', isHighestRating(1667, tied))
  check('...and still not the row below', !isHighestRating(1400, tied))

  // The leader keeps their BAND — the red is laid over it in CSS, not substituted for it — so the
  // band function must be untouched by who happens to be leading.
  check('the leader still belongs to their own band', ratingTier(1667) === 'gold')
  check('a low-rated leader is still low-banded', ratingTier(1250) === 'red')

  check('the leader is announced as the leader, not by band',
    ratingAriaLabelFor(1667, 1667) === '1667 rating, highest on this table')
  check('everyone else is announced by band',
    ratingAriaLabelFor(1540, 1667) === '1540 rating, Purple tier')
  check('a missing rating gets no label at all', ratingAriaLabelFor(null, 1667) === undefined)
}

section('No glow, and none creeping back')
{
  const css = readFileSync('src/app/(frontend)/globals.css', 'utf8')
  const rule = css.slice(css.indexOf('.rating-primary {'), css.indexOf('.rating-primary--gold'))

  // Asserted as ABSENT. The neon version smeared the digits; a colour scale is fine, a blur is not.
  check('the rating carries no text-shadow', !rule.includes('text-shadow'))
  check('the rating carries no animation', !rule.includes('animation'))
  check('no breathing keyframes remain anywhere', !css.includes('rating-breathe'))
  check('no halo tokens remain', !css.includes('-glow:'))

  check('a class exists for every band',
    (['gold', 'purple', 'blue', 'green', 'red', 'grey'] as const)
      .every((t) => css.includes(`.rating-primary--${t}`)))
  check('every band has a colour in both themes',
    (css.match(/--tier-gold:/g) ?? []).length === 2 && (css.match(/--tier-grey:/g) ?? []).length === 2)
  // Gold deliberately does NOT reuse the site token: the chrome gold is tuned to sit quietly, and
  // the top band has to lead the eye. Same hue, turned up — so the assertion is that it is defined
  // per theme and is brighter than the chrome gold, not that it is identical to it.
  check('gold is its own brighter value in both themes',
    (css.match(/--tier-gold: oklch\(/g) ?? []).length === 2)
  check('...and it is brighter than the chrome gold it derives from', (() => {
    const num = (re: RegExp) => [...css.matchAll(re)].map((m) => Number(m[1]))
    const tierL = num(/--tier-gold: oklch\(([0-9.]+)/g)
    const chromeL = num(/^  --gold: oklch\(([0-9.]+)/gm)
    return tierL.length === 2 && chromeL.length === 2 && tierL.every((v, i) => v > chromeL[i])
  })())
  check('first place has its own colour in both themes',
    (css.match(/--rating-top:/g) ?? []).length === 2)
  check('first place is declared after the bands, so it wins the cascade',
    css.indexOf('.rating-primary--highest') > css.indexOf('.rating-primary--grey'))
  check('the emphasis is still bold and tabular',
    /\.rating-primary \{[\s\S]*?font-weight: 700[\s\S]*?tabular-nums/.test(css))
}

section('The colouring is strictly scoped to the primary Rankings cell')
{
  const others = [
    'src/components/rankings/expanded-row.tsx',
    'src/components/rankings/compare-panel.tsx',
    'src/components/rankings/rankings-explorer.tsx',
    'src/components/rankings/identity-cell.tsx',
    'src/components/rankings/methodology.tsx',
  ]
  for (const f of others) {
    let src = ''
    try { src = readFileSync(f, 'utf8') } catch { continue }
    check(`${f} does not colour a rating`, !src.includes('rating-primary'))
  }

  // Swept rather than listed by hand, so a rating display added later is caught without anyone
  // remembering to extend this list.
  const sweep: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${e.name}`
      if (e.isDirectory()) walk(full)
      else if (/\.(tsx?|css)$/.test(e.name)) sweep.push(full)
    }
  }
  walk('src')
  const emitters = sweep.filter((f) =>
    f !== 'src/components/rankings/rankings-table.tsx'
    && f !== 'src/app/(frontend)/globals.css'
    && readFileSync(f, 'utf8').includes('rating-primary'))
  check('no other file in src colours a rating', emitters.length === 0, emitters.join(', '))

  const table = readFileSync('src/components/rankings/rankings-table.tsx', 'utf8')
  check('the table renders the treated cell in exactly one place',
    (table.match(/<RatingCell/g) ?? []).length === 1)
  check('the leader is computed from the rows actually shown, pinned ones included',
    table.includes('highestRatingOf([...rows, ...pinnedRows].map((r) => r.rating))'))
  check('an absent rating stays a plain dash',
    table.includes('if (tier == null) return <span className="text-muted-foreground">—</span>'))
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
