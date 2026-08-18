/**
 * Hit every public editorial route against a running dev server and report what came back.
 *
 * Run:  node scripts/check-editorial-routes.mjs
 *
 * Complements the verify suites rather than repeating them: those exercise the service layer
 * directly, this one proves the ROUTES exist, resolve, and hide what they should. It needs the
 * dev server up, and it expects the demo articles to be absent — the content-specific rows are
 * skipped automatically when nothing is published.
 *
 * Two kinds of expectation:
 *
 *  - `ok`        the route serves its own page.
 *  - `notfound`  the route serves the site's not-found page.
 *
 * Note on status codes: every route in this application that calls `notFound()` currently answers
 * 200 and renders the custom not-found page — Seasons, Players and Tournaments behave the same way,
 * so this is app-wide and predates The Break. These checks therefore assert what a visitor SEES,
 * and the status-code question is reported separately rather than being silently changed here.
 */
const BASE = 'http://localhost:3000'

/**
 * Is this the not-found response?
 *
 * Checked on the document title rather than the body. The not-found component ships in the flight
 * payload of every page in the route group, so its text appears in HTML that rendered perfectly
 * well; and depending on when a route calls notFound(), the page itself arrives either as
 * server-rendered HTML or as a client-side render of the same component. The title is the one
 * signal that is both present and correct in every case — and asserting it doubles as a check that
 * a missing or unpublished article never leaks its real title into a browser tab.
 */
const titleOf = (html) => (html.match(/<title>([^<]*)<\/title>/) || [])[1] ?? ''
const notFoundShown = (html) => titleOf(html).startsWith('Not found')

const routes = [
  ['/news', 'ok'],
  ['/news?q=bracket', 'ok'],
  ['/news?q=nothing-matches-this-at-all', 'ok'],
  ['/news/season-1-playoffs-the-bracket-the-seeds-and-the-shape-of-the-draw', 'ok'],
  ['/news/registration-for-the-next-season-opens-on-monday', 'ok'],
  ['/news/category/predictions', 'ok'],
  ['/news/category/official-news', 'ok'],
  ['/news/category/no-such-category', 'notfound'],
  ['/news/tag/zzsmoke-playoffs', 'ok'],
  ['/news/tag/no-such-tag', 'notfound'],
  ['/news/author/zzsmoke_writer', 'ok'],
  ['/news/author/nobody-at-all', 'notfound'],
  ['/news/authors', 'ok'],
  ['/news/archive', 'ok'],
  ['/news/archive/2026', 'ok'],
  ['/news/archive/2026/08', 'ok'],
  ['/news/archive/9999', 'notfound'],
  ['/news/archive/2026/13', 'notfound'],
  ['/news/feed.xml', 'ok'],
  ['/news/atom.xml', 'ok'],
  ['/news/no-such-article', 'notfound'],
  ['/news/preview', 'notfound'],
  ['/news/preview?token=forged.1.2', 'notfound'],
  ['/news/new', 'ok'],
  ['/news/mine', 'ok'],
  ['/staff/news', 'ok'],
  ['/sitemap.xml', 'ok'],
  ['/', 'ok'],
]

let failures = 0
const report = (ok, label) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`)
}

// Routes that only exist while the demo articles are present.
const CONTENT_ROUTES = [
  '/news/season-1-playoffs-the-bracket-the-seeds-and-the-shape-of-the-draw',
  '/news/registration-for-the-next-season-opens-on-monday',
  '/news/tag/zzsmoke-playoffs',
  '/news/author/zzsmoke_writer',
  '/news/archive/2026',
  '/news/archive/2026/08',
]
const hasContent = (await (await fetch(`${BASE}/news`)).text()).includes('No articles have been published') === false

for (const [path, expected] of routes) {
  if (!hasContent && CONTENT_ROUTES.includes(path)) { console.log(`skip      ${path} (no published articles)`); continue }
  const res = await fetch(`${BASE}${path}`, { redirect: 'follow' })
  const body = await res.text()
  const isNotFound = notFoundShown(body)
  const ok = expected === 'notfound' ? isNotFound : res.status < 400 && !isNotFound
  report(ok, `${String(res.status).padEnd(4)} ${path}${ok ? '' : `  (expected ${expected})`}`)
}

// Administrator-only, and it denies its own existence to everybody else.
const exportRes = await fetch(`${BASE}/api/news/export`)
report(exportRes.status === 404, `${exportRes.status}  /api/news/export is hidden from a visitor`)

// The sitemap lists published articles.
const sitemap = await (await fetch(`${BASE}/sitemap.xml`)).text()
report(sitemap.includes('/news'), '     sitemap lists the News section')

// A malformed view-count request is rejected rather than counted.
const badView = await fetch(`${BASE}/api/news/view`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ articleId: 'nope' }),
})
report(badView.status === 400, `${badView.status}  POST /api/news/view rejects a bad id`)

// An unpublished article must be indistinguishable from one that does not exist.
const draftProbe = await fetch(`${BASE}/news/a-draft-nobody-published`)
report(notFoundShown(await draftProbe.text()), '     an unknown article shows the not-found page')

const total = routes.length + 4 - (hasContent ? 0 : CONTENT_ROUTES.length)
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${total - failures}/${total} route checks`)
process.exit(failures === 0 ? 0 : 1)
