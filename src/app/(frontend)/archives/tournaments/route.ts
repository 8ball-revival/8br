import { NextResponse, type NextRequest } from 'next/server'

/** Tournaments are called Cups now. Permanent redirect, query string preserved — see /tournaments. */
export function GET(request: NextRequest) {
  const url = request.nextUrl.clone()
  url.pathname = '/archives/cups'
  return NextResponse.redirect(url, 308)
}
