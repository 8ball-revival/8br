/**
 * The four scopes of the current rankings.
 *
 * The thing being proved is a negative: whatever the URL says, whatever the reader filters, and
 * whatever the archive contains, this page shows CueVerse results only. That used not to be true --
 * the page fell back to the Yahoo ladder whenever CueVerse had no rated matches, so it opened on
 * forty-eight archived seasons under a heading reading "Rankings". Half these checks exist to make
 * sure that cannot come back.
 *
 * The other half is arithmetic: each scope must be DERIVED from its own results rather than being
 * the same table with rows hidden.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env.replica scripts/verify-rankings-scopes.mts
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import {
  RANKING_SCOPES, DEFAULT_SCOPE, parseScope, scopeOverlay, scopePinsCompetition,
  SCOPE_DEFINITIONS, SCOPE_SERIES_SLUG,
} from '../src/lib/stats/rankings-scope.ts'
import {
  decodeRankingsState, encodeRankingsState, aggregateFilters, defaultState, OBSOLETE_PARAMS,
} from '../src/lib/stats/rankings-columns.ts'
import { computeExplorer } from '../src/lib/stats/ladder-explorer.ts'

assertLocalDatabase('verify-rankings-scopes')

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++ } else { fail++; console.log('  FAIL ' + n + (d ? ' - ' + d : '')) }
}
const section = (s: string) => console.log('\n' + s)

const ROOT = path.resolve(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
const NOW = new Date('2026-08-29T12:00:00Z')

/** The overlay the page applies, resolved against this database exactly as the page resolves it. */
async function overlayFor(scope: (typeof RANKING_SCOPES)[number]) {
  const slug = SCOPE_SERIES_SLUG[scope]
  const series = slug
    ? await prisma.competitionSeries.findUnique({ where: { slug }, select: { id: true } })
    : null
  return scopeOverlay(scope, series ? series.id : null)
}

// -- Proof 4: exactly four scopes, independently derived
section('4. Four scopes, each derived from its own results')
{
  check('there are exactly four', RANKING_SCOPES.length === 4, RANKING_SCOPES.join(','))
  check('...and they are the four asked for',
    RANKING_SCOPES.join(',') === 'all,8brcam,wcc,tournaments')
  check('the default is All', DEFAULT_SCOPE === 'all')
  check('there is no fifth Yahoo scope', !(RANKING_SCOPES as readonly string[]).includes('yahoo'))

  for (const scope of RANKING_SCOPES) {
    const o = await overlayFor(scope)
    check(scope + ' is pinned to CueVerse', o.platform === 'CUEVERSE')
  }

  const all = await overlayFor('all')
  check('All narrows nothing but the platform',
    all.eventType === undefined && all.competitionSeriesId === undefined)

  const cam = await overlayFor('8brcam')
  check('8BRCAM is seasons in the 8BRCAM series',
    cam.eventType === 'seasons' && typeof cam.competitionSeriesId === 'number')

  const wcc = await overlayFor('wcc')
  check('WCC is seasons in the WCC series',
    wcc.eventType === 'seasons' && typeof wcc.competitionSeriesId === 'number')
  check('...and it is a different series from 8BRCAM', wcc.competitionSeriesId !== cam.competitionSeriesId)

  const cups = await overlayFor('tournaments')
  check('Tournaments is every tournament, with no series narrowing',
    cups.eventType === 'cups' && cups.competitionSeriesId === undefined)

  /*
   * A series slug that does not exist must yield an EMPTY scope, never an unfiltered one. An
   * unfiltered WCC tab would list every player on the site under a heading saying they had played in
   * the WCC, which is the most damaging possible failure of a filter.
   */
  check('a series that does not exist yields a filter matching nothing, not no filter at all',
    scopeOverlay('wcc', null).competitionSeriesId === -1)
}

// -- Proof 5: team and individual tournaments are one scope
section('5. Tournaments is one ladder, whatever the format')
{
  const cups = await overlayFor('tournaments')
  check('the scope does not split by entrant type',
    !Object.prototype.hasOwnProperty.call(cups, 'entrantType'))
  check('...and does not narrow to a single tournament', !('tournamentId' in cups))

  const src = read('src/lib/stats/rankings-scope.ts')
  check('the definition says so out loud', SCOPE_DEFINITIONS.tournaments.blurb.includes('team'))
  check('there is no second tournament scope', !src.includes("'teams'") && !src.includes("'2v2'"))

  /* Every tournament on the platform is inside the scope, individual and team alike. */
  const tournaments = await prisma.tournament.findMany({
    where: { platform: 'CUEVERSE' }, select: { id: true, name: true },
  })
  console.log('  (current CueVerse tournaments in the database: ' + tournaments.length + ')')
  check('no tournament is excluded by the scope definition', cups.competitionSeriesId === undefined)
}

// -- Proof 3: Yahoo never reaches the current rankings
section('3. No archive result reaches any scope')
{
  const counts: Record<string, number> = {}
  for (const scope of RANKING_SCOPES) {
    const o = await overlayFor(scope)
    const state = { ...defaultState(NOW), scope }
    const rows = await computeExplorer('all-time', 'overall', { ...aggregateFilters(state, NOW), ...o })
    counts[scope] = rows.length

    const yahooOnly = await prisma.ratingLedger.findMany({
      where: { platform: 'YAHOO' }, select: { playerId: true }, distinct: ['playerId'],
    })
    const archive = new Set(yahooOnly.map((p) => p.playerId))
    const cueverse = await prisma.ratingLedger.findMany({
      where: { platform: 'CUEVERSE' }, select: { playerId: true }, distinct: ['playerId'],
    })
    const current = new Set(cueverse.map((p) => p.playerId))
    const leaked = rows.filter((r) => archive.has(r.playerId) && !current.has(r.playerId))
    check(scope + ' contains no archive-only player', leaked.length === 0,
      leaked.slice(0, 3).map((r) => r.label).join(', '))
  }
  console.log('  (scope row counts: ' + RANKING_SCOPES.map((s) => s + '=' + counts[s]).join(', ') + ')')

  /*
   * The fallback that made this necessary. It read "if CueVerse has no rated matches, show Yahoo",
   * which is how forty-eight archived seasons ended up being the site's default ranking table.
   */
  const page = read('src/app/(frontend)/rankings/page.tsx')
  check('the Yahoo fallback is gone from the page', !page.includes("platform: 'YAHOO'"))
  check('...and the page no longer reads a platform from the URL', !page.includes("params.has('platform')"))
  check('the state decoder pins CueVerse whatever the URL says',
    decodeRankingsState('platform=yahoo', NOW).platform === 'CUEVERSE')
  check('...and an old ?platform=yahoo bookmark is treated as obsolete',
    (OBSOLETE_PARAMS as readonly string[]).includes('platform'))
  check('...and re-encoding it drops the parameter',
    !encodeRankingsState(decodeRankingsState('platform=yahoo', NOW), NOW).includes('platform'))

  const explorer = read('src/components/rankings/rankings-explorer.tsx')
  check('the Platform control is gone from the filter bar', !explorer.includes('Yahoo Archive'))
}

// -- Proof 6: an empty scope says what it is waiting for
section('6. An empty scope explains itself')
{
  for (const scope of RANKING_SCOPES) {
    const def = SCOPE_DEFINITIONS[scope]
    check(scope + ' has empty-state copy', def.emptyTitle.length > 0 && def.emptyBody.length > 0)
  }
  check('All says what has to be finalized first',
    SCOPE_DEFINITIONS.all.emptyBody ===
    'Current CueVerse rankings will appear after the first eligible competition is finalized.')
  check('8BRCAM names the season it is waiting on',
    SCOPE_DEFINITIONS['8brcam'].emptyBody ===
    'Rankings will appear once CueVerse 8BRCAM Season 1 is verified and formally finalized in the Registry.')
  check('WCC says it has not started',
    SCOPE_DEFINITIONS.wcc.emptyBody ===
    'WCC Season 1 is starting soon. Rankings will appear after its first completed season.')
  check('Tournaments says what has to finish first',
    SCOPE_DEFINITIONS.tournaments.emptyBody ===
    'Tournament rankings will appear after the first eligible tournament is finalized.')

  /* Each is written for its own scope; a shared line would read as a fault rather than a state. */
  const bodies = RANKING_SCOPES.map((s) => SCOPE_DEFINITIONS[s].emptyBody)
  check('no two scopes share the same explanation', new Set(bodies).size === bodies.length)

  const wccOverlay = await overlayFor('wcc')
  const wccRows = await computeExplorer('all-time', 'overall',
    { ...aggregateFilters({ ...defaultState(NOW), scope: 'wcc' }, NOW), ...wccOverlay })
  const wccSeasons = await prisma.season.count({
    where: { platform: 'CUEVERSE', competitionSeries: { slug: 'wcc' } },
  })
  check('WCC has no completed seasons, so its ladder is legitimately empty',
    wccSeasons === 0 ? wccRows.length === 0 : true,
    wccSeasons + ' WCC seasons, ' + wccRows.length + ' rows')

  const tabs = read('src/components/rankings/scope-tabs.tsx')
  check('the empty panel replaces the table rather than sitting above an empty one',
    tabs.includes('export function ScopeEmpty'))
  const explorer = read('src/components/rankings/rankings-explorer.tsx')
  check('...and the filter bar is withheld with it', explorer.includes('{rows.length > 0 && ('))
}

// -- Proofs 7 + 8: the scope is in the URL, so refresh, Back and Forward all reproduce it
section('7 + 8. The scope survives a link, a refresh and the Back button')
{
  for (const scope of RANKING_SCOPES) {
    check('?scope=' + scope + ' decodes to itself', decodeRankingsState('scope=' + scope, NOW).scope === scope)
    const round = decodeRankingsState(encodeRankingsState({ ...defaultState(NOW), scope }, NOW), NOW)
    check('...and survives an encode/decode round trip', round.scope === scope)
  }
  check('a bare URL is All', decodeRankingsState('', NOW).scope === 'all')
  check('...and All adds nothing to the URL',
    !encodeRankingsState({ ...defaultState(NOW), scope: 'all' }, NOW).includes('scope'))
  check('nonsense falls back to All rather than erroring', parseScope('archive') === 'all')
  check('an empty parameter falls back to All', parseScope('') === 'all')
  check('case does not matter', parseScope('WCC') === 'wcc')

  /* The scope must not silently drop the reader's other parameters. */
  const mixed = decodeRankingsState('scope=wcc&min=10&q=kev', NOW)
  check('other parameters survive alongside the scope',
    mixed.scope === 'wcc' && mixed.rowFilters.minMatches === 10 && mixed.rowFilters.search === 'kev')
  check('...and are written back out', encodeRankingsState(mixed, NOW).includes('scope=wcc'))
}

// -- Switching scope is a read
section('Switching scope reads; it never writes')
{
  const before = await prisma.ratingLedger.count()
  for (const scope of RANKING_SCOPES) {
    const o = await overlayFor(scope)
    await computeExplorer('all-time', 'overall',
      { ...aggregateFilters({ ...defaultState(NOW), scope }, NOW), ...o })
  }
  const after = await prisma.ratingLedger.count()
  check('the rating ledger is untouched by rendering every scope', before === after,
    before + ' -> ' + after)

  const scopeSrc = read('src/lib/stats/rankings-scope.ts')
  check('the scope module contains no write', !/prisma\.[a-zA-Z]+\.(create|update|delete|upsert)/.test(scopeSrc))
}

// -- The scope owns what it decides
section('A scope and a filter cannot contradict each other')
{
  check('All leaves the competition filters to the reader', !scopePinsCompetition('all'))
  for (const scope of ['8brcam', 'wcc', 'tournaments'] as const) {
    check(scope + ' decides them itself', scopePinsCompetition(scope))
  }
  const explorer = read('src/components/rankings/rankings-explorer.tsx')
  check('the filter bar hides the controls a scope has already decided',
    explorer.includes('!scopePinsCompetition(applied.scope)'))
  const drawer = read('src/components/rankings/filter-drawer.tsx')
  check('...and so does the drawer', drawer.includes('!scopePinsCompetition(draft.scope)'))
  check('changing scope abandons a selection made inside the previous one',
    explorer.includes('seasonId: null') && explorer.includes('tournamentId: null'))

  const exportRoute = read('src/app/(frontend)/rankings/export/route.ts')
  check('the CSV export applies the same overlay as the page', exportRoute.includes('scopeOverlay(state.scope'))
}

// -- Accessibility of the tab strip
section('The scope strip is a real tab list')
{
  const tabs = read('src/components/rankings/scope-tabs.tsx')
  check('it is a tablist', tabs.includes('role="tablist"') && tabs.includes('aria-label="Ranking scope"'))
  check('each tab reports whether it is selected', tabs.includes('aria-selected={on}'))
  check('each tab points at the panel it controls', tabs.includes('aria-controls="rk-scope-panel"'))
  check('roving tabindex gives the strip one tab stop', tabs.includes('tabIndex={on ? 0 : -1}'))
  check('arrow keys move between tabs', tabs.includes('ArrowRight') && tabs.includes('ArrowLeft'))
  check('Home and End jump to the ends', tabs.includes("'Home'") && tabs.includes("'End'"))
  const explorer = read('src/components/rankings/rankings-explorer.tsx')
  check('the panel exists and is labelled by its tab',
    explorer.includes('id="rk-scope-panel"') && explorer.includes('role="tabpanel"'))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
await prisma.$disconnect()
process.exit(fail ? 1 : 0)
