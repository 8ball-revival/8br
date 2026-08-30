import { NextResponse, type NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

import { runDueSchedules } from '@/lib/site-builder/scheduler'

/**
 * The scheduled-publication sweep.
 *
 * ── What this endpoint will and will not do ──────────────────────────────────────────────────────
 * It runs the sweep. That is the entire surface. It accepts no revision id, no page key, no time
 * and no force flag, because every one of those would turn "run the schedule" into "publish this
 * for me" — and an endpoint that publishes what it is told to is an endpoint that has to be trusted
 * rather than merely authenticated. The server chooses what is due from the state of the database.
 *
 * ── The secret ──────────────────────────────────────────────────────────────────────────────────
 * `SITE_BUILDER_CRON_SECRET`, dedicated to this job. Read from `process.env` inside the handler, so
 * it exists only on the server: there is no `NEXT_PUBLIC_` prefix, nothing imports this module from
 * a client component, and the value is never returned in a response, logged, or included in an
 * error. With it unset the route is closed to everybody — failing closed, because a scheduler
 * anybody can trigger is a way to make the server work on demand.
 *
 * A dedicated variable rather than the project-wide `CRON_SECRET` means this job can be rotated or
 * switched off on its own, without touching the CueVerse refresh that shares the platform's cron.
 * The trade-off is written down in docs/site-builder-scheduling.md: Vercel Cron sends the project
 * `CRON_SECRET` as its bearer token, so using the platform scheduler means holding the same value in
 * both variables. Any other scheduler can send the dedicated header instead.
 *
 * ── Why it answers 404 rather than 401 ──────────────────────────────────────────────────────────
 * An endpoint nobody may call should not confirm that it exists. This matches the CueVerse cron
 * route next door, which is worth more than being technically precise about status codes: two
 * scheduled endpoints that behave differently under probing is how one of them ends up mis-audited.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorised(request: NextRequest): boolean {
  const secret = process.env.SITE_BUILDER_CRON_SECRET
  if (!secret) return false

  /*
    Two accepted forms, one secret.

    `Authorization: Bearer` is what Vercel Cron sends. The dedicated header is for any other
    scheduler — a GitHub Action, a machine with cron(8), a person with curl during an incident —
    where the bearer slot may already be taken by something else.
  */
  const offered = [
    request.headers.get('authorization') ?? '',
    request.headers.get('x-site-builder-cron-secret') ?? '',
  ]
  const expected = [`Bearer ${secret}`, secret]

  return offered.some((given, i) => {
    const a = Buffer.from(given)
    const b = Buffer.from(expected[i])
    // Length first: `timingSafeEqual` throws on a length mismatch, and the length of a header is
    // not the secret.
    return a.length === b.length && timingSafeEqual(a, b)
  })
}

async function handle(request: NextRequest) {
  if (!authorised(request)) return new NextResponse('Not found', { status: 404 })

  const result = await runDueSchedules({ trigger: 'cron' })

  /*
    200 even when a revision failed to activate.

    The job did its job: it found what was due, refused the one it could not validate, left the live
    page exactly as it was, and recorded why. A 500 would make the platform retry a document that is
    not going to become valid on the second attempt, and would bury the successful activations in
    the same sweep under a failure that was not theirs.

    The body carries page keys and revision numbers and nothing else. No configuration, no
    connection details, no environment — a cron response is written to a platform log that a wider
    audience can read than the audit trail can.
  */
  return NextResponse.json({
    ok: true,
    ranAt: result.ranAt,
    considered: result.considered,
    activated: result.activations.filter((a) => a.status === 'activated').length,
    failed: result.activations.filter((a) => a.status === 'failed').length,
    expired: result.activations.filter((a) => a.status === 'expired').length,
    skipped: result.activations.filter((a) => a.status === 'skipped').length,
    nextDueAt: result.nextDueAt,
    detail: result.activations.map((a) => ({
      page: a.pageKey,
      revision: a.revisionNumber,
      status: a.status,
      dueAt: a.scheduledFor ?? null,
      error: a.error ?? null,
    })),
  })
}

export async function GET(request: NextRequest) {
  return handle(request)
}

/**
 * POST does the same thing.
 *
 * Vercel Cron issues a GET; most other schedulers default to POST for something that changes state.
 * Supporting both costs one line and removes a whole class of "the cron is configured and nothing
 * happens" that would otherwise be diagnosed by reading this file.
 */
export async function POST(request: NextRequest) {
  return handle(request)
}
