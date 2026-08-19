import { NextResponse, type NextRequest } from 'next/server'

/**
 * /ladder → /rankings, permanently, with the query string intact.
 *
 * The feature is called Rankings everywhere now, and its canonical route is /rankings. This exists
 * so the links that already went out — bookmarks, Discord posts, a shared table with a dozen
 * filters on it — keep working and keep pointing at exactly the view they described.
 *
 * The whole query string is carried across because the query string IS the view: dropping it would
 * turn "the all-time playoff table sorted by win rate" into "the default table", which is a worse
 * outcome than a 404 because it looks like it worked.
 *
 * 308 rather than 301: it is the permanent redirect that guarantees the method is preserved, and it
 * is what a client should cache for a route that is never coming back.
 */
export function GET(request: NextRequest) {
  const url = request.nextUrl.clone()
  url.pathname = '/rankings'
  return NextResponse.redirect(url, 308)
}
