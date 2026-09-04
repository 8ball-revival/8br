import { prisma } from '@/lib/prisma'

/**
 * Is this session still a session, and is the account behind it still allowed in?
 *
 * ── The hole this closes ─────────────────────────────────────────────────────────────────────────
 * The account check used to live only in the frontend layout, which means it only ever ran when a
 * PAGE rendered. A direct request to `/api/…` never passes through a layout, so a member who had
 * just been banned — or whose session had been revoked — still held a cryptographically valid token
 * and could read data straight out of Payload's REST and GraphQL endpoints. Payload's own access
 * rules did not help: `media` and both globals are `read: () => true`, and `users` returns the
 * requester's own record, so "no user resolved" is not the same as "no data returned".
 *
 * Two questions, one round trip, because both must be true and neither is worth a second query:
 *
 *   1. Does the session named in the token still exist, and has it not expired? Revocation has to
 *      take effect the moment the row is deleted, not when the token eventually lapses.
 *   2. Is the account free of a BANNED or DELETED moderation record?
 *
 * ── Why raw SQL ──────────────────────────────────────────────────────────────────────────────────
 * The two tables live in different schemas — Payload owns `payload`, Prisma owns `public` — and this
 * runs on every protected request, including from the proxy. One statement that touches both is
 * cheaper than two client calls, and it is a pair of primary-key lookups.
 *
 * ── Read-only, deliberately ──────────────────────────────────────────────────────────────────────
 * `resolveMemberStatus` heals a lapsed timeout by writing the row back to ACTIVE. That is right for
 * a page render and wrong for a gate that runs on every request. A lapsed TIMED_OUT reads as
 * TIMED_OUT here, and TIMED_OUT may sign in either way, so the healing changes nothing this
 * function would answer.
 */

/**
 * The one definition of an account that may hold a session.
 *
 * Mirrors `canLogin` in `moderation/service.ts` deliberately and is exported so nothing else invents
 * a third: a site with two opinions about who is banned will eventually act on the wrong one.
 */
export function statusPermitsAccess(status: string | null | undefined): boolean {
  return status !== 'BANNED' && status !== 'DELETED'
}

export interface SessionStanding {
  /** The session row exists and has not expired. */
  sessionLive: boolean
  /** The account carries no BANNED or DELETED moderation record. */
  accountPermitted: boolean
  /** Both of the above. The only thing a caller normally needs. */
  ok: boolean
}

const DENIED: SessionStanding = { sessionLive: false, accountPermitted: false, ok: false }

export async function readSessionStanding(userId: number, sid: string): Promise<SessionStanding> {
  if (!Number.isFinite(userId) || !sid) return DENIED
  try {
    const rows = await prisma.$queryRaw<{ session_live: boolean; status: string | null }[]>`
      SELECT
        EXISTS (
          SELECT 1 FROM payload.users_sessions s
          WHERE s.id = ${sid} AND s._parent_id = ${userId} AND s.expires_at > now()
        ) AS session_live,
        (SELECT m.status::text FROM public.member_moderation m WHERE m."userId" = ${userId}) AS status`
    const row = rows[0]
    if (!row) return DENIED
    const sessionLive = Boolean(row.session_live)
    const accountPermitted = statusPermitsAccess(row.status)
    return { sessionLive, accountPermitted, ok: sessionLive && accountPermitted }
  } catch {
    /*
      Unreadable standing is not good standing.

      A database blip must not become an open door: the request is refused, which is recoverable,
      rather than admitted, which is not.
    */
    return DENIED
  }
}
