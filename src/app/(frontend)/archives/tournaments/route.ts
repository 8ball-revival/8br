import { NextResponse, type NextRequest } from 'next/server'

/** Tournaments are called Tournaments now. Permanent redirect, query string preserved — see /tournaments. */
export function GET(request: NextRequest) {
  const url = request.nextUrl.clone()
  url.pathname = '/tournaments'
  return NextResponse.redirect(url, 308)
}
