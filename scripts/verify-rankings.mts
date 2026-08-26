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
import { readDeclarations, resolveToken, parseColor, contrastRatio } from './support/color.mts'
import {
  COLUMNS, COLUMN_BY_KEY, columnsForView, visibleKeys, keysForDensity,
  cycleSort, sortRows, filterRows, matchesQuery, isQualified, activeChips, hasAnyFilter,
 decodeRankingsState, defaultState, aggregateFilters,
 availableSavedViews, SAVED_VIEWS, partitionPinned,
 readPins, MAX_COMPARE, UNASSIGNED_DIVISION,

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
/*
 * The ordering is inverted from what this section used to assert, on purpose.
 *
 * Rankings led with the Preferred Name in gold; every other surface on the site led with the
 * CueVerse ID. The same player therefore read as "James / cue.ball" in the ladder and
 * "cue.ball / James" in a group table, and the two components had no code in common to keep them
 * honest. The ID leads now — there are six players called Chris and six called Craig, so a
 * Preferred Name is something a competitor also has rather than the thing that identifies them —
 * and `identityLines` is the single place that decides it.
 *
 * `identityShape` still describes the DATA, not the layout: "name-only" means no handle exists.
 * Where the two values are the same text, the surviving line is the handle, so the shape is
 * "id-only" rather than "name-only" as it was when the name was the one that led.
 */
section('Identity: CueVerse ID leads, preferred name beneath')
{
  check('both present and different renders as two lines',
    identityShape({ preferredName: 'Tyler', cueverseId: 'bongman420_' }) === 'both')

  check('identical values collapse to one line, and it is the handle that survives',
    identityShape({ preferredName: 'Starkiller', cueverseId: 'Starkiller' }) === 'id-only')
  check('...and the comparison ignores case and surrounding space',
    identityShape({ preferredName: '  starkiller ', cueverseId: 'Starkiller' }) === 'id-only')

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
  // The page is permanently all-time, so what the file records is the YEAR RANGE it covers — which
  // is what distinguishes an all-time export from a filtered one in a folder full of both.
  check('the year range is recorded in the file', csv.includes('All time'))
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
section('Rating tiers: every boundary, from both sides')
{
  // The bands ARE the feature, so each is asserted at its floor and one below it. A band that is
  // right in the middle and wrong on the line is wrong for every player sitting on that line.
  const cases: [number, string][] = [
    [0, 'grey'],
    [1, 'grey'],
    [1199, 'grey'],
    [1200, 'grey'],
    [1299, 'grey'],
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

  check('exactly 1300 is Green, not Grey', ratingTier(1300) === 'green')
  check('exactly 1299 is Grey, not Green', ratingTier(1299) === 'grey')
  check('exactly 1600 is Gold', ratingTier(1600) === 'gold')
  check('exactly 1599 is Purple, not Gold', ratingTier(1599) === 'purple')
  check('exactly 1500 is Purple', ratingTier(1500) === 'purple')
  check('exactly 1499 is Blue, not Purple', ratingTier(1499) === 'blue')
  check('exactly 1400 is Blue', ratingTier(1400) === 'blue')
  check('exactly 1399 is Green, not Blue', ratingTier(1399) === 'green')
  check('exactly 1300 is Green', ratingTier(1300) === 'green')
  check('exactly 1299 is Grey', ratingTier(1299) === 'grey')

  // The superseded scheme, asserted as ABSENT. 1500-1599 was red; anyone reading a red rating as
  // "elite" is reading the old mapping, so its removal is a fact worth keeping a test on.
  check('the old Red 1500-1599 mapping is gone', ratingTier(1500) !== 'red' && ratingTier(1599) !== 'red')
  // Red is no longer a band at all — it belongs to first place alone.
  check('no rating is banded red',
    [0, 1199, 1250, 1299, 1300, 1400, 1500, 1600, 1900].every((r) => ratingTier(r) !== 'red'))
  check('everything below 1300 is grey',
    [0, 1, 1199, 1200, 1299].every((r) => ratingTier(r) === 'grey'))
  check('a negative rating is still Grey rather than untiered', ratingTier(-50) === 'grey')

  // An absent rating is NOT a tier. Grey would say "rated below 1200", a different claim entirely.
  check('a missing rating has no tier', ratingTier(null) === null)
  check('an undefined rating has no tier', ratingTier(undefined) === null)
  check('NaN has no tier', ratingTier(Number.NaN) === null)
  check('Infinity has no tier', ratingTier(Number.POSITIVE_INFINITY) === null)

  check('every band is reachable', new Set(cases.map(([r]) => ratingTier(r))).size === 5)

  // Monotonic: a higher rating can never land in a lower band. Cheap, and it catches any future
  // edit that reorders the bands.
  const RANK: Record<string, number> = { grey: 0, green: 1, blue: 2, purple: 3, gold: 4 }
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
  check('a below-floor rating is described', ratingAriaLabel(1250) === '1250 rating, Grey tier')
  check('a Grey rating is described', ratingAriaLabel(1150) === '1150 rating, Grey tier')
  check('a missing rating gets no label — the dash already says it', ratingAriaLabel(null) === undefined)
  check('every tier has a name',
    (['gold', 'purple', 'blue', 'green', 'grey'] as const).every((t) => ratingTierLabel(t).length > 0))
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
  check('a low-rated leader is still low-banded', ratingTier(1250) === 'grey')

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

  /*
   * The rule changed, and what it protects did not.
   *
   * This used to forbid any shadow on a rating. The fault it was written against was real — the
   * first neon attempt smeared the digits — but the cause was OFFSET, not light: a shadow with an
   * x/y offset paints a displaced second copy of the glyph. A zero-offset halo lights the space
   * around the number and leaves its edges untouched.
   *
   * So a halo is now allowed and an offset shadow is not, which is the same legibility guarantee
   * expressed against the thing that actually breaks it. The animation ban stands: a number that
   * moves is a number nobody can read.
   */
  const shadows = [...rule.matchAll(/text-shadow:\s*([^;]+);/g)].map((m) => m[1])
  check('the rating is lit by a zero-offset halo, never a displaced copy',
    shadows.every((v) => v.trim() === 'none' || /(^|,)\s*0 0 /.test(v)), shadows.join(' | '))
  check('the rating carries no animation', !rule.includes('animation'))
  check('no breathing keyframes remain anywhere', !css.includes('rating-breathe'))

  check('a class exists for every band',
    (['gold', 'purple', 'blue', 'green', 'grey'] as const)
      .every((t) => css.includes(`.rating-primary--${t}`)))
  check('every band has a colour',
    (css.match(/--tier-gold:/g) ?? []).length === 1 && (css.match(/--tier-grey:/g) ?? []).length === 1)
  /*
   * The top band leads the eye. That is the rule; "brighter than --gold" was only ever a way of
   * saying it.
   *
   * The old assertion compared --tier-gold against the chrome gold, because the two used to be the
   * same hue and the chrome one was deliberately damped so it could sit behind text. Under the
   * current palette that relationship no longer exists: the top band is the structural acid, and
   * --gold has been narrowed to mean a championship. Comparing them now would be comparing two
   * colours that answer different questions.
   *
   * So the rule is asserted directly instead — the top band must be the lightest of the five, which
   * is what makes it the number your eye finds first in a column of sixty, and it must clear the
   * page ground by a real margin so that being brightest never costs legibility.
   */
  const BAND_DECLS = readDeclarations(css)
  const bands = (['gold', 'purple', 'blue', 'green', 'grey'] as const)
    .map((t) => { const lit = resolveToken(`--tier-${t}`, BAND_DECLS); return { t, p: lit ? parseColor(lit) : null } })
  check('every band resolves to a real colour',
    bands.every((b) => b.p != null), bands.filter((b) => !b.p).map((b) => b.t).join(', '))
  const top = bands.find((b) => b.t === 'gold')!.p
  check('the top band is the lightest of the five, so it leads the eye',
    top != null && bands.every((b) => b.p == null || b.t === 'gold' || b.p.l <= top.l),
    bands.map((b) => `${b.t}=${b.p ? b.p.l.toFixed(2) : '?'}`).join(' '))
  const ground = resolveToken('--background', BAND_DECLS)
  const ratio = ground ? contrastRatio(resolveToken('--tier-gold', BAND_DECLS) ?? '', ground) : null
  check('...and it stays legible on the page ground',
    ratio != null && ratio >= 4.5, ratio ? `${ratio.toFixed(1)}:1` : 'unmeasurable')
  check('first place has its own colour ',
    (css.match(/--rating-top:/g) ?? []).length === 1)
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
  check('the leader is computed from the rows actually shown',
    table.includes('highestRatingOf(rows.map((r) => r.rating))'))
  check('an absent rating stays a plain dash',
    table.includes('if (tier == null) return <span className="text-muted-foreground">—</span>'))
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
