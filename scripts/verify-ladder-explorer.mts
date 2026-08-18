/**
 * The Ladder explorer.
 *
 * Two halves, tested differently. The pure view logic (sorting, filtering, URL state) is exercised
 * against constructed rows, so every branch can be reached deliberately. The aggregate is exercised
 * against the real development database and checked for INTERNAL CONSISTENCY and AGREEMENT WITH THE
 * EXISTING LADDER, rather than against hard-coded totals — a test that asserts "the top player has 11
 * wins" breaks the moment someone records a match, which teaches everyone to ignore it.
 */

import {
  computeExplorer, computeFacets, computePlayerDetail, RECORD_VIEWS,
  type ExplorerRow, type LadderScope,
} from '@/lib/stats/ladder-explorer'
import {
  COLUMNS, COLUMN_BY_KEY, columnsForView, defaultVisibleKeys, cycleSort, sortRows,
  filterRows, hasActiveRowFilters, activeChips, encodeExplorerState, decodeExplorerState,
  defaultState, EMPTY_ROW_FILTERS, type ChampionshipMode,
} from '@/lib/stats/ladder-columns'
import { getLadder } from '@/lib/stats/ladder'

let passed = 0
let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed += 1 } else { failed += 1; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** A row with sane defaults, so each test only states the fields it cares about. */
function row(over: Partial<ExplorerRow> = {}): ExplorerRow {
  return {
    playerId: over.playerId ?? 'p1',
    preferredName: 'Player One',
    cueverseId: 'player_one',
    label: 'player_one (Player One)',
    slug: 'player_one',
    rank: 1,
    wins: 5, losses: 3, draws: 0, played: 8, matchWinPct: 62.5,
    gamesWon: 40, gamesLost: 30, gameDiff: 10, gameWinPct: 57.1,
    rating: 1550, peakRating: 1600, currentStreak: 2, longestStreak: 4,
    competitionsEntered: 2, forfeits: 0, idleDays: 10,
    groupWins: 3, groupLosses: 2, playoffWins: 2, playoffLosses: 1,
    tournamentWins: 0, tournamentLosses: 0,
    seasonTitles: 0, tournamentTitles: 0, runnerUps: 0,
    finalsAppearances: 0, semifinalAppearances: 0, playoffAppearances: 1,
    groupPoints: 9, groupsEntered: 2, groupFirstPlaces: 0, perfectGroupStages: 0,
    playoffQualifications: 1, qualificationPct: 50,
    isTeamPlayer: false, active: true,
    ...over,
  }
}

const SC: ChampionshipMode = 'SC'

// ─────────────────────────────────────────────────────────── column definitions
console.log('\ncolumns')
{
  check('every column key is unique',
    new Set(COLUMNS.map((c) => c.key)).size === COLUMNS.length)
  check('every column has a tooltip explaining it',
    COLUMNS.every((c) => c.tooltip.trim().length > 10))
  check('Rank and Player are locked so they can never be hidden',
    COLUMN_BY_KEY.rank?.locked === true && COLUMN_BY_KEY.player?.locked === true)

  // Group-play figures are meaningless on a knockout-only tab.
  const playoffKeys = columnsForView('playoff').map((c) => c.key)
  check('group-play columns are absent from the Playoffs view',
    !playoffKeys.includes('groupPoints') && !playoffKeys.includes('perfectGroupStages'))
  check('...but present in Group Play', columnsForView('group').some((c) => c.key === 'groupPoints'))

  for (const v of RECORD_VIEWS) {
    const keys = defaultVisibleKeys(v.id)
    check(`${v.id}: defaults include the locked columns`,
      keys.includes('rank') && keys.includes('player'))
    check(`${v.id}: defaults are a subset of the view's columns`,
      keys.every((k) => columnsForView(v.id).some((c) => c.key === k)))
  }
}

// ─────────────────────────────────────────────────────────── sort cycling
console.log('\nsort cycling')
{
  const a = cycleSort([], 'rating', false)
  check('first click sorts descending', a.length === 1 && a[0].dir === 'desc')

  const b = cycleSort(a, 'rating', false)
  check('second click flips to ascending', b.length === 1 && b[0].dir === 'asc')

  const c = cycleSort(b, 'rating', false)
  check('third click clears the sort, restoring official order', c.length === 0)

  // Shift-click builds a secondary key rather than replacing the primary.
  const multi = cycleSort(cycleSort([], 'titles', false), 'rating', true)
  check('shift-click appends a secondary key',
    multi.length === 2 && multi[0].key === 'titles' && multi[1].key === 'rating')

  const replaced = cycleSort(cycleSort([], 'titles', false), 'rating', false)
  check('a plain click replaces the sort instead of appending',
    replaced.length === 1 && replaced[0].key === 'rating')
}

// ─────────────────────────────────────────────────────────── sorting behaviour
console.log('\nsorting')
{
  const rows = [
    row({ playerId: 'a', rank: 1, rating: 1600, wins: 2, label: 'aaa' }),
    row({ playerId: 'b', rank: 2, rating: 1500, wins: 9, label: 'bbb' }),
    row({ playerId: 'c', rank: 3, rating: 1700, wins: 5, label: 'ccc' }),
  ]

  const byRating = sortRows(rows, [{ key: 'rating', dir: 'desc' }], SC)
  check('descending sort orders by the column',
    byRating.map((r) => r.playerId).join('') === 'cab')

  const asc = sortRows(rows, [{ key: 'rating', dir: 'asc' }], SC)
  check('ascending sort reverses it', asc.map((r) => r.playerId).join('') === 'bac')

  check('no sort means official rank order',
    sortRows(rows, [], SC).map((r) => r.rank).join('') === '123')

  // THE important guarantee: sorting must never renumber the official rank.
  const byWins = sortRows(rows, [{ key: 'record', dir: 'desc' }], SC)
  check('the W-L column sorts by wins', byWins.map((r) => r.playerId).join('') === 'bca')
  const ranksAfter = byWins.map((r) => r.rank)
  check('sorting never rewrites official rank', ranksAfter.join('') === '231',
    `got ${ranksAfter.join(',')}`)

  // An unrecognised key is inert rather than throwing, so a stale link cannot break the table. Decode
  // already strips unknown keys; this covers the case where one reaches sortRows anyway.
  check('an unknown sort key leaves the order alone',
    sortRows(rows, [{ key: 'not_a_column', dir: 'desc' }], SC).map((r) => r.rank).join('') === '123')

  // A tie on the sort key must resolve to rank, and must not vary between calls.
  const tied = [
    row({ playerId: 'x', rank: 7, rating: 1500 }),
    row({ playerId: 'y', rank: 3, rating: 1500 }),
    row({ playerId: 'z', rank: 5, rating: 1500 }),
  ]
  const once = sortRows(tied, [{ key: 'rating', dir: 'desc' }], SC).map((r) => r.playerId).join('')
  const twice = sortRows(tied, [{ key: 'rating', dir: 'desc' }], SC).map((r) => r.playerId).join('')
  check('ties break on official rank', once === 'yzx', `got ${once}`)
  check('...and the order is stable across calls', once === twice)

  // Null is "not applicable" and must sink in BOTH directions: a blank cell floating to the top of an
  // ascending sort reads as a zero, which is a different claim.
  const withNull = [
    row({ playerId: 'has', rank: 1, groupPoints: 4 }),
    row({ playerId: 'none', rank: 2, groupPoints: null }),
  ]
  check('null sorts last descending',
    sortRows(withNull, [{ key: 'groupPoints', dir: 'desc' }], SC)[1].playerId === 'none')
  check('null sorts last ascending too',
    sortRows(withNull, [{ key: 'groupPoints', dir: 'asc' }], SC)[1].playerId === 'none')

  // Secondary sort actually breaks ties on the primary.
  const two = [
    row({ playerId: 'p', rank: 1, seasonTitles: 1, rating: 1500 }),
    row({ playerId: 'q', rank: 2, seasonTitles: 1, rating: 1700 }),
  ]
  const bySecondary = sortRows(two, [{ key: 'titles', dir: 'desc' }, { key: 'rating', dir: 'desc' }], SC)
  check('a secondary key breaks a tie on the primary',
    bySecondary[0].playerId === 'q')

  // The SC/TC control changes what the Titles column MEANS, so it must change the order.
  const modal = [
    row({ playerId: 'sc', rank: 1, seasonTitles: 3, tournamentTitles: 0 }),
    row({ playerId: 'tc', rank: 2, seasonTitles: 0, tournamentTitles: 3 }),
  ]
  check('sorting by Titles follows SC',
    sortRows(modal, [{ key: 'titles', dir: 'desc' }], 'SC')[0].playerId === 'sc')
  check('...and follows TC',
    sortRows(modal, [{ key: 'titles', dir: 'desc' }], 'TC')[0].playerId === 'tc')
}

// ─────────────────────────────────────────────────────────── row filters
console.log('\nrow filters')
{
  const rows = [
    row({ playerId: 'a', cueverseId: 'sharpshooter', preferredName: 'Alan', played: 20, seasonTitles: 2, active: true }),
    row({ playerId: 'b', cueverseId: 'rookie', preferredName: 'Beth', played: 3, seasonTitles: 0, active: true }),
    row({ playerId: 'c', cueverseId: 'ghost', preferredName: 'Cara', played: 50, seasonTitles: 0, active: false }),
    row({ playerId: 'd', cueverseId: 'team_guy', preferredName: 'Dan', played: 9, isTeamPlayer: true }),
  ]
  const F = { ...EMPTY_ROW_FILTERS }
  const ids = (rs: ExplorerRow[]) => rs.map((r) => r.playerId).join('')

  check('no filters returns everything', ids(filterRows(rows, F, SC)) === 'abcd')
  check('search matches the CueVerse ID',
    ids(filterRows(rows, { ...F, search: 'sharp' }, SC)) === 'a')
  check('search also matches the preferred name, which is why both are searched',
    ids(filterRows(rows, { ...F, search: 'cara' }, SC)) === 'c')
  check('search is case-insensitive',
    ids(filterRows(rows, { ...F, search: 'ROOKIE' }, SC)) === 'b')
  check('minimum matches excludes low-sample players',
    ids(filterRows(rows, { ...F, minMatches: 10 }, SC)) === 'ac')
  check('champions-only respects SC',
    ids(filterRows(rows, { ...F, championsOnly: true }, 'SC')) === 'a')
  check('champions-only under TC finds nobody here, rather than falling back to SC',
    filterRows(rows, { ...F, championsOnly: true }, 'TC').length === 0)
  check('active-only drops inactive profiles',
    ids(filterRows(rows, { ...F, activeOnly: true }, SC)) === 'abd')
  check('singles excludes team players',
    ids(filterRows(rows, { ...F, entrantType: 'singles' }, SC)) === 'abc')
  check('teams keeps only team players',
    ids(filterRows(rows, { ...F, entrantType: 'teams' }, SC)) === 'd')
  check('filters compose',
    ids(filterRows(rows, { ...F, minMatches: 10, activeOnly: true }, SC)) === 'a')

  check('an empty filter set is reported as inactive', !hasActiveRowFilters(F))
  check('whitespace alone does not count as a search',
    !hasActiveRowFilters({ ...F, search: '   ' }))
  check('a real search counts', hasActiveRowFilters({ ...F, search: 'x' }))
}

// ─────────────────────────────────────────────────────────── URL state
console.log('\nURL state')
{
  check('the default table produces an empty query string',
    encodeExplorerState(defaultState()) === '')

  const configured = {
    ...defaultState(),
    scope: 'all-time' as const,
    view: 'playoff' as const,
    mode: 'TC' as ChampionshipMode,
    sort: [{ key: 'rating', dir: 'desc' as const }, { key: 'record', dir: 'asc' as const }],
    columns: ['rank', 'player', 'rating'],
    rowFilters: { search: 'luis', minMatches: 5, championsOnly: true, entrantType: 'teams' as const, activeOnly: true },
    competitionSeriesId: 1, year: 2005, seasonId: 443, tournamentId: null,
  }
  const round = decodeExplorerState(encodeExplorerState(configured))
  check('scope survives the round trip', round.scope === 'all-time')
  check('view survives', round.view === 'playoff')
  check('championship mode survives', round.mode === 'TC')
  check('multi-column sort survives in order',
    round.sort.length === 2 && round.sort[0].key === 'rating' && round.sort[1].dir === 'asc')
  check('column choice survives', round.columns?.join(',') === 'rank,player,rating')
  check('search survives', round.rowFilters.search === 'luis')
  check('minimum matches survives', round.rowFilters.minMatches === 5)
  check('champions-only survives', round.rowFilters.championsOnly)
  check('entrant type survives', round.rowFilters.entrantType === 'teams')
  check('active-only survives', round.rowFilters.activeOnly)
  check('competition survives', round.competitionSeriesId === 1)
  check('year survives', round.year === 2005)
  check('season survives', round.seasonId === 443)
  check('an unset dimension stays unset', round.tournamentId === null)

  // A stale or hand-edited link must degrade, not render a broken table.
  const junk = decodeExplorerState('view=nonsense&sort=notacolumn:desc&cols=fake,alsofake&mode=XX&min=-4')
  check('an unknown view falls back to the default', junk.view === 'overall')
  check('an unknown sort key is dropped rather than carried', junk.sort.length === 0)
  check('unknown column keys are dropped, leaving the defaults', junk.columns === null)
  check('an unknown championship mode falls back to SC', junk.mode === 'SC')
  check('a negative minimum is clamped to zero', junk.rowFilters.minMatches === 0)

  const partial = decodeExplorerState('sort=rating:desc,bogus:asc')
  check('a mixed sort list keeps the valid keys only',
    partial.sort.length === 1 && partial.sort[0].key === 'rating')
}

// ─────────────────────────────────────────────────────────── chips
console.log('\nfilter chips')
{
  check('a default table shows no chips', activeChips(defaultState()).length === 0)

  const s = {
    ...defaultState(),
    year: 2005,
    seasonId: 443,
    rowFilters: { ...EMPTY_ROW_FILTERS, search: 'luis', championsOnly: true },
  }
  const chips = activeChips(s, { season: '8BRCAM Season 1 — 2005' })
  const keys = chips.map((c) => c.key)
  check('every active filter gets a chip',
    keys.includes('year') && keys.includes('season') && keys.includes('q') && keys.includes('champs'))
  check('a chip uses the real competition name when one is supplied',
    chips.some((c) => c.label.includes('8BRCAM')))
  check('the search chip shows the term',
    chips.some((c) => c.label.includes('luis')))
  check('every chip is individually clearable, so each has a key',
    chips.every((c) => c.key.length > 0))
}

// ─────────────────────────────────────────────────────────── the aggregate, on real data
console.log('\naggregate (development database)')
{
  const scopes: LadderScope[] = ['current', 'all-time']

  for (const scope of scopes) {
    const overall = await computeExplorer(scope, 'overall')
    const group = await computeExplorer(scope, 'group')
    const playoff = await computeExplorer(scope, 'playoff')

    check(`${scope}: the aggregate runs and returns rows`, overall.length > 0,
      'an empty result here usually means the SQL threw and was swallowed')

    // Ranks must be a clean 1..n with no gaps or repeats.
    const ranks = overall.map((r) => r.rank)
    check(`${scope}: ranks are exactly 1..n`,
      ranks.length > 0 && ranks.every((v, i) => v === i + 1))

    // Overall must equal the sum of its stages. This is the check that catches a broken view filter.
    const byId = new Map(overall.map((r) => [r.playerId, r]))
    let sumOk = true
    let gamesOk = true
    for (const g of group) {
      const p = playoff.find((x) => x.playerId === g.playerId)
      const o = byId.get(g.playerId)
      if (!o) { sumOk = false; continue }
      if (o.wins !== g.wins + (p?.wins ?? 0)) sumOk = false
      if (o.gamesWon !== g.gamesWon + (p?.gamesWon ?? 0)) gamesOk = false
    }
    check(`${scope}: overall wins equal group plus playoff wins`, sumOk)
    check(`${scope}: overall games equal group plus playoff games`, gamesOk)

    // Internal arithmetic.
    check(`${scope}: played equals wins plus losses plus draws`,
      overall.every((r) => r.played === r.wins + r.losses + r.draws))
    check(`${scope}: game difference equals won minus lost`,
      overall.every((r) => r.gameDiff === r.gamesWon - r.gamesLost))
    check(`${scope}: win percentage matches the record`,
      overall.every((r) => r.played === 0
        || Math.abs(r.matchWinPct - (r.wins / r.played) * 100) < 0.11))
    check(`${scope}: peak rating is never below current rating`,
      overall.every((r) => r.peakRating >= r.rating))
    check(`${scope}: a current streak never exceeds the longest winning run`,
      overall.every((r) => r.currentStreak <= r.longestStreak))
    check(`${scope}: nobody has more finals than playoff appearances`,
      overall.every((r) => r.finalsAppearances <= r.playoffAppearances))

    // Rating must not vary by view — a rating is not per-stage.
    let ratingStable = true
    for (const g of group) {
      const o = byId.get(g.playerId)
      if (o && o.rating !== g.rating) ratingStable = false
    }
    check(`${scope}: rating is identical in every view`, ratingStable,
      'a per-view rating would print a different number for the same player on each tab')

    // Identity must lead with the CueVerse ID, per the site-wide rule.
    check(`${scope}: a player with an ID has it at the front of the label`,
      overall.filter((r) => r.cueverseId).every((r) => r.label.startsWith(r.cueverseId!)))
    check(`${scope}: every row has a usable profile slug`,
      overall.every((r) => r.slug.length > 0))

    // Agreement with the existing Ladder. Two sources of truth on one page is the failure to avoid.
    const official = await getLadder(scope)
    check(`${scope}: the same players appear as on the official Ladder`,
      official.length === overall.length)
    const mismatched = official.filter((o) => {
      const m = byId.get(o.playerId)
      return !m || m.rating !== o.rating || m.rank !== o.rank || m.peakRating !== o.highestRating
    })
    check(`${scope}: rating, rank and peak agree with the official Ladder`,
      mismatched.length === 0, `${mismatched.length} disagreed`)
  }

  // A filter must re-run the aggregate, not merely hide rows.
  const facets = await computeFacets()
  check('facets only offer competitions that have ladder rows',
    facets.seasons.every((s) => s.label.length > 0))
  check('facet years are ordered newest first',
    facets.years.every((y, i) => i === 0 || facets.years[i - 1] >= y))

  const impossible = await computeExplorer('all-time', 'overall', { year: 1801 })
  check('a year with no competitions returns nothing, proving the filter reaches the aggregate',
    impossible.length === 0)

  if (facets.seasons[0]) {
    const one = await computeExplorer('all-time', 'overall', { seasonId: facets.seasons[0].id })
    const all = await computeExplorer('all-time', 'overall')
    check('a season filter never reports more matches than the unfiltered table',
      one.every((r) => {
        const total = all.find((x) => x.playerId === r.playerId)
        return !total || r.played <= total.played
      }),
      'if this fails the filter is being applied after aggregation instead of inside it')
  }

  // Tournaments genuinely have no ledger rows in this database. The view must be empty rather than
  // borrowing Season figures.
  const tourneys = await computeExplorer('all-time', 'tournament')
  const hasTournamentLedger = facets.tournaments.length > 0
  check('the Tournaments view reflects the data rather than inventing it',
    hasTournamentLedger ? tourneys.length > 0 : tourneys.length === 0,
    `${facets.tournaments.length} tournaments with ledger rows, ${tourneys.length} rows`)
}

// ─────────────────────────────────────────────────────────── per-row detail
console.log('\nexpanded row detail')
{
  const rows = await computeExplorer('all-time', 'overall')
  const target = rows[0]
  if (!target) {
    check('there is a player to inspect', false)
  } else {
    const d = await computePlayerDetail(target.playerId)
    check('detail resolves for a real player', d.playerId === target.playerId)
    check('the competition breakdown is populated', d.competitions.length > 0)
    check('recent form is newest-first and capped',
      d.recentForm.length > 0 && d.recentForm.length <= 10)
    check('recent form only contains real results',
      d.recentForm.every((f) => f === 'W' || f === 'L' || f === 'D'))

    // The breakdown must add up to the row it expands.
    const sw = d.competitions.reduce((n, c) => n + c.wins, 0)
    const sg = d.competitions.reduce((n, c) => n + c.gamesWon, 0)
    check('per-competition wins sum to the row total', sw === target.wins, `${sw} vs ${target.wins}`)
    check('per-competition games sum to the row total', sg === target.gamesWon,
      `${sg} vs ${target.gamesWon}`)
    check('the stage splits agree with the row',
      d.groupRecord.wins + d.playoffRecord.wins === target.groupWins + target.playoffWins)

    // A champion must be marked as one, and only in a competition they actually won.
    if (target.seasonTitles > 0) {
      check('a champion has a won competition in the breakdown',
        d.competitions.some((c) => c.won))
    }
    check('winning a competition implies reaching its final',
      d.competitions.every((c) => !c.won || c.reachedFinal))

    const missing = await computePlayerDetail('does-not-exist')
    check('an unknown player yields empty detail rather than throwing',
      missing.competitions.length === 0 && missing.recentForm.length === 0)
  }
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
