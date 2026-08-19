import { NextResponse, type NextRequest } from 'next/server'

/**
 * /tournaments/<id> → /cups/<id>.
 *
 * The identifier is carried straight across: it addresses the same canonical record, and a redirect
 * that changed it would send a reader to a different competition.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ number: string }> }) {
  const { number } = await ctx.params
  const url = request.nextUrl.clone()
  url.pathname = `/cups/${number}`
  return NextResponse.redirect(url, 308)
}
