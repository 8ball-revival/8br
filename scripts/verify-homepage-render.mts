/**
 * Homepage components, asserted against real rendered markup.
 *
 * Complements verify-homepage.mts, which exercises the data services. This checks what actually
 * reaches a browser: the dropdown's structure and labelling, the ranking accents, the tie wording,
 * the external-link safety attributes, the image surfaces, and the carousel's controls.
 *
 * Rendered with renderToStaticMarkup, so these are the bytes the server sends.
 *
 * Run:  node scripts/run-with-esm.mjs npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-homepage-render.mts
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'

import { Top10Panel } from '../src/components/home/top10-panel.tsx'
import { NewsPanel } from '../src/components/home/news-panel.tsx'
import { CueVersePromoCard, CueVerseTop5Card } from '../src/components/home/cueverse-cards.tsx'
import { RecentResultsCard } from '../src/components/home/recent-results.tsx'
import { ByTheNumbers } from '../src/components/home/by-the-numbers.tsx'
import type { Top10Option, Top10Result } from '../src/lib/home/top10.ts'
import type { HomeArticle } from '../src/lib/home/news.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const STUB_ROUTER: any = {
  push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {},
}

/** Render inside the app-router context the client components expect. */
const render = (node: React.ReactElement): string =>
  renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: STUB_ROUTER }, node))

const OPTIONS: Top10Option[] = [
  { value: 'all-competitions', label: 'All Competitions', group: 'Overall' },
  { value: 'current-ladder', label: 'Current Ladder', group: 'Overall' },
  { value: 'season-championships', label: 'Season Championships', group: 'Championship Type' },
  { value: 'tournament-championships', label: 'Tournament Championships', group: 'Championship Type' },
  { value: 'competition:1', label: '8BRCAM Only', group: 'By Competition' },
  { value: 'competition:390', label: '8BR Retro Only', group: 'By Competition' },
]

const article = (id: number, over: Partial<HomeArticle> = {}): HomeArticle => ({
  id,
  slug: `article-${id}`,
  title: `Article ${id} headline`,
  excerpt: 'A short deck for the fixture article.',
  publishAt: new Date('2026-08-01T12:00:00Z'),
  categoryName: 'Analysis',
  categorySlug: 'analysis',
  author: 'sixohtwo',
  readingMinutes: 4,
  commentCount: 3,
  coverMediaId: null,
  coverAlt: null,
  ...over,
})

// =========================================================================== Top 10
section('Top 10 panel')

{
  const result: Top10Result = {
    mode: 'season-championships',
    metricLabel: 'Season titles',
    href: '/seasons',
    rows: [
      { rank: 1, playerId: 'p1', name: 'Luis', handle: 'xlx_cerebro_xlx', slug: 'xlx_cerebro_xlx', value: '4', tied: false },
      { rank: 2, playerId: 'p2', name: 'James', handle: 'jamesq', slug: 'jamesq', value: '3', tied: false },
      { rank: 3, playerId: 'p3', name: 'Chris', handle: 'chris_c', slug: 'chris_c', value: '2', tied: false },
      { rank: 4, playerId: 'p4', name: 'Kevin', handle: 'sixohtwo', slug: 'sixohtwo', value: '2', tied: true },
      { rank: 5, playerId: null, name: 'indianhacker', handle: null, slug: null, value: '1', tied: false },
    ],
  }
  const html = render(React.createElement(Top10Panel, { options: OPTIONS, initial: result }))

  check('the public title is the full brand name', html.includes('8 Ball Registry Top 10'))
  check('the title never abbreviates the brand', !/>\s*8BR\s+Top 10/.test(html))
  check('the dropdown has an accessible label', html.includes('for="top10-mode"'))
  check('the dropdown groups Overall options', html.includes('label="Overall"'))
  check('...Championship Type', html.includes('label="Championship Type"'))
  check('...and By Competition', html.includes('label="By Competition"'))
  check('every competition appears as "<name> Only"', html.includes('8BRCAM Only') && html.includes('8BR Retro Only'))
  check('the subtitle names the current mode and metric',
    html.includes('Season Championships') && html.includes('Season titles'))

  check('preferred name is the primary line', html.includes('Luis'))
  check('the CueVerse ID is the secondary line', html.includes('xlx_cerebro_xlx'))
  check('a player with no preferred name shows their handle alone', html.includes('indianhacker'))
  check('first place carries a gold accent', html.includes('text-brand') && html.includes('bg-brand/15'))
  check('second place carries a silver accent', html.includes('#c8ccd4'))
  check('third place carries a bronze accent', html.includes('#c49a63'))
  check('a tie is stated in words, not only by an equal number', html.includes('tied'))
  check('exactly one tie label is rendered for the one tied row',
    (html.match(/>tied</g) ?? []).length === 1, String((html.match(/>tied</g) ?? []).length))
  check('the panel links to the full rankings', html.includes('View full rankings'))
  check('...at the destination for this mode', html.includes('href="/seasons"'))
  check('players link to their profile', html.includes('/players/xlx_cerebro_xlx'))
  check('the metric is tabular so digits line up', html.includes('tabular-nums'))
}
{
  const unavailable: Top10Result = {
    mode: 'all-competitions',
    metricLabel: 'Historical score',
    href: '/rankings',
    rows: [],
    unavailable: 'This ranking needs the official historical scoring formula, which does not exist yet.',
  }
  const html = render(React.createElement(Top10Panel, { options: OPTIONS, initial: unavailable }))
  check('an unavailable mode explains itself', html.includes('Not available yet'))
  check('...and says what is missing', html.includes('historical scoring formula'))
  check('...and shows no substituted ranking rows', !html.includes('<ol'))
}
{
  const empty: Top10Result = { mode: 'tournament-championships', metricLabel: 'Tournament titles', href: '/tournaments', rows: [] }
  const html = render(React.createElement(Top10Panel, { options: OPTIONS, initial: empty }))
  check('a mode with no data says so truthfully', html.includes('No completed competitions'))
  check('...and invents no players', !html.includes('<li'))
}

// =========================================================================== News
section('News panel')

{
  const html = render(React.createElement(NewsPanel, {
    featured: article(1), latest: article(2), second: article(3),
  }))
  check('the kicker reads THE BREAK', /The Break/.test(html))
  check('the heading is News', html.includes('>News<'))
  check('the description is present', html.includes('News, predictions, analysis and community stories.'))
  check('there is an all-articles link', html.includes('All articles') && html.includes('href="/news"'))
  check('all three articles are linked', ['article-1', 'article-2', 'article-3'].every((s) => html.includes(`/news/${s}`)))
  check('each card is a single link, not a link containing a button', !/<a[^>]*>[\s\S]{0,4000}?<button/.test(html))
  check('cards have a visible focus ring', html.includes('focus-visible:ring-brand'))
  check('the byline is shown', html.includes('sixohtwo'))
  check('the category is shown', html.includes('Analysis'))
  check('reading time appears on the feature', html.includes('4 min'))
  check('the comment count appears', html.includes('>3<'))
}
{
  // Every position must show an image surface, cover or not.
  const withCover = render(React.createElement(NewsPanel, {
    featured: article(1, { coverMediaId: 'shot.jpg', coverAlt: 'The break shot' }),
    latest: article(2), second: article(3),
  }))
  check('a cover image is used when present', withCover.includes('/api/media/file/shot.jpg'))
  check('...with its alt text', withCover.includes('alt="The break shot"'))
  // React emits this attribute camel-cased, which is what the DOM property is called.
  check('the lead image is eager and high priority',
    withCover.includes('loading="eager"') && withCover.includes('fetchPriority="high"'))

  const noCover = render(React.createElement(NewsPanel, {
    featured: article(1), latest: article(2), second: article(3),
  }))
  check('an article with no cover still gets an image surface', noCover.includes('bg-gradient-to-br'))
  check('...and never a broken image element', !/<img[^>]*src=""/.test(noCover))
  check('the fallback is marked decorative', noCover.includes('aria-hidden'))

  const mixed = render(React.createElement(NewsPanel, {
    featured: article(1, { coverMediaId: 'a.jpg' }),
    latest: article(2, { coverMediaId: 'b.jpg' }),
    second: article(3),
  }))
  check('secondary images are lazy-loaded', mixed.includes('loading="lazy"'))
}
{
  const empty = render(React.createElement(NewsPanel, { featured: null, latest: null, second: null }))
  check('an empty position shows a neutral placeholder', empty.includes('More to come'))
  check('...and fabricates no headline', !empty.includes('headline'))
  check('...while keeping an image surface so the layout holds', empty.includes('bg-gradient-to-br'))
}

// =========================================================================== CueVerse
section('CueVerse cards')

{
  const html = render(React.createElement(CueVersePromoCard))
  check('the card links to cueverse.gg', html.includes('href="https://cueverse.gg/"'))
  check('it opens in a new tab', html.includes('target="_blank"'))
  check('...safely', html.includes('rel="noopener noreferrer"'))
  check('the official logo is served locally', html.includes('/assets/cueverse/cueverse-'))
  check('...and not hotlinked from cueverse.gg', !html.includes('cueverse.gg/brand/'))
  check('the wordmark carries the brand name as alt text', html.includes('alt="CueVerse"'))
  check('the label copy is present', html.includes('Free online multiplayer pool'))
  check('the heading copy is present', html.includes('Play 8 Ball Pool Online Free'))
  check('the supporting copy is present', html.includes('Real-time multiplayer 8-ball and 9-ball pool'))
  check('the call to action is present', html.includes('Continue Playing'))
  check('an external destination is announced to screen readers', html.includes('opens cueverse.gg in a new tab'))
  check('the card uses CueVerse navy, not registry gold', html.includes('#0a1628'))
  check('...with a teal accent', html.includes('#2fd4c7'))
  check('it has a visible focus state', html.includes('focus-visible:ring-'))
  check('image dimensions are given so nothing shifts', html.includes('width="399"') && html.includes('height="268"'))
}
{
  const snapshot = {
    fetchedAt: '2026-08-18T10:00:00.000Z',
    sourceUpdatedAt: null,
    playersOnline: 8,
    tablesActive: 2,
    stale: false,
    ageHours: 2,
    entries: [
      { rank: 1, name: 'Crazy_One', rating: 2535, wins: 154, losses: 8, provisional: false },
      { rank: 2, name: 'Stu', rating: 2116, wins: 920, losses: 509, provisional: false },
      { rank: 3, name: 'Clutch-P', rating: 2037, wins: 180, losses: 123, provisional: false },
      { rank: 4, name: 'fsm_brian', rating: 2027, wins: 288, losses: 58, provisional: false },
      { rank: 5, name: 'Starkiller', rating: 1961, wins: 595, losses: 249, provisional: false },
    ],
  }
  const html = render(React.createElement(CueVerseTop5Card, { snapshot }))
  check('the title is CUEVERSE TOP 5', html.includes('CueVerse Top 5'))
  check('the subtitle says these are in-game ratings', html.includes('Current in-game ratings'))
  check('the update time is shown', html.includes('Updated'))
  check('all five rows render', snapshot.entries.every((e) => html.includes(e.name)))
  check('ratings are shown', html.includes('2535'))
  check('the secondary statistic is shown', html.includes('154') && html.includes('920'))
  check('the leaderboard link points at the CueVerse leaderboard', html.includes('https://cueverse.gg/#leaderboard'))
  check('...opening safely in a new tab', html.includes('rel="noopener noreferrer"'))
  check('no stale warning on a fresh snapshot', !html.includes('Last successful update'))
  check('the card is visually distinct from the registry ranking', html.includes('#0a1628'))
}
{
  const stale = render(React.createElement(CueVerseTop5Card, {
    snapshot: {
      fetchedAt: '2026-08-10T10:00:00.000Z', sourceUpdatedAt: null, playersOnline: null, tablesActive: null,
      stale: true, ageHours: 100,
      entries: [{ rank: 1, name: 'Crazy_One', rating: 2535, wins: null, losses: null, provisional: false }],
    },
  }))
  check('a stale snapshot is flagged', stale.includes('Last successful update'))
  check('...and still shows the data it has', stale.includes('Crazy_One'))
  check('a row without a record omits it rather than inventing one', !stale.includes('null'))
}
{
  const none = render(React.createElement(CueVerseTop5Card, { snapshot: null }))
  check('with no snapshot the card says it is unavailable', none.includes('unavailable right now'))
  check('...invents no players', !none.includes('<ol'))
  check('...and keeps the direct leaderboard link', none.includes('https://cueverse.gg/#leaderboard'))
}

// =========================================================================== Recent Results
section('Recent Results')

{
  const html = render(React.createElement(RecentResultsCard, {
    results: [
      {
        key: 'season_playoff:1', competitionName: '8BRCAM Season 1', competitionType: 'Season',
        stageLabel: 'Final', href: '/seasons/443', iconMediaId: null, initials: '8B',
        homeName: 'Luis', awayName: 'indianhacker', homeGames: 9, awayGames: 0,
        isForfeit: false, completedAt: '2026-08-17T19:39:21.284Z',
      },
      {
        key: 'season_group:2', competitionName: '8BRCAM Season 1', competitionType: 'Season',
        stageLabel: 'Group stage', href: '/seasons/443', iconMediaId: null, initials: '8B',
        homeName: 'Tyler', awayName: 'Chris', homeGames: 7, awayGames: 3,
        isForfeit: true, completedAt: '2026-08-16T10:00:00.000Z',
      },
    ],
  }))
  check('the title is RECENT RESULTS', html.includes('Recent Results'))
  check('the competition name is shown', html.includes('8BRCAM Season 1'))
  check('the stage is shown', html.includes('Final') && html.includes('Group stage'))
  check('both players are named', html.includes('Luis') && html.includes('indianhacker'))
  check('a played score is shown', html.includes('9–0'))
  check('a forfeit is labelled as a forfeit', html.includes('forfeit'))
  check('...and shows no invented scoreline', !html.includes('7–3'))
  check('the completion date is shown', html.includes('Aug 17, 2026'))
  check('each result links to its competition', html.includes('href="/seasons/443"'))
  check('a competition without an icon falls back to initials', html.includes('>8B<'))
  check('there is a view-all link', html.includes('View all results'))
}
{
  const empty = render(React.createElement(RecentResultsCard, { results: [] }))
  check('an empty state is truthful', empty.includes('No completed matches yet'))
  check('...and invents no results', !empty.includes('<ol'))
}

// =========================================================================== By the Numbers
section('By the Numbers and On This Day')

const STATS = {
  yearsOfHistory: 22, since: 2005, seasons: 1, matchesPlayed: 95,
  players: 33, champions: 1, countries: 8, gamesPlayed: 911,
}

{
  const html = render(React.createElement(ByTheNumbers, { stats: STATS, events: [] }))
  check('the heading uses the full brand name', html.includes('8 Ball Registry by the Numbers'))
  check('the heading is small gold uppercase, not an oversized white heading',
    html.includes('uppercase tracking-[0.2em] text-brand') && !html.includes('text-4xl'))
  for (const label of ['Years of History', 'Seasons', 'Matches Played', 'Players', 'Champions', 'Countries', 'Games Played']) {
    check(`the ${label} card is present`, html.includes(label))
  }
  check('Countries shows the fixed 8', html.includes('>8<'))
  check('the since line is present', html.includes('Since 2005'))
  check('large numbers carry group separators', html.includes('911'))
  check('each card has a circular gold icon background', html.includes('rounded-full bg-brand/10'))
  check('the row can scroll rather than compress', html.includes('overflow-x-auto'))
  check('On This Day spans two columns on a phone', html.includes('col-span-2'))
}
{
  const events = [
    {
      id: 'title:season:443', date: '2019-08-18T19:39:21.000Z', year: 2019, kind: 'championship' as const,
      homeInitials: 'LU', awayInitials: 'IN',
      description: 'Luis won 8BRCAM Season 1, beating indianhacker 9-0', context: '8BRCAM Season 1',
      href: '/seasons/443',
    },
    {
      id: 'match:season_group:7', date: '2018-08-18T10:00:00.000Z', year: 2018, kind: 'match' as const,
      homeInitials: 'TY', awayInitials: 'CH',
      description: 'Tyler beat Chris 7–3', context: '8BRCAM Season 1', href: '/seasons/443',
    },
  ]
  const html = render(React.createElement(ByTheNumbers, { stats: STATS, events }))
  check('the On This Day heading is present', html.includes('On This Day'))
  check('the original date is shown', html.includes('Aug 18, 2019'))
  check('the description is shown', html.includes('Luis won 8BRCAM Season 1'))
  check('a championship gets its own marker', html.includes('bg-brand/15'))
  check('carousel controls are labelled', html.includes('aria-label="Previous event"') && html.includes('aria-label="Next event"'))
  check('carousel indicators are real buttons, keyboard reachable',
    (html.match(/aria-label="Show event \d+ of \d+"/g) ?? []).length === events.length)
  check('the showing indicator is marked', html.includes('aria-current="true"'))
  check('the event region announces changes politely', html.includes('aria-live="polite"'))
  check('the card has a fixed minimum height so it cannot jump', html.includes('min-h-['))
  check('the description is clamped rather than allowed to grow the card', html.includes('line-clamp-3'))
  check('controls have visible focus states', html.includes('focus-visible:ring-brand'))
}
{
  const html = render(React.createElement(ByTheNumbers, { stats: STATS, events: [] }))
  check('with no event the card says so truthfully', html.includes('Nothing has happened on this date yet'))
  check('...and shows no carousel controls', !html.includes('aria-label="Next event"'))
  check('...and fabricates no historical event', !html.includes('beat'))
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
