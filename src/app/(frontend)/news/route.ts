import { NextResponse, type NextRequest } from 'next/server'

/**
 * News is The Break now.
 *
 * The section was renamed because it stopped being only news: predictions, history, memes and
 * discussion all live there. Permanent redirect with the query string preserved — links to /news are
 * in the wild, and a redirect that drops the query breaks every shared filter.
 */
export function GET(request: NextRequest) {
  const url = request.nextUrl.clone()
  url.pathname = '/the-break'
  return NextResponse.redirect(url, 308)
}
