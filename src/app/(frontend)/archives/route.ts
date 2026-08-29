import { NextResponse, type NextRequest } from 'next/server'

/**
 * `/archives` now means the Yahoo era.
 *
 * The word only ever described one thing on this site — the years before CueVerse — and that now has
 * a page of its own. The sub-paths beneath this one are left pointing where they already point
 * (`/seasons`, `/tournaments`): those listings hold finished CueVerse competitions as well as Yahoo
 * ones, so redirecting them into the Yahoo archive would drop results rather than move them.
 */
export function GET(request: NextRequest) {
  const url = request.nextUrl.clone()
  url.pathname = '/yahoo'
  return NextResponse.redirect(url, 308)
}
