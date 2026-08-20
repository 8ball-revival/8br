'use client'

import { useEffect, useRef } from 'react'

/**
 * Keeps an in-use session alive.
 *
 * ── The problem it solves ────────────────────────────────────────────────────────────────────────
 * A Payload session is a JWT with a fixed expiry stamped at login. It does not renew itself, so a
 * long session ends on a clock rather than on inactivity: you can be halfway through entering a
 * Season's results and be signed out because you logged in some hours earlier. Raising the expiry
 * alone would trade that for the opposite problem — a session on a shared machine that never dies.
 *
 * ── What it does ─────────────────────────────────────────────────────────────────────────────────
 * Asks Payload for a fresh token while somebody is demonstrably still here: once shortly after the
 * page loads, and again when they come back to the tab after being away. Each refresh restamps the
 * expiry, so continuous use slides the window forward indefinitely and a session nobody touches
 * still runs out on schedule.
 *
 * ── Why the throttle ─────────────────────────────────────────────────────────────────────────────
 * Tab focus fires constantly — every alt-tab, every switch back from another window. Refreshing on
 * each one would mean a database write per glance for no benefit, since a token good for weeks
 * gains nothing from being reissued twice a minute. Once an hour is far more often than needed to
 * stay ahead of a 30-day expiry.
 *
 * Rendered only for signed-in visitors, and silent by design: a refresh that fails changes nothing
 * on screen. The session simply runs its original course and the normal sign-in prompt appears when
 * it ends, which is the same thing that would have happened without this component.
 */

/** Payload's own refresh endpoint, mounted by the (payload)/api/[...slug] route. */
const REFRESH_URL = '/api/users/refresh-token'

const HOUR = 60 * 60 * 1000

export function SessionKeepalive() {
  const lastRun = useRef(0)

  useEffect(() => {
    let cancelled = false

    const refresh = async () => {
      const now = Date.now()
      if (now - lastRun.current < HOUR) return
      lastRun.current = now
      try {
        // credentials: 'same-origin' so the session cookie is sent and the reissued one is stored.
        await fetch(REFRESH_URL, { method: 'POST', credentials: 'same-origin' })
      } catch {
        // Offline, or the session has already ended. Neither is worth interrupting anybody over.
      }
    }

    // Shortly after load rather than immediately: a fresh sign-in has just minted a token, and the
    // first paint has better things to do than a network round trip.
    const initial = window.setTimeout(() => { if (!cancelled) void refresh() }, 30_000)

    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      window.clearTimeout(initial)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return null
}
