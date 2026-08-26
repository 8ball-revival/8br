/**
 * The rebuilt homepage, asserted against real rendered markup.
 *
 * ── Why this file was rewritten rather than edited ───────────────────────────────────────────────
 * It tested five components that no longer exist: Top10Panel, NewsPanel, CompetitionCenter,
 * RecentResultsCard and ByTheNumbers. The homepage was rebuilt from the ground up, so those
 * assertions were not "failing" — they were describing a page that had been deleted. Keeping them
 * limping along against replacement components would have preserved the file and lost the point of
 * it.
 *
 * What is worth keeping is the SHAPE of the old file: render the real components with real data
 * shapes and assert what reaches a browser, rather than reading the source and hoping. Every check
 * here is against `renderToStaticMarkup` output — the bytes the server sends.
 *
 * ── What it protects ─────────────────────────────────────────────────────────────────────────────
 * The three things this page can silently get wrong: showing an identity the wrong way round,
 * printing a score for a match nobody played, and claiming a trend nothing measured.
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { CompetitionHistory } from '../src/components/home/competition-history.tsx'
import { SeasonResults } from '../src/components/home/season-results.tsx'
import { Top10Table } from '../src/components/home/top10-table.tsx'
import { ArchiveNotice } from '../src/components/home/archive-notice.tsx'
import type { SeasonResultRow } from '../src/lib/home/season-results.ts'
import type { LeaderRow } from '../src/lib/home/leaderboard.ts'
import type { HomeNews, HomeArticle } from '../src/lib/home/news.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

const render = (el: React.ReactElement) => renderToStaticMarkup(el)

/* ─────────────────────────────────────────────────────────────────────────── fixtures ─────────── */

const article = (id: number, title: string, days: number): HomeArticle => ({
  id,
  slug: `article-${id}`,
  title,
  excerpt: 'An excerpt.',
  publishAt: new Date(Date.UTC(2026, 0, 1 + days)),
  categoryName: 'Reports',
  categorySlug: 'reports',
  author: 'Someone',
  readingMinutes: 4,
  commentCount: 0,
  coverMediaId: null,
  coverAlt: null,
})

const news: HomeNews = {
  featured: article(1, 'The featured piece', 3),
  latest: article(2, 'The newest piece', 2),
  second: article(3, 'The one before that', 1),
} as HomeNews

const seasonRow = (over: Partial<SeasonResultRow> = {}): SeasonResultRow => ({
  seasonId: 1,
  label: '2013 · Season 5',
  year: 2013,
  number: 5,
  event: '8BRCAM',
  winnerHandle: 'MJ_The_King',
  winnerName: 'MJ',
  runnerUpHandle: 'easyrun',
  runnerUpName: 'Sid',
  finalScore: '9–4',
  finalsForfeit: false,
  href: '/seasons/1',
  ...over,
})

const leaderRow = (over: Partial<LeaderRow> = {}): LeaderRow => ({
  rank: 1,
  playerId: 'p1',
  cueverseId: 'deep.cerebro',
  preferredName: 'Luis',
  slug: 'deep.cerebro',
  wins: 144,
  losses: 22,
  winPct: 83.2,
  rating: 2070,
  streak: 0,
  titles: 6,
  ...over,
})

/* ──────────────────────────────────────────────────────────────────── Competition History ─────── */

section('Competition History replaces the banner')
{
  const html = render(React.createElement(CompetitionHistory, { news }))
  check('the statement is the page heading', /<h1[^>]*>Competition<br\/>History<\/h1>/.test(html)
    || (html.includes('<h1') && html.includes('Competition') && html.includes('History')))
  check('it carries the primary call to action', html.includes('href="/rankings"') && /Rankings<\/a>/.test(html))
  check('no image is used for the identity', !html.includes('<img'),
    'the panel is type, not a photographic banner')

  check('the three latest items are listed', (html.match(/href="\/the-break\//g) ?? []).length === 3)
  check('...newest first', html.indexOf('The newest piece') < html.indexOf('The one before that'))
  // renderToStaticMarkup emits the prop as camelCase `dateTime`, not the lowercase `datetime` a
  // browser reports, so the match is case-insensitive rather than assuming one of the two.
  check('...and each carries a machine-readable date', (html.match(/<time [^>]*dateTime=/gi) ?? []).length === 3)

  /*
   * The featured article rotates hourly and can be one of the two newest. When it is, it must not
   * appear twice — the same headline listed under itself reads as a rendering fault.
   */
  const dup: HomeNews = { featured: news.latest, latest: news.latest, second: news.second } as HomeNews
  const dupHtml = render(React.createElement(CompetitionHistory, { news: dup }))
  check('a featured article that is also the newest is not listed twice',
    (dupHtml.match(/The newest piece/g) ?? []).length === 1)

  const empty = render(React.createElement(CompetitionHistory, { news: { featured: null, latest: null, second: null } as HomeNews }))
  check('with nothing published it says so rather than rendering an empty list',
    empty.includes('Nothing published yet'))
}

/* ───────────────────────────────────────────────────────────────────────── Season Results ─────── */

section('Season Results shows titles, and never invents a score')
{
  const html = render(React.createElement(SeasonResults, { rows: [seasonRow()] }))
  check('the season is identified by year and number', html.includes('2013 · Season 5'))
  check('the competition is named', html.includes('8BRCAM'))
  check('the recorded score is shown', html.includes('9–4'))

  /*
   * The identity rule, in a tight cell: the handle leads and the preferred name follows. Asserted by
   * POSITION, because both strings being present is true whichever way round they render.
   */
  check('the winner leads with the CueVerse ID',
    html.indexOf('MJ_The_King') < html.indexOf('>MJ<'),
    'handle must precede preferred name')

  const ff = render(React.createElement(SeasonResults, {
    rows: [seasonRow({ finalScore: '9–0', finalsForfeit: true })],
  }))
  check('a forfeited final shows FF', ff.includes('>FF<'))
  check('...and prints no numeric score, even though one is stored', !ff.includes('9–0'),
    'a match nobody played must not display a scoreline')

  const none = render(React.createElement(SeasonResults, { rows: [] }))
  check('an empty archive explains itself', none.includes('No Season has been completed yet'))
}

/* ──────────────────────────────────────────────────────────────────────── Rankings Top 10 ─────── */

section('The Top 10 is a dense table with honest columns')
{
  const html = render(React.createElement(Top10Table, { rows: [leaderRow()], platform: 'YAHOO' as const }))
  check('it renders a real table', html.includes('<table'))
  check('the columns are the leaderboard ones',
    ['Wins', 'Losses', 'Win %', 'Rating'].every((c) => html.includes(`>${c}<`)))

  /*
   * The column is headed Form, not Trend. Nothing records a previous-period standing, so a movement
   * arrow would be invented; a streak is measured, and the heading says which of the two this is.
   */
  check('the last column is Form rather than Trend', html.includes('>Form<') && !html.includes('>Trend<'))

  check('the ladder being shown is named', html.includes('Yahoo Archive'))
  check('the identity leads with the CueVerse ID',
    html.indexOf('deep.cerebro') < html.indexOf('>Luis<'))
  check('the accessible name says which half is the handle',
    html.includes('CueVerse ID deep.cerebro'))

  const flat = render(React.createElement(Top10Table, { rows: [leaderRow({ streak: 2 })], platform: 'YAHOO' as const }))
  check('a run of two is not reported as form', flat.includes('no current run'))
  const hot = render(React.createElement(Top10Table, { rows: [leaderRow({ streak: 7 })], platform: 'YAHOO' as const }))
  check('a run of seven is', hot.includes('winning run of 7'))
  check('...and carries a letter as well as a colour', hot.includes('W7'),
    'direction must survive for a reader who cannot separate green from red')

  const cold = render(React.createElement(Top10Table, { rows: [leaderRow({ streak: -4 })], platform: 'YAHOO' as const }))
  check('a losing run is reported as one', cold.includes('losing run of 4') && cold.includes('L4'))
}

/* ─────────────────────────────────────────────────────────────────────────── Archive notice ───── */

section('The archive notice says what it says, and leads somewhere')
{
  const html = render(React.createElement(ArchiveNotice))
  check('the notice admits the archive was entered by hand',
    html.includes('recreated by hand') && html.includes('mistakes can and probably did'))
  check('it invites a report', html.includes('Found a mistake?'))
  check('Submit ticket is a real link', /href="\/contact"[^>]*>[\s\S]{0,80}Submit ticket/.test(html))
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
