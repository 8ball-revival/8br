import { NextResponse, type NextRequest } from 'next/server'

import { prisma } from '@/lib/prisma'

/**
 * Archives › Seasons is the Yahoo archive now.
 *
 * It used to redirect to /seasons, which is the CURRENT seasons browser — so an old archive link
 * landed on a listing led by a competition running this month. The historical space has a page of
 * its own, and that is where an archive URL belongs.
 *
 * A link carrying a season maps through to that season, opened on its groups. The id is checked
 * against the archive first: an id that is not Yahoo would open a live competition inside a
 * historical page, so it is dropped and the reader arrives at the archive's front instead of at
 * something that is not history.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.clone()
  const asked = Number(url.searchParams.get('season'))
  const target = new URL(url.origin + '/yahoo')

  if (Number.isInteger(asked) && asked > 0) {
    const season = await prisma.season.findUnique({ where: { id: asked }, select: { platform: true } })
    if (season?.platform === 'YAHOO') {
      target.searchParams.set('season', String(asked))
      target.searchParams.set('view', 'groups')
    }
  }
  // 307 rather than 308: the destination depends on a lookup, so it must not be cached forever.
  return NextResponse.redirect(target, 307)
}
