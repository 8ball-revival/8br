import { NextResponse, type NextRequest } from 'next/server'

/**
 * Archives › Seasons is now just Seasons.
 *
 * Seasons and Cups are single top-level sections now, each leading with what is running and
 * following with what is finished, so this split no longer exists. Permanent redirect with the query
 * string preserved, because the filters carried across unchanged.
 */
export function GET(request: NextRequest) {
  const url = request.nextUrl.clone()
  url.pathname = '/seasons'
  return NextResponse.redirect(url, 308)
}
