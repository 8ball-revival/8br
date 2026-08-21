import { NextResponse, type NextRequest } from 'next/server'

import { prisma } from '@/lib/prisma'

/**
 * /creator/tournaments/<id> → /tournaments/<number>.
 *
 * This used to point at /creator/cups/<id>. Both now land in the Tournaments section, which is
 * where the workspace lives; the internal id is translated to the public number because that is
 * what the public route is keyed on.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const n = Number(id)
  const t = Number.isInteger(n) && n > 0
    ? await prisma.tournament.findUnique({ where: { id: n }, select: { number: true } })
    : null
  const url = request.nextUrl.clone()
  url.pathname = t?.number != null ? `/tournaments/${t.number}` : '/tournaments'
  return NextResponse.redirect(url, 308)
}
