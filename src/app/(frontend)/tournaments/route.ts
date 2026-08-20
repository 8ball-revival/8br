import { NextResponse, type NextRequest } from 'next/server'

/**
 * Tournaments are called Cups now.
 *
 * The word changed; the records did not. Every old link keeps working through a permanent redirect
 * that carries the query string across — the query string IS the view on these listings, so
 * dropping it would turn "archived Cups from 2005 sorted oldest first" into "the default page",
 * which is worse than a 404 because it looks like it worked.
 *
 * 308 rather than 301: permanent, method-preserving, and correct to cache for a route that is not
 * coming back.
 *
 * `/tournaments` had no listing of its own — it already redirected to the archive — so it lands on
 * the Cups archive rather than inventing a destination.
 */
export function GET(request: NextRequest) {
  const url = request.nextUrl.clone()
  url.pathname = '/cups'
  return NextResponse.redirect(url, 308)
}
