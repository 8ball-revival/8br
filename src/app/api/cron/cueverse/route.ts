import { NextResponse, type NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { timingSafeEqual } from 'node:crypto'
import { refreshCueVerseLeaderboard, CUEVERSE_TAG } from '@/lib/cueverse/service'

/**
 * The daily CueVerse leaderboard refresh.
 *
 * Scheduled at 10:00 UTC, which is 03:00 America/Phoenix year-round — Arizona does not observe
 * daylight saving, so a single UTC time holds all year and the job never drifts by an hour.
 *
 * The project had no scheduler before this, so it uses Vercel Cron (declared in vercel.json), the
 * smallest mechanism that works on the platform this deploys to. Vercel calls this route with a
 * bearer token; without CRON_SECRET configured the route is closed to everybody, because an open
 * endpoint that makes an outbound request on demand is somebody else's traffic amplifier.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorised(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  // No secret configured means no scheduled refresh. Failing closed is the only safe default here:
  // an unauthenticated trigger would let anyone make this server call out at will.
  if (!secret) return false

  const header = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  // Length is compared first because timingSafeEqual throws on a mismatch; a header's length is not
  // the secret.
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function GET(request: NextRequest) {
  if (!authorised(request)) {
    // 404 rather than 401: an endpoint nobody may call should not confirm it exists.
    return new NextResponse('Not found', { status: 404 })
  }

  const result = await refreshCueVerseLeaderboard()
  // 'max' expires the entry outright: the daily snapshot has changed, so nothing stale is worth
  // serving. (Next 16 requires an explicit cache-life profile here.)
  if (result.ok) revalidateTag(CUEVERSE_TAG, 'max')

  // 200 even on a handled failure. The job did its job: it tried, it refused a bad result, and it
  // left the good snapshot in place. A 500 here would only make the platform retry a source that is
  // already known to be unwell.
  return NextResponse.json({
    ok: result.ok,
    unchanged: result.unchanged ?? false,
    entries: result.entries ?? 0,
    error: result.error,
  })
}
