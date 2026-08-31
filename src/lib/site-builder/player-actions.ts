'use server'

/**
 * The editor's read-only window onto the player roster.
 *
 * ── Why these are actions and not an API route ──────────────────────────────────────────────────
 * A route would be a new public URL that has to be given its own authentication, its own rate
 * limit and its own review. These reuse the one gate the rest of the Site Builder already uses:
 * `requireCapability('manage_site_builder')`, which is Owner-only. Nothing here is reachable by a
 * signed-out visitor or by an administrator without that designation — the same position they are
 * in for every other Site Builder action.
 *
 * Both functions READ. Neither creates, renames, merges, links or deletes a player, and neither
 * touches a season, match, rating or achievement. What they return is public identity — name,
 * CueVerse ID, past handles — which is what a person needs to recognise somebody in a list, and is
 * already on their public profile.
 */

import { requireCapability } from '@/lib/competition/staff-auth'
import { searchPlayers, resolvePlayers, type PlayerOption } from '@/lib/players/picker-search'

export type PlayerLookupResult<T> = { ok: true; data: T } | { ok: false; error: string }

async function guarded<T>(fn: () => Promise<T>): Promise<PlayerLookupResult<T>> {
  try {
    await requireCapability('manage_site_builder')
    return { ok: true, data: await fn() }
  } catch (err) {
    // The message is deliberately the same whether the caller lacked the capability or the query
    // failed: an unauthorised caller learns nothing from it about what exists.
    console.error('[site-builder] player lookup failed', err)
    return { ok: false, error: 'That lookup could not be completed.' }
  }
}

/** Players matching a term. Capped server-side; the client cannot ask for more. */
export async function searchPlayersAction(query: string): Promise<PlayerLookupResult<PlayerOption[]>> {
  return guarded(async () => {
    if (typeof query !== 'string') return []
    // The cap is applied here rather than taken from the caller: a limit the client chooses is not
    // a limit. Twelve is what fits a dropdown without becoming a directory dump.
    return searchPlayers(query.slice(0, 80), 12)
  })
}

/**
 * Resolve stored ids for display.
 *
 * An id with no player comes back absent, which is how the picker knows to say the reference is
 * broken instead of silently showing an empty box that looks like nobody was ever chosen.
 */
export async function resolvePlayersAction(
  ids: string[],
): Promise<PlayerLookupResult<Record<string, PlayerOption>>> {
  return guarded(async () => {
    if (!Array.isArray(ids)) return {}
    const found = await resolvePlayers(ids.slice(0, 25).map(String))
    return Object.fromEntries(found)
  })
}
