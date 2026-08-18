import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isPubliclyVisible } from '@/lib/editorial/service'
import { recordView, parseSeen, serialiseSeen, VIEW_COOKIE, VIEW_COOLDOWN_HOURS } from '@/lib/editorial/views'

/**
 * Count one article view.
 *
 * Called from the article page by a small client component rather than during render, for three
 * reasons: a server render cannot set a cookie, a router prefetch would inflate the count, and
 * crawlers do not run JavaScript. The cookie that suppresses repeat views lives in the reader's own
 * browser; nothing identifying is stored on the server.
 */
export async function POST(request: NextRequest) {
  let articleId: number
  try {
    const body = (await request.json()) as { articleId?: unknown }
    articleId = Number(body.articleId)
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  if (!Number.isInteger(articleId) || articleId <= 0) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  // Only a genuinely public article is countable — otherwise a draft's id would be probeable by
  // watching whether its counter moved.
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { id: true, state: true, publishAt: true },
  })
  if (!article || !isPubliclyVisible(article)) return NextResponse.json({ ok: true })

  const seen = parseSeen(request.cookies.get(VIEW_COOKIE)?.value)
  const response = NextResponse.json({ ok: true })

  if (!seen.has(articleId)) await recordView(articleId)

  response.cookies.set({
    name: VIEW_COOKIE,
    value: serialiseSeen(seen, articleId),
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: VIEW_COOLDOWN_HOURS * 3600,
  })
  return response
}
