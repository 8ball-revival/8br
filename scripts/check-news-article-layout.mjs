/**
 * The News article frame, checked against the running dev server.
 *
 * Complements verify-news-article.mts, which renders components in isolation. This one asks the real
 * route for real HTML, so it catches the things only the assembled page can get wrong: the container
 * not matching the navigation, the grid never being applied, or the media column landing in the wrong
 * place in the document.
 *
 * DOM order is the point of the order assertions. The stacked mobile layout has no grid to reposition
 * anything, so the order elements appear in the document IS the order a phone shows them — header,
 * then the image preview, then the article body.
 *
 * Usage: node scripts/check-news-article-layout.mjs [slug]
 */

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const slug = process.argv[2] ?? 'a-tribute-to-major-league-pool'

let passed = 0
let failed = 0
const check = (name, ok, detail = '') => {
  if (ok) passed += 1
  else { failed += 1; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

const res = await fetch(`${BASE}/news/${slug}`).catch(() => null)
if (!res || !res.ok) {
  console.log(`Could not reach ${BASE}/news/${slug} — is the dev server running?`)
  process.exit(1)
}
const fullHtml = await res.text()

/*
  Scope every order assertion to the article element itself.

  The full response also carries the RSC flight payload, which repeats the same class names as escaped
  strings further down. Indexing the whole document therefore compares positions that may belong to the
  serialised payload rather than the rendered markup, and one mid-compile response during development
  was enough to make the order look inverted. Slicing to the article first removes that whole class of
  false result.
*/
const articleStart = fullHtml.indexOf('<article class="mx-auto')
const articleEnd = articleStart === -1 ? -1 : fullHtml.indexOf('</article>', articleStart)
const html = articleStart === -1 ? fullHtml : fullHtml.slice(articleStart, articleEnd === -1 ? undefined : articleEnd)

check('the rendered article element was located', articleStart !== -1,
  'without it the order assertions below would be measured against the RSC payload')

// The header's inner container is the reference. The article must use the same width and gutters, or
// it will not line up with the navigation above it.
const NAV_CONTAINER = 'max-w-[96rem]'
const GUTTERS = ['px-4', 'sm:px-6', 'lg:px-8']

const articleTag = fullHtml.match(/<article class="([^"]*mx-auto[^"]*)"/)
check('the article frame was found', !!articleTag)

if (articleTag) {
  const cls = articleTag[1]
  check('the article uses the same max width as the navigation', cls.includes(NAV_CONTAINER), cls)
  for (const g of GUTTERS) {
    check(`the article uses the shared ${g} gutter`, cls.includes(g))
  }
}

// Two-column grid.
check('the two-column grid is applied at desktop widths',
  html.includes('lg:grid-cols-[minmax(0,1fr)_minmax(21rem,26rem)]'))
check('the text track can shrink, so long content cannot force sideways scrolling',
  html.includes('minmax(0,1fr)'))
check('the media column is placed in the second track', html.includes('lg:col-start-2'))
check('the media column spans both rows beside the text', html.includes('lg:row-span-2'))
check('the body is placed under the header in the first track', html.includes('lg:row-start-2'))
check('a readable measure is enforced on the prose', html.includes('max-w-[68ch]'))

// Sticky rail, held below the fixed header.
check('the media column is sticky on desktop', html.includes('lg:sticky'))
check('...and offset below the fixed header rather than under it', html.includes('lg:top-20'))

// Document order: header, then media, then body.
const headerAt = html.indexOf('lg:row-start-1')
const asideAt = html.indexOf('<aside')
const bodyAt = html.indexOf('lg:row-start-2')
check('the header comes first in the document', headerAt !== -1)
check('the media preview comes after the header',
  asideAt > headerAt, `header@${headerAt} aside@${asideAt}`)
check('the article body comes after the media preview — this is the mobile order',
  bodyAt > asideAt, `aside@${asideAt} body@${bodyAt}`)

// The expandable viewer.
check('the featured image is an expandable button, not a bare image',
  html.includes('aria-haspopup="dialog"'))
check('there is a visible enlarge affordance', html.includes('Click to enlarge'))
check('the preview is contained rather than cropped', html.includes('object-contain'))
check('the preview height is capped on phones', html.includes('max-h-[18rem]'))
check('...and capped below the viewport on desktop', html.includes('lg:max-h-[70vh]'))
check('the dialog is not present until it is opened', !html.includes('aria-modal'))

// Exactly one rendered copy of the featured file. Metadata references (og:image, twitter:image,
// JSON-LD) and the RSC payload mention it too, so only <img> tags are counted.
const cover = html.match(/<img[^>]*src="\/api\/media\/file\/([^"]+)"/)
if (cover) {
  const file = cover[1]
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const imgTags = (html.match(new RegExp(`<img[^>]*${escaped}[^>]*>`, 'g')) ?? []).length
  check('the featured image is rendered exactly once', imgTags === 1,
    `${imgTags} <img> tags reference ${file}`)
}

console.log(`\n${passed} passed, ${failed} failed`)
// exitCode rather than exit(): calling exit() while the fetch handle is still closing trips a libuv
// assertion on Windows and prints a crash banner after an otherwise clean run.
process.exitCode = failed > 0 ? 1 : 0
