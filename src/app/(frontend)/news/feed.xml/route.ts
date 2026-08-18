import { feedItems, renderRss } from '@/lib/editorial/feed'

/**
 * /news/feed.xml — RSS 2.0.
 *
 * Dynamic rather than cached at build time: a scheduled article becomes public when the clock passes
 * its publish time, and a feed generated before then would keep serving without it.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const body = renderRss(await feedItems())
  return new Response(body, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      // Five minutes is short enough that a new article shows up promptly and long enough that a
      // popular feed does not hit the database on every poll.
      'cache-control': 'public, max-age=300, s-maxage=300',
    },
  })
}
