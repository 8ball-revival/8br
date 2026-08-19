import { NextResponse, type NextRequest } from 'next/server'

/** /creator/tournaments/<id> → /creator/cups/<id>. Same record, same id. */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const url = request.nextUrl.clone()
  url.pathname = `/creator/cups/${id}`
  return NextResponse.redirect(url, 308)
}
