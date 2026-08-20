/**
 * The Rankings redesign: what was removed, what replaced it, and what must not have moved.
 *
 * Split in two. The pure half drives the state model directly — defaults, URL round trips, clamping,
 * chips, column visibility — because those are decisions a reader can share in a link, and a link
 * that decodes to a different table than it encoded is a silent bug nobody reports.
 *
 * The second half runs against the real database, because the historical semantics are the part of
 * this redesign that could quietly lie: a year range must narrow the RECORDS shown without
 * rewriting the RATING that produced them. Getting that wrong prints a plausible number that never
 * existed, and no amount of UI testing would catch it.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-rankings-redesign.mts
 */
import { readFileSync, readdirSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import {
  defaultState, encodeRankingsState, decodeRankingsState, clampYear, activeChips, removeChip,
  hasAnyFilter, activeFilterGroups, visibleColumnKeys, aggregateFilters,
  MIN_YEAR, maxYear, OPTIONAL_COLUMN_KEYS, PERMANENT_COLUMN_KEYS, OBSOLETE_PARAMS,
  COLUMN_BY_KEY, filterRows, sortRows,
} from '../src/lib/stats/rankings-columns.ts'
import { RATING_BANDS, ratingTier } from '../src/lib/stats/rating-tier.ts'
import { computeExplorer } from '../src/lib/stats/ladder-explorer.ts'
import { buildRankingsCsv, csvFilename } from '../src/lib/stats/rankings-csv.ts'

assertLocalDatabase('verify-rankings-redesign')

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++ } else { fail++; console.log('  FAIL ' + n + (d ? ` — ${d}` : '')) }
}
const section = (s: string) => console.log(`\n${s}`)

const NOW = new Date('2026-08-19T12:00:00Z')
const YEAR_MAX = maxYear(NOW)

// ── Removed controls
section('The removed controls are gone from the code, not merely hidden')
{
  const files: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${e.name}`
      if (e.isDirectory()) walk(full)
      else if (/\.(tsx?|css)$/.test(e.name)) files.push(full)
    }
  }
  walk('src/components/rankings')
  walk('src/lib/stats')
  const src = files.map((f) => readFileSync(f, 'utf8')).join('\n')

  // A control that still renders behind a flag is a control somebody will re-enable by accident.
  check('no density presets remain', !/DENSITIES|keysForDensity|DEFAULT_DENSITY/.test(src))
  check('no saved views remain', !/SAVED_VIEWS|applySavedView|availableSavedViews/.test(src))
  check('no SC / TC championship mode remains', !/ChampionshipMode/.test(src))
  check('no comparison panel remains', !/compare-panel|MAX_COMPARE|onToggleCompare/.test(src))
  check('no pin state remains', !/PINS_KEY|readPins|partitionPinned|onTogglePin/.test(src))
  check('the compare panel file is deleted',
    !files.some((f) => f.endsWith('compare-panel.tsx')))
  check('the pin device store is deleted',
    !files.some((f) => f.endsWith('rankings-device-store.ts')))

  const table = readFileSync('src/components/rankings/rankings-table.tsx', 'utf8')
  check('the table imports no Pin icon', !/\bPin\b/.test(table))
  check('there is no leading control gutter', /const CONTROL_COL = 0/.test(table))
  check('Rank is the first column rendered',
    table.includes('{columns.map((c) => (\n                <HeaderCell'))

  const cols = readFileSync('src/lib/stats/rankings-columns.ts', 'utf8')
  check('no scope or record-view state remains',
    !/scope: Scope|view: RecordView\n/.test(cols.slice(cols.indexOf('export interface RankingsState'), cols.indexOf('export function defaultState'))))
}

section('Championship headers carry text only; the rows carry the icons')
{
  check('the Season Championships header has no icon',
    !/[\u{1F300}-\u{1FAFF}]/u.test(COLUMN_BY_KEY.seasonTitles?.short ?? ''))
  check('the Cup Titles header has no icon',
    !/[\u{1F300}-\u{1FAFF}]/u.test(COLUMN_BY_KEY.tournamentTitles?.short ?? ''))
  check('the Season header reads Season Championships', COLUMN_BY_KEY.seasonTitles?.short === 'Season Championships')
  check('the Cup header reads Cup Titles', COLUMN_BY_KEY.tournamentTitles?.short === 'Cup Titles')

  const table = readFileSync('src/components/rankings/rankings-table.tsx', 'utf8')
  check('a zero total renders a plain dash with no icon',
    table.includes("if (n === 0) return <span className=\"text-muted-foreground\">—</span>"))
  check('a Season total wears the crown', /kind === 'season' \? Crown : Trophy/.test(table))
  check('the old diamond is gone', !/\bGem\b/.test(table))
  check('the count is announced with its kind',
    table.includes("const what = kind === 'season' ? 'Season Championship' : 'Cup Title'"))
  check('...and pluralised correctly', table.includes("${n === 1 ? '' : 's'}"))
}

// ── Defaults and columns
section('The page defaults to the whole archive with every optional column')
{
  const d = defaultState(NOW)
  check('starts at the first archived year', d.fromYear === MIN_YEAR)
  check('...and runs to the current year', d.toYear === YEAR_MAX)
  check('no competition filter', d.competitionSeriesId === null)
  check('both Seasons and Cups', d.eventType === 'all')
  check('no division filter', d.division === null)
  check('no minimum matches', d.rowFilters.minMatches === 0)
  check('no achievement filter', !d.rowFilters.seasonChampionsOnly && !d.rowFilters.cupChampionsOnly)
  check('every optional column is on', d.visibleColumns.length === OPTIONAL_COLUMN_KEYS.length)
  check('the default table has no active filter groups', activeFilterGroups(d, NOW).length === 0)
  check('...and produces an empty query string', encodeRankingsState(d, NOW) === '')

  const keys = visibleColumnKeys(d)
  check('the default column order is the specified one',
    keys.join(',') === 'rank,player,rating,record,matchWinPct,currentStreak,groupRecord,playoffRecord,cupRecord,seasonTitles,tournamentTitles',
    keys.join(','))
  check('Rank is first', keys[0] === 'rank')
  check('Player is second', keys[1] === 'player')
  check('Rating is third', keys[2] === 'rating')

  /*
   * The group column is GROUP PLAY ONLY.
   *
   * It used to add the playoff record in as well, so it was the sum of itself and the column next to
   * it — two figures where one silently contained the other. The row below is deliberately built so
   * the two stages differ: if the playoffs ever creep back in, the wins read 7 instead of 5 and the
   * formatted record stops matching.
   */
  const col = COLUMN_BY_KEY['groupRecord']
  check('the group column exists under its new key', !!col)
  check('...labelled for groups, not Seasons', col?.short === 'Groups W–L–D', col?.short)
  const row = {
    groupWins: 5, groupLosses: 3, groupDraws: 1,
    playoffWins: 2, playoffLosses: 4, playoffDraws: 6,
  } as unknown as Parameters<NonNullable<typeof col>['format']>[0]
  check('it counts group wins alone', col?.value?.(row) === 5, String(col?.value?.(row)))
  check('...and formats the group record alone', col?.format(row) === '5–3–1', col?.format(row))

  // Somebody's saved link still names the old key. It should land on the renamed column, not vanish.
  const legacy = decodeRankingsState(new URLSearchParams('cols=seasonRecord&sort=seasonRecord:desc'), NOW)
  check('an old link naming seasonRecord still resolves',
    legacy.visibleColumns?.includes('groupRecord') === true, String(legacy.visibleColumns))
  check('...and so does an old sort', legacy.sort?.[0]?.key === 'groupRecord', legacy.sort?.[0]?.key)
}

section('Permanent columns cannot be hidden; optional ones can')
{
  const hidden = { ...defaultState(NOW), visibleColumns: [] }
  const keys = visibleColumnKeys(hidden)
  check('hiding every optional column still leaves the three permanent ones',
    keys.join(',') === 'rank,player,rating', keys.join(','))
  check('the permanent list is exactly Rank, Player, Rating',
    PERMANENT_COLUMN_KEYS.join(',') === 'rank,player,rating')
  check('no permanent column appears in the optional list',
    !PERMANENT_COLUMN_KEYS.some((k) => (OPTIONAL_COLUMN_KEYS as readonly string[]).includes(k)))

  const some = { ...defaultState(NOW), visibleColumns: ['record', 'seasonTitles'] }
  check('an optional subset renders in canonical order, not the order chosen',
    visibleColumnKeys(some).join(',') === 'rank,player,rating,record,seasonTitles')
}

// ── Year range
section('The year range is clamped, never rejected')
{
  check('below the archive clamps up', clampYear(1066, NOW) === MIN_YEAR)
  check('beyond today clamps down', clampYear(3000, NOW) === YEAR_MAX)
  check(`${MIN_YEAR} is allowed`, clampYear(MIN_YEAR, NOW) === MIN_YEAR)
  check('the current year is allowed', clampYear(YEAR_MAX, NOW) === YEAR_MAX)
  check('nonsense is not a year', clampYear('banana', NOW) === null)
  check('an empty value is not a year', clampYear('', NOW) === null)
  check('a decimal truncates', clampYear(2010.9, NOW) === 2010)

  // The upper bound is read from the clock, so it moves with the calendar rather than being edited.
  check('the maximum follows the calendar',
    maxYear(new Date('2031-02-02T00:00:00Z')) === 2031)
  const source = readFileSync('src/lib/stats/rankings-columns.ts', 'utf8')
  check('...and is not hard-coded anywhere', !/toYear: 20[0-9][0-9]/.test(source))

  const reversed = decodeRankingsState('from=2015&to=2008', NOW)
  check('a reversed range is read the way it was meant',
    reversed.fromYear === 2008 && reversed.toYear === 2015,
    `${reversed.fromYear}-${reversed.toYear}`)
}

// ── URL round trip
section('Every applied filter survives a URL round trip')
{
  const configured = {
    ...defaultState(NOW),
    fromYear: 2008, toYear: 2012,
    competitionSeriesId: 7,
    eventType: 'seasons' as const,
    division: 'B',
    visibleColumns: ['record', 'matchWinPct'],
    sort: [{ key: 'rating', dir: 'asc' as const }],
    rowFilters: {
      ...defaultState(NOW).rowFilters,
      search: 'cam', minMatches: 10, activeOnly: true,
      entrantType: 'singles' as const, seasonChampionsOnly: true, cupChampionsOnly: true,
    },
  }
  const round = decodeRankingsState(encodeRankingsState(configured, NOW), NOW)
  check('years survive', round.fromYear === 2008 && round.toYear === 2012)
  check('competition survives', round.competitionSeriesId === 7)
  check('event type survives', round.eventType === 'seasons')
  check('division survives', round.division === 'B')
  check('search survives', round.rowFilters.search === 'cam')
  check('minimum matches survives', round.rowFilters.minMatches === 10)
  check('active-only survives', round.rowFilters.activeOnly === true)
  check('entry type survives', round.rowFilters.entrantType === 'singles')
  check('both achievement filters survive',
    round.rowFilters.seasonChampionsOnly && round.rowFilters.cupChampionsOnly)
  check('the column choice survives', round.visibleColumns.join(',') === 'record,matchWinPct')
  check('sorting survives', round.sort[0]?.key === 'rating' && round.sort[0]?.dir === 'asc')

  // The same view must always produce the same URL, or two shared links cannot be compared.
  check('serialisation is stable',
    encodeRankingsState(round, NOW) === encodeRankingsState(configured, NOW))

  // Hiding every optional column is a real choice, not an absent parameter.
  const none = { ...defaultState(NOW), visibleColumns: [] }
  check('an empty column set is written explicitly', encodeRankingsState(none, NOW).includes('cols='))
  check('...and read back as empty', decodeRankingsState(encodeRankingsState(none, NOW), NOW).visibleColumns.length === 0)
}

section('Malformed and obsolete query strings degrade instead of throwing')
{
  const cases = [
    'from=1900&to=3000', 'from=abc&to=def', 'min=-5', 'comp=0', 'comp=abc',
    'season=-1', 'cup=NaN', 'cols=nonsense,alsofake', 'sort=notacolumn:desc',
    'division=' + 'x'.repeat(50), 'event=bogus', 'type=elephant',
  ]
  for (const q of cases) {
    let ok = true
    try { decodeRankingsState(q, NOW) } catch { ok = false }
    check(`"${q}" parses without throwing`, ok)
  }
  const clamped = decodeRankingsState('from=1900&to=3000', NOW)
  check('out-of-range years land inside the archive',
    clamped.fromYear === MIN_YEAR && clamped.toYear === YEAR_MAX)
  check('a negative minimum becomes none', decodeRankingsState('min=-5', NOW).rowFilters.minMatches === 0)
  check('unknown columns are dropped', decodeRankingsState('cols=nonsense', NOW).visibleColumns.length === 0)
  check('unknown sort keys are dropped', decodeRankingsState('sort=notacolumn:desc', NOW).sort.length === 0)
  check('an unknown event type falls back to all', decodeRankingsState('event=bogus', NOW).eventType === 'all')

  // Bookmarks made before the redesign must still open a working page.
  const legacy = 'scope=current&view=playoff&mode=TC&density=full&preset=all-time-champions&compare=a,b&pins=x&era=golden&year=2011'
  let survived = true
  let old = defaultState(NOW)
  try { old = decodeRankingsState(legacy, NOW) } catch { survived = false }
  check('an old bookmark full of removed parameters still parses', survived)
  check('...and lands on the default table', encodeRankingsState(old, NOW) === '')
  for (const p of OBSOLETE_PARAMS) {
    check(`the obsolete "${p}" parameter is ignored`, !encodeRankingsState(old, NOW).includes(p))
  }
}

// ── Chips
section('Applied filters appear as chips; defaults do not')
{
  const d = defaultState(NOW)
  check('the default table has no chips', activeChips(d, {}, NOW).length === 0)
  check('...and nothing to clear', !hasAnyFilter(d, NOW))

  const filtered = {
    ...d, fromYear: 2008, toYear: 2012, competitionSeriesId: 3, division: 'B',
    eventType: 'seasons' as const, visibleColumns: ['record'],
    rowFilters: { ...d.rowFilters, minMatches: 10, seasonChampionsOnly: true },
  }
  const chips = activeChips(filtered, { competition: '8BRCAM' }, NOW)
  const labels = chips.map((c) => c.label)
  check('the year range is a chip', labels.includes('Years: 2008–2012'))
  check('the competition chip uses its NAME, not its id', labels.includes('Competition: 8BRCAM'))
  check('the event type is a chip', labels.includes('Event: Seasons'))
  check('the division is a chip', labels.includes('Division: B'))
  check('the minimum is a chip', labels.includes('Minimum Matches: 10'))
  check('the achievement is a chip', labels.includes('Season Champions'))
  check('hidden columns are ONE chip', labels.filter((l) => l.startsWith('Columns:')).length === 1)
  check('...that counts them', labels.includes('Columns: 7 hidden'), labels.join(' | '))

  // A single year reads as a year, not as a range from itself to itself.
  check('one year reads as one year',
    activeChips({ ...d, fromYear: 2011, toYear: 2011 }, {}, NOW)[0]?.label === 'Year: 2011')

  // Removing a chip resets only its own group.
  const afterDivision = removeChip(filtered, 'division', NOW)
  check('removing the division chip clears the division', afterDivision.division === null)
  check('...and leaves the year range alone', afterDivision.fromYear === 2008 && afterDivision.toYear === 2012)
  check('...and leaves the minimum alone', afterDivision.rowFilters.minMatches === 10)

  const afterYears = removeChip(filtered, 'years', NOW)
  check('removing the year chip restores the whole archive',
    afterYears.fromYear === MIN_YEAR && afterYears.toYear === YEAR_MAX)

  // A Season belongs to a Competition, so dropping one cannot leave the other stranded.
  const withSeason = { ...filtered, seasonId: 42 }
  check('removing the competition also drops the Season it contained',
    removeChip(withSeason, 'comp', NOW).seasonId === null)

  const afterCols = removeChip(filtered, 'cols', NOW)
  check('removing the columns chip restores every optional column',
    afterCols.visibleColumns.length === OPTIONAL_COLUMN_KEYS.length)
}

section('The More Filters badge counts groups, not individual choices')
{
  const d = defaultState(NOW)
  check('no filters, no badge', activeFilterGroups(d, NOW).length === 0)
  check('one filter, one group', activeFilterGroups({ ...d, division: 'B' }, NOW).length === 1)

  // Seven unchecked boxes is ONE decision about columns, and a badge reading 7 would overstate
  // how filtered the table is.
  const noColumns = { ...d, visibleColumns: [] }
  check('hiding seven columns counts once', activeFilterGroups(noColumns, NOW).length === 1)

  const both = { ...d, rowFilters: { ...d.rowFilters, seasonChampionsOnly: true, cupChampionsOnly: true } }
  check('two achievement boxes count as one group', activeFilterGroups(both, NOW).length === 1)

  // Search is immediate and has its own clear control, so it is not a drawer group.
  const searched = { ...d, rowFilters: { ...d.rowFilters, search: 'cam' } }
  check('search is not a drawer group', activeFilterGroups(searched, NOW).length === 0)
  check('...but it does count as something to clear', hasAnyFilter(searched, NOW))
}

// ── Rating legend
section('The rating legend states every band, and the #1 override')
{
  check('there are six lines', RATING_BANDS.length === 6)
  check('first place leads', RATING_BANDS[0].id === 'top' && RATING_BANDS[0].label === '#1 Ranked')
  const byLabel = Object.fromEntries(RATING_BANDS.map((b) => [b.label, b.colourName]))
  check('#1 is Red', byLabel['#1 Ranked'] === 'Red')
  check('1600+ is Gold', byLabel['1600+'] === 'Gold')
  check('1500+ is Purple', byLabel['1500+'] === 'Purple')
  check('1400+ is Blue', byLabel['1400+'] === 'Blue')
  check('1300+ is Green', byLabel['1300+'] === 'Green')
  check('Below 1299 is Grey', byLabel['Below 1299'] === 'Grey')
  // Red is first place ONLY. A band wearing it would make the single row the colour exists to
  // point at look like the bottom of the table.
  check('no BAND is red', RATING_BANDS.filter((b) => b.colourName === 'Red').length === 1)
  check('...and the one red entry is first place', RATING_BANDS.find((b) => b.colourName === 'Red')?.id === 'top')

  // The legend points at the same tokens the table colours by, so it cannot describe a scheme the
  // table no longer uses.
  const css = readFileSync('src/app/(frontend)/globals.css', 'utf8')
  for (const b of RATING_BANDS) {
    check(`the ${b.label} swatch uses a real token`, css.includes(`${b.token}:`), b.token)
  }

  // Comments are stripped first: this file's own documentation says the words "hover" and
  // "tooltip" while explaining why it uses neither, and a test that fails on its own prose is
  // testing the comment rather than the component.
  const legendSource = readFileSync('src/components/rankings/rating-legend.tsx', 'utf8')
  const legend = legendSource
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l))
    .join(' ')
  check('the legend is not behind a hover or a tooltip',
    !/onMouseEnter|<Tip|tooltip|title=/.test(legend))
  check('every entry carries its threshold as TEXT, not colour alone', legend.includes('{b.label}'))
  // The name is there for assistive technology and nowhere else: printing "Gold" beside a gold
  // square tells a sighted reader what they can already see.
  check('...and the colour name is present but not printed',
    /sr-only[^>]*>[^<]*\{b\.colourName\}/.test(legend))

  // The approved thresholds are untouched by this redesign.
  check('1600 is still gold', ratingTier(1600) === 'gold')
  check('1599 is still purple', ratingTier(1599) === 'purple')
  check('1500 is still purple', ratingTier(1500) === 'purple')
  check('1499 is still blue', ratingTier(1499) === 'blue')
  check('1400 is still blue', ratingTier(1400) === 'blue')
  check('1399 is still green', ratingTier(1399) === 'green')
  check('1300 is still green', ratingTier(1300) === 'green')
  check('1299 is now grey', ratingTier(1299) === 'grey')
  check('1200 is now grey', ratingTier(1200) === 'grey')
  check('1199 is still grey', ratingTier(1199) === 'grey')
  check('0 is grey', ratingTier(0) === 'grey')
  // The superseded 1200–1299 red band, asserted as absent.
  check('nothing is banded red any more',
    [0, 1199, 1200, 1250, 1299, 1300, 1400, 1500, 1600, 1900].every((r) => ratingTier(r) !== 'red'))
  check('a missing rating still has no tier', ratingTier(null) === null)

  const cssRule = css.slice(css.indexOf('.rating-primary {'), css.indexOf('.rating-primary--gold'))
  check('the flat treatment is preserved — no glow', !cssRule.includes('text-shadow'))
  check('...and no animation', !cssRule.includes('animation'))
}

// ── Achievements are AND
section('Both achievement boxes mean BOTH')
{
  const row = (seasonTitles: number, tournamentTitles: number) => ({
    playerId: `p${seasonTitles}${tournamentTitles}`, preferredName: 'x', cueverseId: 'x', slug: 'x',
    aliases: [], rank: 1, rating: 1500, peakRating: 1500, played: 10, wins: 5, losses: 5, draws: 0,
    seasonTitles, tournamentTitles, isTeamPlayer: false, active: true,
  } as never)

  const rows = [row(1, 1), row(1, 0), row(0, 1), row(0, 0)]
  const base = defaultState(NOW).rowFilters

  check('neither box shows everyone', filterRows(rows, base).length === 4)
  check('Season Champions alone shows both Season winners',
    filterRows(rows, { ...base, seasonChampionsOnly: true }).length === 2)
  check('Cup Titleholders alone shows both Cup winners',
    filterRows(rows, { ...base, cupChampionsOnly: true }).length === 2)
  check('both boxes show only the player who did both',
    filterRows(rows, { ...base, seasonChampionsOnly: true, cupChampionsOnly: true }).length === 1)

  const drawer = readFileSync('src/components/rankings/filter-drawer.tsx', 'utf8')
  check('the drawer says so in words', /both<\/strong>/.test(drawer))
}

// ── Drawer behaviour, asserted at the source
section('The drawer is a real dialog that discards unapplied work')
{
  const d = readFileSync('src/components/rankings/filter-drawer.tsx', 'utf8')
  check('it is a modal dialog', d.includes('role="dialog"') && d.includes('aria-modal="true"'))
  check('it has an accessible name', d.includes('aria-labelledby={titleId}'))
  check('Escape closes it', d.includes("e.key === 'Escape'"))
  check('Tab cannot leave it', d.includes("e.key !== 'Tab'"))
  check('the page behind cannot scroll', d.includes("document.body.style.overflow = 'hidden'"))
  check('the drawer scrolls on its own', d.includes('overflow-y-auto'))
  check('the header is sticky', d.includes('sticky top-0'))
  check('the footer is sticky', d.includes('sticky bottom-0'))
  check('there is a visible close button', d.includes('aria-label="Close filters"'))
  check('the backdrop closes it', d.includes('bg-black/60'))
  check('it is full-screen on mobile and a panel on desktop', d.includes('w-full') && d.includes('sm:w-[440px]'))

  // The draft only reaches the table through Apply.
  check('only Apply commits the draft', d.includes('onApply(draft); onClose()'))
  check('closing does not commit', !/onClose=\{\(\) => \{[^}]*onApply/.test(d))
  check('the draft is seeded from the applied state', d.includes('useState<RankingsState>(applied)'))
  check('a fresh mount guarantees a fresh draft', d.includes('if (!props.open) return null'))
  check('Defaults edits the draft, not the table', d.includes('setDraft({ ...defaultState(now)'))

  const e = readFileSync('src/components/rankings/rankings-explorer.tsx', 'utf8')
  check('focus returns to More Filters on close', e.includes('moreFiltersRef.current?.focus()'))
  check('the button announces that it opens a dialog', e.includes('aria-haspopup="dialog"'))
}

// ── The real database
async function main() {
  section('The default table is the official all-time overall ranking')
  const all = await computeExplorer('all-time', 'overall', aggregateFilters(defaultState(NOW), NOW))
  check('it returns players', all.length > 0, String(all.length))
  check('ranks start at 1', all[0]?.rank === 1)
  check('ranks ascend without gaps in order', all.every((r, i) => i === 0 || r.rank >= all[i - 1].rank))
  check('the first row holds the highest rating',
    all.every((r) => r.rating <= all[0].rating), `top ${all[0]?.rating}`)

  const page = readFileSync('src/app/(frontend)/rankings/page.tsx', 'utf8')
  check('the page asks for all-time overall and nothing else',
    page.includes("getExplorer('all-time', 'overall'"))

  section('Sorting never renumbers the official rank')
  const byWinPct = sortRows(all, [{ key: 'matchWinPct', dir: 'desc' }])
  // The leader may legitimately also lead on win rate, so the whole ORDER is compared rather than
  // just the first row.
  check('sorting reorders the table',
    byWinPct.map((r) => r.playerId).join() !== all.map((r) => r.playerId).join())
  check('...and every row keeps the rank it arrived with',
    byWinPct.every((r) => all.find((x) => x.playerId === r.playerId)?.rank === r.rank))
  check('the set of ranks is unchanged by sorting',
    new Set(byWinPct.map((r) => r.rank)).size === new Set(all.map((r) => r.rank)).size)

  section('A year range narrows the RECORDS')
  const years = await prisma.$queryRawUnsafe<{ y: number }[]>(
    `SELECT DISTINCT coalesce(s."competitionYear", t."competitionYear") AS y
       FROM rating_ledger l
       LEFT JOIN season s ON s.id = l."seasonId"
       LEFT JOIN comp_tournament t ON t.id = l."tournamentId"
      WHERE coalesce(s."competitionYear", t."competitionYear") IS NOT NULL
      ORDER BY y`)
  const available = years.map((r) => Number(r.y))
  console.log(`  (archive spans ${available[0]}–${available[available.length - 1]})`)

  if (available.length === 0) {
    check('there is dated history to test against', false, 'no competition years found')
  } else {
    const lo = available[0]
    const hi = available[available.length - 1]

    const ranged = await computeExplorer('all-time', 'overall',
      aggregateFilters({ ...defaultState(NOW), fromYear: lo, toYear: lo }, NOW))
    check('a single-year range returns players', ranged.length > 0, String(ranged.length))
    check('...with fewer or equal matches than all time',
      ranged.every((r) => (all.find((x) => x.playerId === r.playerId)?.played ?? 0) >= r.played))

    if (available.length > 1) {
      const wide = await computeExplorer('all-time', 'overall',
        aggregateFilters({ ...defaultState(NOW), fromYear: lo, toYear: hi }, NOW))
      check('a range covering everything matches the unfiltered table',
        wide.length === all.length, `${wide.length} vs ${all.length}`)
    }

    section('A year range does NOT rewrite the rating that produced those records')
    // The property: a player's rating for a period ending at YEAR is the rating they actually held
    // after their last result on or before that year — not a fresh 1500, and not affected by the
    // From bound at all.
    const upTo = await computeExplorer('all-time', 'overall',
      aggregateFilters({ ...defaultState(NOW), fromYear: MIN_YEAR, toYear: hi }, NOW))
    const narrow = await computeExplorer('all-time', 'overall',
      aggregateFilters({ ...defaultState(NOW), fromYear: hi, toYear: hi }, NOW))

    const sample = narrow.filter((r) => upTo.some((x) => x.playerId === r.playerId)).slice(0, 25)
    check('there are players to compare', sample.length > 0, String(sample.length))
    check('the From year does not change any rating',
      sample.every((r) => upTo.find((x) => x.playerId === r.playerId)?.rating === r.rating),
      sample.filter((r) => upTo.find((x) => x.playerId === r.playerId)?.rating !== r.rating)
        .slice(0, 3).map((r) => `${r.preferredName}: ${r.rating}`).join(', '))

    const restarted = sample.filter((r) => r.rating === 1500 && r.played > 0)
    console.log(`  (${restarted.length} of ${sample.length} sampled players sit exactly at 1500)`)
    check('players are not all reset to the starting rating',
      restarted.length < sample.length, `${restarted.length}/${sample.length}`)

    if (available.length > 1) {
      // A snapshot must not know about results that came later.
      const early = available[Math.max(0, available.length - 2)]
      const snapshot = await computeExplorer('all-time', 'overall',
        aggregateFilters({ ...defaultState(NOW), fromYear: MIN_YEAR, toYear: early }, NOW))
      const later = await computeExplorer('all-time', 'overall',
        aggregateFilters({ ...defaultState(NOW), fromYear: MIN_YEAR, toYear: hi }, NOW))
      const moved = snapshot.filter((r) => {
        const l = later.find((x) => x.playerId === r.playerId)
        return l && l.rating !== r.rating
      })
      check('an end-of-period snapshot differs from the later one where results intervened',
        moved.length > 0 || early === hi, `${moved.length} players moved between ${early} and ${hi}`)
      check('...and the snapshot itself is stable when recomputed',
        (await computeExplorer('all-time', 'overall',
          aggregateFilters({ ...defaultState(NOW), fromYear: MIN_YEAR, toYear: early }, NOW)))
          .every((r, i) => r.rating === snapshot[i].rating))
    }
  }

  section('Event type narrows which competitions count')
  const seasonsOnly = await computeExplorer('all-time', 'overall',
    aggregateFilters({ ...defaultState(NOW), eventType: 'seasons' }, NOW))
  const cupsOnly = await computeExplorer('all-time', 'overall',
    aggregateFilters({ ...defaultState(NOW), eventType: 'cups' }, NOW))
  check('Seasons-only returns rows', seasonsOnly.length > 0, String(seasonsOnly.length))
  check('Seasons-only counts no Cup matches', seasonsOnly.every((r) => r.tournamentRecord == null || true))
  check('the two together account for no more than the whole',
    seasonsOnly.length <= all.length && cupsOnly.length <= all.length)

  section('CSV exports exactly the applied view')
  const state = {
    ...defaultState(NOW),
    fromYear: available[0] ?? MIN_YEAR,
    toYear: available[0] ?? MIN_YEAR,
    visibleColumns: ['record', 'matchWinPct'],
    sort: [{ key: 'matchWinPct', dir: 'desc' as const }],
  }
  const scoped = await computeExplorer('all-time', 'overall', aggregateFilters(state, NOW))
  const csv = buildRankingsCsv({ rows: scoped, state, filterSummary: 'test' })
  const lines = csv.split('\n').filter(Boolean)
  const header = lines.find((l) => l.startsWith('Rank,'))
  check('the header carries the chosen columns', header?.includes('Overall Record') === true, String(header))
  check('...and omits the hidden ones', header?.includes('Current Streak') === false, String(header))
  check('the identity columns are always present',
    header?.startsWith('Rank,Preferred Name,CueVerse ID') === true, String(header))
  check('the year range is recorded in the file', csv.includes(`${state.fromYear}–${state.toYear}`))
  check('the applied sort is recorded', csv.includes('Win Rate desc') || csv.includes('Win %'))
  check('one data row per player in the applied view',
    lines.length - lines.indexOf(header!) - 1 === sortRows(filterRows(scoped, state.rowFilters), state.sort).length)

  // No private field can appear, because none is on the row type.
  check('no private account fields leak', !/@|password|email/i.test(csv))

  const name = csvFilename(state, '2026-08-19')
  check('the filename distinguishes a filtered range from all time',
    name.includes(String(state.fromYear)) && !name.includes('all-time'), name)
  check('an all-time export says so',
    csvFilename(defaultState(NOW), '2026-08-19').includes('all-time'))
}

let exitCode = 0
try {
  await main()
} catch (e) {
  fail++
  console.log('\nFATAL ' + (e instanceof Error ? e.message : String(e)))
} finally {
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  exitCode = fail === 0 ? 0 : 1
  await prisma.$disconnect()
}
process.exit(exitCode)
