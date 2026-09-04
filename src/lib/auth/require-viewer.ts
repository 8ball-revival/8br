import 'server-only'
import { cache } from 'react'

import { getCurrentUser, type CurrentUser } from '@/lib/account/auth'
import { resolveMemberStatus } from '@/lib/moderation/service'

/**
 * Is there an account here that is allowed to see the site?
 *
 * ── Why this exists beside the middleware ────────────────────────────────────────────────────────
 * The middleware proves a session token is real and current. It cannot prove the ACCOUNT is, because
 * that is a database question and the edge has no database. So a member banned five minutes ago
 * still holds a perfectly valid, unexpired token, and would keep browsing until it expired.
 *
 * This is the answer to that: `payload.auth` for the identity, and the moderation record for whether
 * the identity may be used. `canLogin` is already the project's definition of an account that may
 * hold a session — false for BANNED and DELETED — and reusing it is deliberate. A second definition
 * of "allowed" is how two parts of a site come to disagree about who is banned.
 *
 * A TIMED_OUT member keeps access on purpose: a timeout withdraws participation, not readership,
 * which is the existing rule everywhere else and is not this change's to alter.
 *
 * ── Invalid, expired, tampered ───────────────────────────────────────────────────────────────────
 * All three arrive here as "no user": `payload.auth` returns none for a token it cannot verify or
 * that has expired. There is no separate branch for them because there is no separate outcome.
 *
 * Wrapped in `cache()` so the layout and a page in the same request share one resolution rather than
 * authenticating twice.
 */
export const resolveViewer = cache(async function resolveViewer(): Promise<CurrentUser | null> {
  const user = await getCurrentUser()
  if (!user) return null

  /*
    A numeric id is what the moderation table is keyed by.

    If the id will not parse, the account cannot be checked — and an account that cannot be checked
    is not admitted. Failing closed on a malformed identity costs nothing real and removes the only
    path by which an unverifiable user would be treated as verified.
  */
  const userId = Number(user.id)
  if (!Number.isFinite(userId)) return null

  try {
    const status = await resolveMemberStatus(userId)
    return status.canLogin ? user : null
  } catch {
    /*
      The status could not be read, so it is not known to be good.

      A database blip must not become an open door. The reader is treated as logged out, which is
      recoverable, rather than admitted, which is not.
    */
    return null
  }
})

/** Whether the current request carries an account allowed to see the site. */
export async function hasSiteAccess(): Promise<boolean> {
  return (await resolveViewer()) != null
}
