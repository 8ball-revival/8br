import { NextResponse, type NextRequest } from 'next/server'

/**
 * Live › Tournaments is now just Tournaments.
 *
 * Seasons and Tournaments are single top-level sections now, each leading with what is running and
 * following with what is finished, so this split no longer exists. Permanent redirect with the query
 * string preserved, because the filters carried across unchanged.
 */
export function GET(request: NextRequest) {
  const url = request.nextUrl.clone()
  url.pathname = '/tournaments'
  return NextResponse.redirect(url, 308)
}
