import { NextResponse, type NextRequest } from 'next/server'

/**
 * Archives › Tournaments is the Yahoo archive now.
 *
 * This used to redirect to /tournaments — the CURRENT tournaments listing — so a link kept from the
 * archive arrived at an unrelated present-day event. The Yahoo era's three tournaments are part of
 * the historical space, so that is where this goes. Individual tournament detail routes are
 * untouched: a link to a specific event still opens that event.
 */
export function GET(request: NextRequest) {
  const url = request.nextUrl.clone()
  url.pathname = '/yahoo'
  url.search = ''
  return NextResponse.redirect(url, 308)
}
