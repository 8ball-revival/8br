/**
 * The homepage news surfaces read The Break, and every row gets a picture.
 *
 * Two faults are pinned here, both reported from the live homepage:
 *
 *   1. The panel read the legacy `Article` table, which has held three rows since The Break
 *      replaced it. Five published posts were invisible to it and no amount of publishing changed
 *      what it showed.
 *   2. The thumbnails are keyed by article slug. Once the panel follows The Break the posts in it
 *      change, and a post nobody assigned art to fell through to the branded grey plaque.
 *
 * Run:  npx tsx --tsconfig tsconfig.scripts.json scripts/verify-home-news.mts
 */
import { readFileSync } from 'node:fs'
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { pictureFor, DEFAULT_ARTICLE_ART, type ArticleArt } from '../src/lib/home/article-art.ts'
import { latestBreakPosts } from '../src/lib/home/break-news.ts'

assertLocalDatabase()

let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

const post = (slug: string, imageUrl: string | null = null) =>
  ({ slug, imageUrl, imageAlt: imageUrl ? 'own art' : null })

// ── The picture rule ──────────────────────────────────────────────────────────────────────────
section('Every row gets a picture, and the most specific one wins')
{
  const art: ArticleArt[] = [
    { slug: 'alpha', src: '/a.webp', alt: '', focal: '10% 10%' },
    { slug: 'beta', src: '/b.webp', alt: '', focal: '20% 20%' },
    { slug: 'gamma', src: '/c.webp', alt: '', focal: '30% 30%' },
  ]

  check("a post's OWN image wins over everything",
    pictureFor(post('alpha', '/own.png'), art, 0)?.src === '/own.png')
  check('...and carries its own alt text',
    pictureFor(post('alpha', '/own.png'), art, 0)?.alt === 'own art')

  check('art assigned to that slug is used when the post has none',
    pictureFor(post('beta'), art, 0)?.src === '/b.webp',
    pictureFor(post('beta'), art, 0)?.src)
  check('...keeping the focal point chosen for it',
    pictureFor(post('beta'), art, 0)?.focal === '20% 20%')

  /*
   * The reason this exists: a brand-new post matches no slug, and three grey plaques in a row is
   * what the homepage looked like when this was reported.
   */
  check('an unknown post still gets a picture, by position',
    pictureFor(post('brand-new'), art, 0)?.src === '/a.webp')
  check('...a different one in the next slot',
    pictureFor(post('another-new'), art, 1)?.src === '/b.webp')
  check('...and the list cycles rather than running out',
    pictureFor(post('a-fourth'), art, 3)?.src === '/a.webp')

  check('an empty art list leaves the branded fallback to do its job',
    pictureFor(post('anything'), [], 0) === null)
  check('a configured entry with no image does not count as art',
    pictureFor(post('x'), [{ slug: 'x', src: '   ', alt: '', focal: '50% 50%' }], 0) === null)

  check('the seeded mapping still matches its three articles',
    DEFAULT_ARTICLE_ART.every((a) => a.slug && a.src.startsWith('/assets/')))
}

// ── The source ────────────────────────────────────────────────────────────────────────────────
section('The homepage reads The Break, not the frozen Article table')
{
  const home = readFileSync('src/components/site-builder/modules/registry-home.tsx', 'utf8')
  const data = readFileSync('src/components/site-builder/modules/registry-data.tsx', 'utf8')

  check('the plaques and hero take their list from The Break', home.includes('return latestBreakPosts(3)'))
  check('...and no longer from getHomeNews', !/const news = await getHomeNews\(\)/.test(home))
  check('the feature card reads The Break too', data.includes('await latestBreakPosts(3)'))
  check('headlines link to /the-break, not through the /news redirect',
    home.includes("default: '/the-break'"))

  const rows = await latestBreakPosts(3)
  check('it returns posts', rows.length > 0, `${rows.length}`)
  check('newest first', rows.every((r, i) => i === 0 || rows[i - 1].publishAt >= r.publishAt))
  check('every row has what the card renders',
    rows.every((r) => r.slug && r.title && r.publishAt instanceof Date))

  /*
   * The visibility predicate is `publicPostWhere`, shared with every feed and count. This asserts
   * the outcome rather than the call, so a future rewrite that forgets `removedAt` still fails.
   */
  const hidden = await prisma.breakPost.findMany({
    where: { OR: [{ state: 'DRAFT' }, { NOT: { removedAt: null } }, { NOT: { deletedAt: null } }] },
    select: { slug: true },
  })
  const shown = new Set(rows.map((r) => r.slug))
  check('no draft, removed or deleted post reaches the homepage',
    !hidden.some((h) => shown.has(h.slug)),
    hidden.filter((h) => shown.has(h.slug)).map((h) => h.slug).join(','))

  const newest = await prisma.breakPost.findFirst({
    where: { state: 'PUBLISHED', removedAt: null, deletedAt: null, publishedAt: { lte: new Date() } },
    orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    select: { slug: true },
  })
  if (newest) {
    check('the newest published post is the one on top',
      rows[0]?.slug === newest.slug, `${rows[0]?.slug} vs ${newest.slug}`)
  }
}

await prisma.$disconnect()
console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
